import { EventEmitter } from 'node:events';
import { env } from '../config/env';
import type { Store } from '../db/store';
import type { BrokerManager } from '../broker/manager';
import type { AccountInfo, Broker, BrokerOrder, BrokerPosition, ClosedDeal } from '../broker/types';
import { logger } from '../lib/logger';
import { dayKey, errMsg, round, sleep, startOfDay } from '../lib/utils';
import type { Notifier } from '../notify/notifier';
import type { SettingsService } from './settings';
import type { AccountKey } from '../types';

export interface AccountSnapshot {
  key: AccountKey;
  label: string;
  symbol: string;
  connected: boolean;
  tradingEnabled: boolean;
  info: AccountInfo | null;
  positions: BrokerPosition[];
  orders: BrokerOrder[];
  floating: number;
  dayStartEquity: number | null;
  dailyDdPct: number;
  todayRealized: number;
  todayRealizedPct: number;
  todayTrades: number;
  history: ClosedDeal[];
  error: string | null;
  updatedAt: number;
}

/** Polls every account (demo + live) for balance/equity/margin/positions/history. */
export class AccountMonitor extends EventEmitter {
  readonly snapshots = new Map<AccountKey, AccountSnapshot>();
  private stopped = false;
  private lastHistoryAt = new Map<AccountKey, number>();
  private lastPersistAt = 0;
  private alerted = new Set<string>();

  constructor(
    private brokers: BrokerManager,
    private store: Store,
    private notifier: Notifier,
    private settings: SettingsService,
  ) {
    super();
  }

  start() {
    void this.loop();
  }

  stop() {
    this.stopped = true;
  }

  private async loop() {
    while (!this.stopped) {
      const started = Date.now();
      await Promise.all(this.brokers.all().map((b) => this.poll(b)));
      if (Date.now() - this.lastPersistAt > 60_000) {
        this.lastPersistAt = Date.now();
        for (const s of this.snapshots.values()) {
          if (s.info) this.store.insertSnapshot(s.key, { balance: s.info.balance, equity: s.info.equity, margin: s.info.margin, floating: s.floating });
        }
        this.store.pruneSnapshots(Date.now() - 30 * 86_400_000);
      }
      this.emit('update', this.list());
      await sleep(Math.max(500, env.ACCOUNT_POLL_MS - (Date.now() - started)));
    }
  }

  list(): AccountSnapshot[] {
    return [...this.snapshots.values()];
  }

  private async poll(b: Broker) {
    const prev = this.snapshots.get(b.key);
    const tradingEnabled = this.brokers.tradeTargets(this.settings.get()).includes(b);
    const base: AccountSnapshot = prev ?? {
      key: b.key,
      label: b.label,
      symbol: b.symbol,
      connected: false,
      tradingEnabled,
      info: null,
      positions: [],
      orders: [],
      floating: 0,
      dayStartEquity: null,
      dailyDdPct: 0,
      todayRealized: 0,
      todayRealizedPct: 0,
      todayTrades: 0,
      history: [],
      error: null,
      updatedAt: 0,
    };
    if (!b.isConnected()) {
      this.snapshots.set(b.key, { ...base, connected: false, tradingEnabled, error: base.error ?? 'Connecting…' });
      return;
    }
    try {
      const [info, positions, orders] = await Promise.all([b.getAccountInfo(), b.getPositions(), b.getOrders()]);
      const floating = round(positions.reduce((a, p) => a + p.profit + p.swap + p.commission, 0), 2);
      const now = new Date();
      const day = dayKey(now, env.DAY_RESET_TZ);
      let dayStart = this.store.getDayStart(b.key, day);
      if (dayStart === null) {
        this.store.setDayStart(b.key, day, info.equity);
        dayStart = info.equity;
      }
      const dd = dayStart > 0 ? Math.max(0, ((dayStart - info.equity) / dayStart) * 100) : 0;

      let { history, todayRealized, todayTrades } = base;
      if (Date.now() - (this.lastHistoryAt.get(b.key) ?? 0) > 60_000) {
        this.lastHistoryAt.set(b.key, Date.now());
        try {
          history = (await b.getClosedDealsSince(new Date(Date.now() - 7 * 86_400_000))).sort((x, y) => y.time.localeCompare(x.time)).slice(0, 200);
          const dayStartTime = startOfDay(now, env.DAY_RESET_TZ).getTime();
          const today = history.filter((d) => new Date(d.time).getTime() >= dayStartTime);
          todayRealized = round(today.reduce((a, d) => a + d.profit, 0), 2);
          todayTrades = today.length;
        } catch (e) {
          logger.warn({ account: b.key, err: errMsg(e) }, 'History fetch failed');
        }
      }

      const todayRealizedPct = dayStart > 0 ? round((todayRealized / dayStart) * 100, 2) : 0;

      const snap: AccountSnapshot = {
        ...base,
        connected: true,
        tradingEnabled,
        info,
        positions,
        orders,
        floating,
        dayStartEquity: dayStart,
        dailyDdPct: round(dd, 2),
        history,
        todayRealized,
        todayRealizedPct,
        todayTrades,
        error: null,
        updatedAt: Date.now(),
      };
      this.snapshots.set(b.key, snap);
      this.checkDrawdown(snap, day);
    } catch (e) {
      logger.warn({ account: b.key, err: errMsg(e) }, 'Account poll failed');
      this.snapshots.set(b.key, { ...base, tradingEnabled, error: errMsg(e) });
    }
  }

  private checkDrawdown(s: AccountSnapshot, day: string) {
    const cfg = this.settings.get();
    const fire = (kind: 'warn' | 'limit') => {
      const k = `${kind}-${s.key}-${day}`;
      if (this.alerted.has(k)) return;
      this.alerted.add(k);
      this.notifier.notify(
        kind === 'warn'
          ? { type: 'DRAWDOWN_WARNING', severity: 'warning', data: { accountLabel: s.label, ddPct: s.dailyDdPct, warnPct: cfg.dailyDdWarnPct, equity: s.info?.equity } }
          : { type: 'DRAWDOWN_LIMIT', severity: 'critical', data: { accountLabel: s.label, ddPct: s.dailyDdPct, maxPct: cfg.maxDailyDrawdownPct } },
      );
    };
    if (s.dailyDdPct >= cfg.maxDailyDrawdownPct) {
      fire('limit');
      if (cfg.autoTrading) {
        logger.warn(
          { account: s.key, ddPct: s.dailyDdPct, limit: cfg.maxDailyDrawdownPct },
          'KILL-SWITCH ACTIVATED: Max daily drawdown limit reached. Pausing auto-trading for safety.',
        );
        this.settings.update({ autoTrading: false });
      }
    } else if (s.dailyDdPct >= cfg.dailyDdWarnPct) {
      fire('warn');
    }
  }
}
