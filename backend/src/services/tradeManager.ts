/**
 * tradeManager.ts  —  Module 2: Full Trade Execution Engine (COMPLETE REWRITE)
 *
 * Responsibilities:
 *  1. EXECUTE  — Place multi-leg orders (Market or Limit) with retry & slippage guard
 *  2. MONITOR  — Detect fills, TP hits, SL hits, expiry every TRADE_MONITOR_MS
 *  3. TP PARTIAL CLOSE — TP1 → 50% close, TP2 → 30% close, TP3 → 20% close
 *  4. BREAK-EVEN — After TP1 hit, move SL of remaining legs to entry ± BE_BUFFER
 *  5. TRAIL    — After TP2 hit, trail SL of final leg to TP1 level
 *  6. DUAL MIRROR — Executes on Demo AND Live simultaneously (DUAL_MIRROR mode)
 *  7. EXPIRY   — Cancel unfilled limit orders after PENDING_EXPIRY_MINUTES
 *  8. STATS    — Daily/Weekly/All-time P&L, win rate, best/worst, streak
 *  9. MANUAL   — closeGroup(), closeOneLeg(), modifyGroupSl() via REST API
 * 10. ALERTS   — Every lifecycle event fires a bilingual WhatsApp+TG+Email alert
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { env } from '../config/env';
import { dayKey } from '../lib/utils';
import type { Store } from '../db/store';
import type { BrokerManager } from '../broker/manager';
import type { Broker, BrokerOrder, BrokerPosition } from '../broker/types';
import { execPrice } from '../engine/gates';
import { legVolumes } from '../engine/sizing';
import { logger } from '../lib/logger';
import { errMsg, round, sleep } from '../lib/utils';
import type { Notifier } from '../notify/notifier';
import type { SettingsService } from './settings';
import type { AccountKey, Direction, OrderKind, Signal, TradeGroup, TradeLeg } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL = new Set(['CLOSED', 'CANCELLED', 'FAILED']);
/** After this many monitor cycles without seeing a position/order, declare it closed. */
const MISSING_TICKS_LIMIT = 24;
/** Retry limit for a single placeOrder attempt. */
const ORDER_MAX_RETRIES = 3;
/** Delay between order retries (ms). */
const ORDER_RETRY_DELAY = 1_500;
/** Price drift allowed between quote capture and order placement (USD). */
const SLIPPAGE_GUARD = 3.0;

const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '<1m';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Trade Statistics
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  breakEven: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  currentStreak: number;       // positive = win streak, negative = loss streak
  maxWinStreak: number;
  maxLossStreak: number;
  todayPnl: number;
  todayTrades: number;
  weekPnl: number;
  avgDuration: string;
  profitFactor: number;        // gross profit / gross loss
}

export function computeStats(groups: TradeGroup[], tzNow: Date, tz: string): TradeStats {
  const closed = groups.filter((g) => g.status === 'CLOSED' && g.closedAt);
  const day = dayKey(tzNow, tz);
  const weekAgo = tzNow.getTime() - 7 * 86_400_000;

  let wins = 0, losses = 0, be = 0;
  let totalPnl = 0, todayPnl = 0, weekPnl = 0, todayTrades = 0;
  let bestTrade = -Infinity, worstTrade = Infinity;
  let grossWin = 0, grossLoss = 0;
  let currentStreak = 0, maxWinStreak = 0, maxLossStreak = 0, streak = 0;
  let durationSum = 0;

  for (const g of closed) {
    const pnl = g.realizedPnl;
    const closedDay = dayKey(new Date(g.closedAt!), tz);
    totalPnl += pnl;
    if (closedDay === day) { todayPnl += pnl; todayTrades++; }
    if (g.closedAt! >= weekAgo) weekPnl += pnl;
    if (pnl > 0) { wins++; grossWin += pnl; streak = streak > 0 ? streak + 1 : 1; maxWinStreak = Math.max(maxWinStreak, streak); }
    else if (pnl < 0) { losses++; grossLoss += Math.abs(pnl); streak = streak < 0 ? streak - 1 : -1; maxLossStreak = Math.max(maxLossStreak, Math.abs(streak)); }
    else { be++; streak = 0; }
    bestTrade = Math.max(bestTrade, pnl);
    worstTrade = Math.min(worstTrade, pnl);
    if (g.openedAt) durationSum += g.closedAt! - g.openedAt;
  }
  currentStreak = streak;
  const total = wins + losses + be;
  const avgDurationMs = total > 0 ? durationSum / total : 0;

  return {
    total,
    wins,
    losses,
    breakEven: be,
    winRate: total > 0 ? round((wins / total) * 100, 1) : 0,
    totalPnl: round(totalPnl, 2),
    avgWin: wins > 0 ? round(grossWin / wins, 2) : 0,
    avgLoss: losses > 0 ? round(grossLoss / losses, 2) : 0,
    bestTrade: bestTrade === -Infinity ? 0 : round(bestTrade, 2),
    worstTrade: worstTrade === Infinity ? 0 : round(worstTrade, 2),
    currentStreak,
    maxWinStreak,
    maxLossStreak,
    todayPnl: round(todayPnl, 2),
    todayTrades,
    weekPnl: round(weekPnl, 2),
    avgDuration: fmtDuration(avgDurationMs),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? 99 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TradeManager
// ─────────────────────────────────────────────────────────────────────────────

export class TradeManager extends EventEmitter {
  private lock: Promise<unknown> = Promise.resolve();
  private stopped = false;
  lastLossAt: number | null;

  constructor(
    private brokers: BrokerManager,
    private store: Store,
    private notifier: Notifier,
    private settings: SettingsService,
  ) {
    super();
    this.lastLossAt = store.getKv<number>('last_loss_at');
  }

  // ── serialised lock prevents race conditions on concurrent ticks ────────────
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  activeGroups(): TradeGroup[] { return this.store.activeGroups(); }

  getStats(): TradeStats {
    const all = this.store.listGroups(2000);
    return computeStats(all, new Date(), env.DAY_RESET_TZ);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. EXECUTE — Place orders
  // ══════════════════════════════════════════════════════════════════════════

  execute(signal: Signal, kind: OrderKind, targets: Broker[]): Promise<TradeGroup[]> {
    return this.withLock(async () => {
      // In DUAL_MIRROR mode, fire on both accounts simultaneously
      const groups = await Promise.all(targets.map((b) => this.executeOn(b, signal, kind)));
      groups.forEach((g) => this.emit('groupUpdate', g));
      return groups;
    });
  }

  private async executeOn(b: Broker, signal: Signal, kind: OrderKind): Promise<TradeGroup> {
    const s = this.settings.get();
    const now = Date.now();
    const tps = [signal.tp1, signal.tp2, signal.tp3].filter((v): v is number => v !== undefined);
    const log = logger.child({ account: b.key, signal: signal.id });

    const group: TradeGroup = {
      id: crypto.randomUUID(),
      signalId: signal.id,
      account: b.key,
      accountLabel: b.label,
      symbol: b.symbol,
      direction: signal.direction,
      kind,
      entry: signal.entry,
      sl: signal.sl,
      currentSl: signal.sl,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      legs: [],
      status: 'FAILED',
      beMoved: false,
      trailedToTp1: false,
      createdAt: now,
      expiresAt: kind === 'LIMIT' ? now + s.pendingExpiryMin * 60_000 : undefined,
      realizedPnl: 0,
    };

    const alertBase = {
      accountLabel: b.label, symbol: b.symbol, direction: signal.direction,
      entry: signal.entry, sl: signal.sl, tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
    };

    try {
      // ── Pre-order checks ────────────────────────────────────────────────────
      if (!b.isConnected()) throw new Error(`${b.label} is not connected`);

      const [spec, info, quote] = await Promise.all([
        b.getSpec(), b.getAccountInfo(), b.getQuote(),
      ]);

      // Slippage guard for market orders
      if (kind === 'MARKET') {
        const currentPrice = execPrice(signal.direction, quote);
        const drift = Math.abs(currentPrice - signal.entry);
        if (drift > SLIPPAGE_GUARD) {
          throw new Error(
            `Slippage guard: price moved $${drift.toFixed(2)} since signal (limit: $${SLIPPAGE_GUARD}). Entry: ${signal.entry}, Current: ${currentPrice.toFixed(2)}`
          );
        }
      }

      // ── Volume sizing ────────────────────────────────────────────────────────
      const sizingEntry = kind === 'MARKET' ? execPrice(signal.direction, quote) : signal.entry;
      const vols = legVolumes({
        balance: info.balance,
        riskPercent: s.riskPercent,
        fixedLot: s.fixedLot,
        maxLot: s.maxLot,
        entry: sizingEntry,
        sl: signal.sl,
        contractSize: spec.contractSize,
        minVolume: spec.minVolume,
        maxVolume: spec.maxVolume,
        volumeStep: spec.volumeStep,
        split: s.tpSplit,
        tpCount: tps.length,
      });

      if (!vols.length) {
        throw new Error(
          `Risk-based size below broker minimum lot. ` +
          `Balance: $${info.balance}, Risk: ${s.riskPercent}%, SL dist: $${Math.abs(signal.entry - signal.sl).toFixed(2)}`
        );
      }

      log.info({ vols, kind, entry: sizingEntry }, 'Placing orders');

      // ── Build legs ───────────────────────────────────────────────────────────
      const sid = signal.id.slice(0, 6);
      group.legs = vols.map<TradeLeg>((v, i) => ({
        tpLevel: (i + 1) as 1 | 2 | 3,
        volume: v,
        tp: tps[i],
        clientId: `B7${sid}${b.key[0]}${i + 1}`,
        status: 'PENDING',
      }));

      // ── Place order(s) according to tpExecutionStyle ──────────────────────────
      if (s.tpExecutionStyle === 'SINGLE_ORDER_PARTIAL') {
        const totalVolume = round(vols.reduce((a, b2) => a + b2, 0), 2);
        const masterTp = tps[tps.length - 1]; // Master TP is the furthest target
        const res = await this.placeWithRetry(b, {
          direction: signal.direction,
          kind,
          volume: totalVolume,
          price: kind === 'LIMIT' ? signal.entry : undefined,
          sl: signal.sl,
          tp: masterTp,
          comment: `Bond007 SingleMaster ${b.key[0].toUpperCase()}`,
          clientId: `B7${sid}${b.key[0]}M`,
          expiresAt: group.expiresAt ? new Date(group.expiresAt) : undefined,
        });

        if (res.ok) {
          for (const leg of group.legs) {
            leg.orderId = res.orderId;
            leg.positionId = res.positionId ?? (kind === 'MARKET' ? res.orderId : undefined);
            leg.status = kind === 'MARKET' ? 'OPEN' : 'PENDING';
            if (kind === 'MARKET') leg.openPrice = sizingEntry;
          }
          log.info({ totalVolume, orderId: res.orderId }, 'Single master order placed OK');
        } else {
          for (const leg of group.legs) {
            leg.status = 'FAILED';
            leg.error = `${res.code ?? ''} ${res.message}`.trim();
          }
          log.warn({ err: res.message }, 'Single master order rejected');
        }
      } else {
        // Place each leg with retry (SPLIT_ORDERS)
        for (const leg of group.legs) {
          const res = await this.placeWithRetry(b, {
            direction: signal.direction,
            kind,
            volume: leg.volume,
            price: kind === 'LIMIT' ? signal.entry : undefined,
            sl: signal.sl,
            tp: leg.tp,
            comment: `Bond007 TP${leg.tpLevel} ${b.key[0].toUpperCase()}`,
            clientId: leg.clientId,
            expiresAt: group.expiresAt ? new Date(group.expiresAt) : undefined,
          });

          if (res.ok) {
            leg.orderId = res.orderId;
            leg.positionId = res.positionId ?? (kind === 'MARKET' ? res.orderId : undefined);
            leg.status = kind === 'MARKET' ? 'OPEN' : 'PENDING';
            if (kind === 'MARKET') leg.openPrice = sizingEntry;
            log.info({ leg: leg.tpLevel, orderId: res.orderId }, 'Order placed OK');
          } else {
            leg.status = 'FAILED';
            leg.error = `${res.code ?? ''} ${res.message}`.trim();
            log.warn({ leg: leg.tpLevel, err: leg.error }, 'Order rejected');
          }
        }
      }

      // ── Evaluate result ──────────────────────────────────────────────────────
      const okLegs = group.legs.filter((l) => l.status !== 'FAILED');
      const failedLegs = group.legs.filter((l) => l.status === 'FAILED');

      if (!okLegs.length) {
        throw new Error(
          `All ${group.legs.length} leg(s) rejected: ` +
          failedLegs.map((l) => l.error).join(' | ')
        );
      }

      if (failedLegs.length) {
        this.notifier.notify({
          type: 'TRADE_FAILED', severity: 'warning',
          data: { ...alertBase, error: `Partial: ${failedLegs.length} leg(s) rejected — ${failedLegs[0].error}` },
        });
      }

      const totalVolume = round(okLegs.reduce((a, l) => a + l.volume, 0), 2);

      if (kind === 'MARKET') {
        group.status = 'OPEN';
        group.openedAt = Date.now();
        this.notifier.notify({
          type: 'TRADE_OPENED', severity: 'success',
          data: {
            ...alertBase,
            openPrice: round(sizingEntry, 2),
            volume: totalVolume,
            legs: okLegs.length,
            riskUsd: round((info.balance * s.riskPercent) / 100, 2),
            riskPercent: s.riskPercent,
            balance: info.balance,
            accountType: b.key.toUpperCase(),
            orderTicket: okLegs.map((l) => l.orderId ?? l.positionId).filter(Boolean).join(', '),
            groupId: group.id,
          },
        });
      } else {
        group.status = 'PENDING';
        this.notifier.notify({
          type: 'ORDER_PLACED', severity: 'info',
          data: {
            ...alertBase,
            kind,
            volume: totalVolume,
            legs: okLegs.length,
            expiryMin: s.pendingExpiryMin,
            entry: signal.entry,
            accountType: b.key.toUpperCase(),
            orderTicket: okLegs.map((l) => l.orderId ?? l.positionId).filter(Boolean).join(', '),
            groupId: group.id,
          },
        });
      }

    } catch (e) {
      group.status = 'FAILED';
      const msg = errMsg(e);
      logger.error({ account: b.key, signal: signal.id, err: msg }, 'Execution failed');
      this.notifier.notify({
        type: 'TRADE_FAILED', severity: 'critical',
        data: { ...alertBase, error: msg },
      });
    }

    this.store.saveGroup(group);
    return group;
  }

  /** placeOrder with up to ORDER_MAX_RETRIES on retryable errors. */
  private async placeWithRetry(
    b: Broker,
    req: Parameters<Broker['placeOrder']>[0],
  ): ReturnType<Broker['placeOrder']> {
    for (let attempt = 1; attempt <= ORDER_MAX_RETRIES; attempt++) {
      const res = await b.placeOrder(req);
      if (res.ok) return res;

      const retryable = /REQUOTE|PRICE_CHANGED|TIMEOUT|busy|retry/i.test(res.message ?? '');
      if (!retryable || attempt === ORDER_MAX_RETRIES) return res;

      logger.warn({ attempt, code: res.code, msg: res.message }, 'Order rejected — retrying');
      await sleep(ORDER_RETRY_DELAY * attempt);
    }
    return { ok: false, message: 'Max retries exceeded' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. MONITOR — lifecycle tick
  // ══════════════════════════════════════════════════════════════════════════

  start() { void this.loop(); }
  stop() { this.stopped = true; }

  private async loop() {
    while (!this.stopped) {
      try {
        await this.withLock(() => this.tick());
      } catch (e) {
        logger.error({ err: errMsg(e) }, 'Trade monitor tick error');
      }
      await sleep(env.TRADE_MONITOR_MS);
    }
  }

  private async tick() {
    const groups = this.store.activeGroups();
    if (!groups.length) return;
    const accounts = [...new Set(groups.map((g) => g.account))];
    for (const key of accounts) {
      const b = this.brokers.get(key as AccountKey);
      if (!b?.isConnected()) continue;
      let positions: BrokerPosition[], orders: BrokerOrder[];
      try {
        [positions, orders] = await Promise.all([b.getPositions(), b.getOrders()]);
      } catch (e) {
        logger.warn({ account: key, err: errMsg(e) }, 'Position fetch failed in monitor tick');
        continue;
      }
      for (const g of groups.filter((x) => x.account === key)) {
        try {
          await this.processGroup(g, b, positions, orders);
        } catch (e) {
          logger.error({ group: g.id, err: errMsg(e) }, 'processGroup error');
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Process a single trade group for one tick
  // ══════════════════════════════════════════════════════════════════════════

  private async processGroup(
    g: TradeGroup,
    b: Broker,
    positions: BrokerPosition[],
    orders: BrokerOrder[],
  ) {
    const s = this.settings.get();
    const now = Date.now();
    let changed = false;
    let filledNow = false;
    const closedNow: TradeLeg[] = [];

    // ── Step 1: Reconcile each leg with live broker state ────────────────────
    for (const leg of g.legs) {
      if (TERMINAL.has(leg.status)) continue;

      // Match by positionId, orderId, or clientId (most to least specific)
      const pos = positions.find(
        (p) =>
          (leg.positionId && p.id === leg.positionId) ||
          (leg.orderId && p.id === leg.orderId) ||
          (leg.clientId && p.clientId === leg.clientId),
      );

      if (pos) {
        // Position is open on broker
        if (leg.positionId !== pos.id) { leg.positionId = pos.id; changed = true; }
        if (leg.missingTicks) { leg.missingTicks = 0; changed = true; }
        if (leg.status === 'PENDING') {
          // Limit order was filled
          leg.status = 'OPEN';
          leg.openPrice = pos.openPrice;
          filledNow = true;
          changed = true;
        }
        if (leg.openPrice === undefined) { leg.openPrice = pos.openPrice; changed = true; }

        // In SINGLE_ORDER_PARTIAL mode, check if intermediate TP level was hit
        if (s.tpExecutionStyle === 'SINGLE_ORDER_PARTIAL' && leg.status === 'OPEN' && leg.tpLevel < 3) {
          const currentPx = pos.currentPrice;
          const hit = currentPx !== undefined && (g.direction === 'BUY' ? currentPx >= leg.tp : currentPx <= leg.tp);
          if (hit) {
            logger.info({ group: g.id, leg: leg.tpLevel, currentPx, tp: leg.tp }, 'Intermediate TP reached — executing partial close');
            const res = await b.closePosition(pos.id, leg.volume);
            if (res.ok) {
              leg.status = 'CLOSED';
              leg.closePrice = currentPx;
              const contract = 100;
              const legProfit = round((g.direction === 'BUY' ? currentPx - leg.openPrice! : leg.openPrice! - currentPx) * leg.volume * contract, 2);
              leg.profit = legProfit;
              leg.closeReason = 'TP';
              closedNow.push(leg);
              changed = true;
            }
          }
        }
        // Detect if broker already closed at TP/SL (position gone from our list but appears in closed deals)
        continue;
      }

      // Check pending orders
      const ord = orders.find(
        (o) =>
          (leg.orderId && o.id === leg.orderId) ||
          (leg.clientId && o.clientId === leg.clientId),
      );
      if (ord) {
        // Order is still pending — check expiry
        if (g.expiresAt && now > g.expiresAt + 30_000) {
          const r = await b.cancelOrder(ord.id);
          if (r.ok) {
            leg.status = 'CANCELLED';
            leg.closeReason = 'EXPIRED';
            changed = true;
            logger.info({ group: g.id, leg: leg.tpLevel }, 'Limit order expired and cancelled');
          }
        }
        continue;
      }

      // Neither open position nor pending order found — it was closed
      const closeId = leg.positionId ?? leg.orderId;
      const closeInfo = closeId
        ? await b.getPositionClose(closeId).catch(() => null)
        : null;

      if (closeInfo) {
        leg.status = 'CLOSED';
        leg.closePrice = closeInfo.price;
        leg.profit = closeInfo.profit;
        leg.closeReason = this.inferCloseReason(leg, g, closeInfo.reason);
        closedNow.push(leg);
        changed = true;
        logger.info(
          { group: g.id, leg: leg.tpLevel, reason: leg.closeReason, profit: leg.profit },
          'Leg closed',
        );
      } else {
        // Broker hasn't confirmed yet — wait up to MISSING_TICKS_LIMIT cycles
        leg.missingTicks = (leg.missingTicks ?? 0) + 1;
        changed = true;
        if (leg.missingTicks >= MISSING_TICKS_LIMIT) {
          if (leg.status === 'PENDING') {
            leg.status = 'CANCELLED';
            leg.closeReason = 'EXPIRED';
            logger.warn({ group: g.id, leg: leg.tpLevel }, 'Pending leg assumed expired');
          } else {
            leg.status = 'CLOSED';
            leg.closeReason = 'OTHER';
            leg.profit = leg.profit ?? 0;
            closedNow.push(leg);
            logger.warn({ group: g.id, leg: leg.tpLevel }, 'Open leg assumed closed (missing from broker)');
          }
        }
      }
    }

    const alertBase = {
      accountLabel: g.accountLabel,
      accountType: g.account.toUpperCase(),
      symbol: g.symbol,
      direction: g.direction,
      entry: g.entry,
      sl: g.currentSl ?? g.sl,
      tp1: g.tp1,
      tp2: g.tp2,
      tp3: g.tp3,
      groupId: g.id,
    };

    // ── Step 2: Limit order filled → emit TRADE_OPENED ───────────────────────
    if (filledNow && g.status === 'PENDING') {
      g.status = 'OPEN';
      g.openedAt = now;
      const openLegs = g.legs.filter((l) => l.status === 'OPEN');
      const vol = openLegs.reduce((a, l) => a + l.volume, 0);
      const avgPrice = vol > 0
        ? openLegs.reduce((a, l) => a + (l.openPrice ?? g.entry) * l.volume, 0) / vol
        : g.entry;
      this.notifier.notify({
        type: 'TRADE_OPENED', severity: 'success',
        data: { ...alertBase, openPrice: round(avgPrice, 2), volume: round(vol, 2), legs: openLegs.length },
      });
    }

    // ── Step 3: Process newly closed legs in TP order ────────────────────────
    for (const leg of closedNow.sort((a, b2) => a.tpLevel - b2.tpLevel)) {
      const remaining = g.legs.filter((l) => l.status === 'OPEN');

      if (leg.closeReason === 'TP') {
        // TP hit notification
        this.notifier.notify({
          type: 'TP_HIT', severity: 'success',
          data: {
            ...alertBase,
            level: leg.tpLevel,
            price: leg.closePrice,
            profit: leg.profit,
            remaining: remaining.length,
          },
        });

        // ── Step 4: Break-Even after TP1 ──────────────────────────────────────
        if (leg.tpLevel === 1 && s.moveBeOnTp1 && !g.beMoved && remaining.length > 0) {
          await this.moveBreakEven(g, b, remaining, s.beBuffer, alertBase);
        }

        // ── Step 5: Trail SL to TP1 after TP2 ────────────────────────────────
        if (leg.tpLevel === 2 && s.trailToTp1OnTp2 && !g.trailedToTp1 && remaining.length > 0) {
          await this.trailToTp1(g, b, remaining, alertBase);
        }
      } else if (leg.closeReason === 'SL') {
        // Notify on individual SL hit (not final close yet — other legs may remain)
        if (remaining.length > 0) {
          this.notifier.notify({
            type: 'TRADE_FAILED', severity: 'warning',
            data: { ...alertBase, error: `TP${leg.tpLevel} leg hit SL at ${leg.closePrice}. ${remaining.length} leg(s) still open.` },
          });
        }
      }

      changed = true;
    }

    // ── Step 6: Check if ALL legs are terminal ────────────────────────────────
    if (g.legs.length > 0 && g.legs.every((l) => TERMINAL.has(l.status))) {
      const closedLegs = g.legs.filter((l) => l.status === 'CLOSED');
      g.closedAt = now;
      g.realizedPnl = round(closedLegs.reduce((a, l) => a + (l.profit ?? 0), 0), 2);

      if (!closedLegs.length) {
        // All legs were cancelled/expired — no trade happened
        g.status = 'CANCELLED';
        this.notifier.notify({
          type: 'ORDER_CANCELLED', severity: 'info',
          data: { ...alertBase, reason: 'All limit orders expired without fill' },
        });
      } else {
        g.status = 'CLOSED';
        const reasons = closedLegs.map((l) => `TP${l.tpLevel}:${l.closeReason ?? '?'}`).join(', ');
        const duration = fmtDuration(now - (g.openedAt ?? g.createdAt));
        const slLegs = closedLegs.filter((l) => l.closeReason === 'SL').length;
        const tpLegs = closedLegs.filter((l) => l.closeReason === 'TP').length;
        const accInfo = await b.getAccountInfo().catch(() => null);

        this.notifier.notify({
          type: 'TRADE_CLOSED',
          severity: g.realizedPnl >= 0 ? 'success' : 'warning',
          data: {
            ...alertBase,
            pnl: g.realizedPnl,
            reasons, duration,
            tpLegs, slLegs,
            beMoved: g.beMoved,
            trailed: g.trailedToTp1,
            balance: accInfo?.balance,
            equity: accInfo?.equity,
          },
        });

        // Record last loss for cooldown gate
        if (g.realizedPnl < 0) {
          this.lastLossAt = now;
          this.store.setKv('last_loss_at', now);
        }

        logger.info(
          { group: g.id, pnl: g.realizedPnl, duration, reasons },
          'Trade group closed',
        );
      }
      changed = true;
    }

    if (changed) {
      this.store.saveGroup(g);
      this.emit('groupUpdate', g);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Break-Even
  // ══════════════════════════════════════════════════════════════════════════

  private async moveBreakEven(
    g: TradeGroup,
    b: Broker,
    remaining: TradeLeg[],
    beBuffer: number,
    alertBase: Record<string, unknown>,
  ) {
    let movedCount = 0;
    let newSl = g.currentSl;
    const seenPos = new Set<string>();

    for (const leg of remaining) {
      if (!leg.positionId || seenPos.has(leg.positionId)) continue;
      seenPos.add(leg.positionId);
      const openPrice = leg.openPrice ?? g.entry;
      const sl = round(
        g.direction === 'BUY' ? openPrice + beBuffer : openPrice - beBuffer,
        2,
      );
      const res = await b.modifyPosition(leg.positionId, sl, leg.tp);
      if (res.ok) {
        movedCount++;
        newSl = sl;
        logger.info({ group: g.id, leg: leg.tpLevel, newSl: sl }, 'SL moved to BE');
      } else {
        logger.warn({ group: g.id, leg: leg.tpLevel, err: res.message }, 'BE modify failed');
      }
    }

    if (movedCount > 0) {
      g.beMoved = true;
      g.currentSl = newSl;
      this.notifier.notify({
        type: 'BE_MOVED', severity: 'info',
        data: { ...alertBase, newSl, count: movedCount },
      });
    } else {
      this.notifier.notify({
        type: 'TRADE_FAILED', severity: 'warning',
        data: {
          ...alertBase,
          error: 'Could not move SL to break-even — broker rejected all modify requests. Check manually!',
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Trail SL to TP1
  // ══════════════════════════════════════════════════════════════════════════

  private async trailToTp1(
    g: TradeGroup,
    b: Broker,
    remaining: TradeLeg[],
    alertBase: Record<string, unknown>,
  ) {
    let movedCount = 0;
    const seenPos = new Set<string>();
    for (const leg of remaining) {
      if (!leg.positionId || seenPos.has(leg.positionId)) continue;
      seenPos.add(leg.positionId);
      const res = await b.modifyPosition(leg.positionId, g.tp1, leg.tp);
      if (res.ok) { movedCount++; g.trailedToTp1 = true; g.currentSl = g.tp1; }
      else logger.warn({ group: g.id, err: res.message }, 'Trail-to-TP1 failed');
    }
    if (movedCount > 0) {
      this.notifier.notify({
        type: 'SL_TRAILED', severity: 'info',
        data: { ...alertBase, newSl: g.tp1 },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Close reason inference (more accurate than broker's "OTHER")
  // ══════════════════════════════════════════════════════════════════════════

  private inferCloseReason(
    leg: TradeLeg,
    g: TradeGroup,
    brokerReason: TradeLeg['closeReason'],
  ): TradeLeg['closeReason'] {
    if (brokerReason && brokerReason !== 'OTHER') return brokerReason;
    if (leg.closePrice === undefined) return 'OTHER';
    const tpTol = 1.0;   // within $1 of TP is considered a TP hit
    const slTol = 1.0;
    if (Math.abs(leg.closePrice - leg.tp) <= tpTol) return 'TP';
    if (Math.abs(leg.closePrice - g.currentSl) <= slTol) return 'SL';
    return 'MANUAL';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Manual controls (called from REST API)
  // ══════════════════════════════════════════════════════════════════════════

  /** Close/cancel all legs of a trade group. */
  closeGroup(id: string): Promise<TradeGroup> {
    return this.withLock(async () => {
      const g = this.store.getGroup(id);
      if (!g) throw new Error('Trade group not found');
      if (TERMINAL.has(g.status)) throw new Error(`Trade group is already ${g.status}`);
      const b = this.brokers.get(g.account as AccountKey);
      if (!b?.isConnected()) throw new Error(`Broker ${g.account} not connected`);

      for (const leg of g.legs) {
        if (leg.status === 'PENDING' && leg.orderId) {
          const r = await b.cancelOrder(leg.orderId);
          if (r.ok) { leg.status = 'CANCELLED'; leg.closeReason = 'MANUAL'; }
        } else if (leg.status === 'OPEN' && leg.positionId) {
          const r = await b.closePosition(leg.positionId);
          if (!r.ok) logger.warn({ leg: leg.tpLevel, err: r.message }, 'Manual close leg failed');
        }
      }

      this.notifier.notify({
        type: 'ORDER_CANCELLED', severity: 'info',
        data: { accountLabel: g.accountLabel, reason: 'Manually closed from dashboard', direction: g.direction, entry: g.entry },
      });

      this.store.saveGroup(g);
      this.emit('groupUpdate', g);
      return g;
    });
  }

  /** Close a single leg by TP level. */
  closeLeg(groupId: string, tpLevel: number): Promise<TradeGroup> {
    return this.withLock(async () => {
      const g = this.store.getGroup(groupId);
      if (!g) throw new Error('Trade group not found');
      const leg = g.legs.find((l) => l.tpLevel === tpLevel);
      if (!leg) throw new Error(`Leg TP${tpLevel} not found`);
      if (TERMINAL.has(leg.status)) throw new Error(`Leg TP${tpLevel} already ${leg.status}`);
      const b = this.brokers.get(g.account as AccountKey);
      if (!b?.isConnected()) throw new Error('Broker not connected');

      if (leg.status === 'PENDING' && leg.orderId) {
        await b.cancelOrder(leg.orderId);
        leg.status = 'CANCELLED';
        leg.closeReason = 'MANUAL';
      } else if (leg.status === 'OPEN' && leg.positionId) {
        await b.closePosition(leg.positionId);
        // Full close details will be reconciled next monitor tick
      }

      this.store.saveGroup(g);
      this.emit('groupUpdate', g);
      return g;
    });
  }

  /** Modify the SL for all open legs of a group. */
  modifyGroupSl(groupId: string, newSl: number): Promise<TradeGroup> {
    return this.withLock(async () => {
      const g = this.store.getGroup(groupId);
      if (!g) throw new Error('Trade group not found');
      const b = this.brokers.get(g.account as AccountKey);
      if (!b?.isConnected()) throw new Error('Broker not connected');

      for (const leg of g.legs.filter((l) => l.status === 'OPEN')) {
        const res = await b.modifyPosition(leg.positionId!, newSl, leg.tp);
        if (!res.ok) logger.warn({ leg: leg.tpLevel, err: res.message }, 'modifyGroupSl failed');
      }

      g.currentSl = newSl;
      this.store.saveGroup(g);
      this.emit('groupUpdate', g);
      return g;
    });
  }

  /** Move SL to break-even for a group manually (e.g. from Telegram button or API). */
  async moveGroupSlToBe(groupId: string): Promise<boolean> {
    return this.withLock(async () => {
      const g = this.store.getGroup(groupId);
      if (!g) return false;
      const b = this.brokers.get(g.account as AccountKey);
      if (!b?.isConnected()) return false;
      const openLegs = g.legs.filter((l) => l.status === 'OPEN');
      if (!openLegs.length) return false;
      const s = this.settings.get();
      await this.moveBreakEven(g, b, openLegs, s.beBuffer, {
        accountLabel: g.accountLabel,
        symbol: g.symbol,
        direction: g.direction,
        entry: g.entry,
        sl: g.sl,
        tp1: g.tp1,
        tp2: g.tp2,
        tp3: g.tp3,
      });
      return true;
    });
  }
}
