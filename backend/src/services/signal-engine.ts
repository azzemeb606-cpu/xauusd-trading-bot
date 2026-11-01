/**
 * signal-engine.ts  —  Signal detection, gate evaluation, and trade dispatch.
 *
 * This is the brain that sits between the scraper and the trade manager:
 *   Scraper emits RadarSnapshot
 *   → SignalEngine checks for new setups
 *   → Evaluates all 9 gates (radar gates + system gates)
 *   → If all pass: dispatches to TradeManager
 *   → In all cases: persists result and optionally notifies
 */

import { env } from '../config/env';
import type { Store } from '../db/store';
import type { BrokerManager } from '../broker/manager';
import { evaluateGates, type GateContext } from '../engine/gates';
import { validateSixGates } from '../engine/validator';
import { logger } from '../lib/logger';
import { dayKey, errMsg, sleep } from '../lib/utils';
import type { Notifier } from '../notify/notifier';
import type { SettingsService } from './settings';
import type { TradeManager } from './tradeManager';
import type { AccountMonitor } from './accountMonitor';
import type { Scraper } from '../scraper/scraper';
import type { RadarSnapshot, ExecutionGates, TradeSetup } from '../scraper/radar-parser';
import type { Signal, GateResult, OrderKind } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Signal bridge — converts a RadarSnapshot TradeSetup → Signal
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

function setupToSignal(setup: TradeSetup, snap: RadarSnapshot): Signal | null {
  const entry = setup.anchorPrice
    ?? (setup.entryZoneLow !== null && setup.entryZoneHigh !== null
      ? Math.round(((setup.entryZoneLow + setup.entryZoneHigh) / 2) * 100) / 100
      : setup.entryZoneLow);

  if (entry === null || setup.sl === null || setup.tp1 === null) return null;

  const id = crypto
    .createHash('sha1')
    .update([setup.direction, entry, setup.sl, setup.tp1, setup.tp2 ?? '', setup.tp3 ?? ''].join('|'))
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    source: 'radar',
    direction: setup.direction,
    hintedKind: null,
    entry,
    entryLow: setup.entryZoneLow ?? undefined,
    entryHigh: setup.entryZoneHigh ?? undefined,
    anchorPrice: setup.anchorPrice ?? undefined,
    sl: setup.sl,
    tp1: setup.tp1,
    tp2: setup.tp2 ?? undefined,
    tp3: setup.tp3 ?? undefined,
    detectedAt: snap.at,
    rawExcerpt: `${setup.direction} ${setup.zoneLabel} | Entry:${entry} SL:${setup.sl} TP1:${setup.tp1}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge radar page gates into system gate results
// ─────────────────────────────────────────────────────────────────────────────

function mergeRadarGates(sysResults: GateResult[], radarExec: ExecutionGates): GateResult[] {
  const radarGates: GateResult[] = radarExec.gates.map((g) => ({
    id: `RADAR_${g.name}`,
    name: `Bond 007: ${g.name.replace(/_/g, ' ')}`,
    passed: g.status === 'PASS',
    detail: `${g.label}${g.value ? ` (${g.value})` : ''} — ${g.status}`,
  }));

  // "TRADE BLOCKED" from the radar itself is a hard block
  if (radarExec.overall === 'TRADE_BLOCKED') {
    radarGates.unshift({
      id: 'RADAR_OVERALL',
      name: 'Bond 007 Radar: Overall Gate Status',
      passed: false,
      detail: `Radar reports TRADE BLOCKED (engine health: ${radarExec.healthPct ?? '?'}%)`,
    });
  }

  return [...sysResults, ...radarGates];
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalEngine
// ─────────────────────────────────────────────────────────────────────────────

export class SignalEngine {
  private lastSignalId: string | null = null;
  private stopped = false;

  constructor(
    private scraper: Scraper,
    private brokers: BrokerManager,
    private store: Store,
    private notifier: Notifier,
    private settings: SettingsService,
    private tradeManager: TradeManager,
    private accountMonitor: AccountMonitor,
  ) {
    // React to every changed RadarSnapshot (emitted by the scraper's parse loop)
    scraper.on('snapshot', (snap: RadarSnapshot) => {
      void this.evaluate(snap).catch((e) => logger.error({ err: errMsg(e) }, 'SignalEngine evaluate error'));
    });

    // Feed health changes → alert
    scraper.on('healthChange', ({ healthy, statuses }: { healthy: boolean; statuses: any[] }) => {
      if (!healthy) {
        for (const st of statuses.filter((s) => s.consecutiveErrors >= 3)) {
          notifier.notify({
            type: 'FEED_DOWN', severity: 'critical',
            data: { source: st.source, seconds: st.staleSec, error: st.lastError },
            dedupeKey: `feed-down-${st.source}`,
          });
        }
      } else {
        notifier.notify({
          type: 'FEED_RESTORED', severity: 'info',
          data: { source: 'all' },
          dedupeKey: 'feed-restored',
        });
      }
    });
  }

  stop() { this.stopped = true; }

  // ── main evaluation ────────────────────────────────────────────────────────

  private async evaluate(snap: RadarSnapshot): Promise<void> {
    if (this.stopped) return;
    const s = this.settings.get();

    // Try both buy and sell setups; in practice only one is active at a time
    for (const setup of [snap.buySetup, snap.sellSetup].filter((x): x is TradeSetup => !!x)) {
      const signal = setupToSignal(setup, snap);
      if (!signal) continue;

      // Skip if we already processed this exact signal id
      if (this.lastSignalId === signal.id) continue;
      const existing = this.store.getSignal(signal.id);
      if (existing && existing.status !== 'NEW') continue;

      // New unique setup detected
      this.lastSignalId = signal.id;
      this.store.insertSignal(signal);

      this.notifier.notify({
        type: 'SETUP_FORMED', severity: 'info',
        data: {
          direction: signal.direction,
          entry: signal.entry,
          entryZoneLow: setup.entryZoneLow,
          entryZoneHigh: setup.entryZoneHigh,
          anchorPrice: setup.anchorPrice,
          sl: signal.sl,
          tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
          rr: setup.rr,
          hintedKind: signal.hintedKind,
          fusionBias: snap.fusion.bias,
          fusionConf: snap.fusion.confidence,
          alignedBrains: snap.fusion.alignedBrains,
          radarGates: snap.execution.overall,
          whaleFlow: snap.zoneLadder.whaleFlow,
          session: snap.zoneLadder.currentSession,
        },
        dedupeKey: `setup-${signal.id}`,
      });

      logger.info({ id: signal.id, dir: signal.direction, entry: signal.entry }, 'New setup detected');

      // System (non-radar) gate evaluation
      const quote = await this.getQuote(signal.direction);
      const accountSnaps = this.accountMonitor.list();
      const openGroups = this.tradeManager.activeGroups().length;
      const worstDdPct = accountSnaps.reduce((a, x) => Math.max(a, x.dailyDdPct), 0);
      const marginLevel = accountSnaps.length
        ? Math.min(...accountSnaps.filter((x) => x.info?.marginLevel !== null).map((x) => x.info!.marginLevel!).filter((v) => v > 0))
        : null;
      const lastLoss = this.tradeManager.lastLossAt;

      // We need balance for volume sizing — use demo account (or first available)
      const firstBroker = this.brokers.tradeTargets(s)[0];
      let balance = 10_000;
      let plannedVolume: number | null = null;
      if (firstBroker?.isConnected()) {
        try {
          const info = await firstBroker.getAccountInfo();
          balance = info.balance;
        } catch { /* use default */ }
        const { legVolumes } = await import('../engine/sizing');
        const spec = await firstBroker.getSpec().catch(() => ({ contractSize: 100, minVolume: 0.01, maxVolume: 50, volumeStep: 0.01, digits: 2 }));
        const vols = legVolumes({
          balance,
          riskPercent: s.riskPercent,
          fixedLot: s.fixedLot,
          maxLot: s.maxLot,
          entry: signal.entry,
          sl: signal.sl,
          contractSize: spec.contractSize,
          minVolume: spec.minVolume,
          maxVolume: spec.maxVolume,
          volumeStep: spec.volumeStep,
          split: s.tpSplit,
          tpCount: [signal.tp1, signal.tp2, signal.tp3].filter(Boolean).length,
        });
        plannedVolume = vols.reduce((a, v) => a + v, 0);
      }

      // ── Strict 6-Gate Trade Criteria Evaluation ─────────────────────────
      const sixEval = validateSixGates({
        signal,
        snapshot: snap,
        quote,
        settings: s,
        activeGroups: this.tradeManager.activeGroups(),
        lastLossAt: lastLoss,
        now: Date.now(),
      });

      const ctx: GateContext = {
        signal,
        context: {
          bias: snap.fusion.bias === 'UNKNOWN' ? 'UNKNOWN' : snap.fusion.bias,
          price: snap.spot.mid,
          at: snap.at,
          rawExcerpt: snap.fusion.rawText,
        },
        quote,
        settings: s,
        now: Date.now(),
        feedHealthy: this.scraper.feedHealthy(),
        brokerReady: this.brokers.tradeTargets(s).some((b) => b.isConnected()),
        openGroups,
        dailyDrawdownPct: worstDdPct,
        marginLevel: Number.isFinite(marginLevel!) ? (marginLevel as number) : null,
        lastLossAt: lastLoss,
        plannedVolume,
      };

      const { passed: preflightPassed, results: preflightResults } = evaluateGates(ctx);

      // Merge 6-Gate criteria results + pre-flight + radar page gates
      const allResults = [...sixEval.results, ...preflightResults];
      const allPassed = sixEval.allPassed && preflightPassed && snap.execution.overall !== 'TRADE_BLOCKED';

      this.store.updateSignal(signal.id, allPassed ? 'EXECUTING' : 'BLOCKED', allResults);

      if (!allPassed) {
        const failed = allResults.filter((r) => !r.passed).map((r) => r.name);
        logger.info({ id: signal.id, failed, sixGatePassed: sixEval.allPassed }, 'Gates blocked');
        if (s.notifyGateBlocks) {
          this.notifier.notify({
            type: 'GATES_BLOCKED', severity: 'warning',
            data: { direction: signal.direction, entry: signal.entry, sl: signal.sl, tp1: signal.tp1, failed },
            dedupeKey: `blocked-${signal.id}`,
          });
        }
        this.store.updateSignal(signal.id, 'BLOCKED', allResults, failed.slice(0, 5).join('; '));
        continue;
      }

      // ── All 6 criteria & pre-flight pass → execute ────────────────────────
      const targets = this.brokers.tradeTargets(s);
      if (!targets.length) {
        this.store.updateSignal(signal.id, 'FAILED', allResults, 'No connected trade accounts available');
        continue;
      }

      const effectiveKind: OrderKind = sixEval.orderKind ?? 'MARKET';
      if (sixEval.orderPrice) {
        signal.entry = sixEval.orderPrice;
      }
      logger.info(
        { id: signal.id, kind: effectiveKind, price: signal.entry, targets: targets.map((b) => b.key) },
        'All 6 criteria passed! Executing trade'
      );

      try {
        await this.tradeManager.execute(signal, effectiveKind, targets);
        this.store.updateSignal(signal.id, 'EXECUTED', allResults);
      } catch (e) {
        logger.error({ err: errMsg(e) }, 'Trade execution error');
        this.store.updateSignal(signal.id, 'FAILED', allResults, errMsg(e));
      }
    }
  }

  private async getQuote(direction: string): Promise<any> {
    const targets = this.brokers.tradeTargets(this.settings.get());
    const b = targets.find((x) => x.isConnected()) ?? this.brokers.all().find((x) => x.isConnected());
    if (!b) return null;
    try { return await b.getQuote(); } catch { return null; }
  }
}
