import { env, liveTradingAllowed } from '../config/env';
import type { Store } from '../db/store';
import { logger } from '../lib/logger';
import { errMsg, sleep } from '../lib/utils';
import type { Notifier } from '../notify/notifier';
import type { AccountKey, RuntimeSettings } from '../types';
import { MetaApiBroker, getMetaApi } from './metaapi';
import { PaperBroker } from './paper';
import { LocalMT5Adapter } from './local-mt5';
import type { Broker } from './types';

/**
 * Owns the Demo / Live broker connections, keeps them connected 24/7 and
 * resolves which accounts receive orders for the current trading mode.
 * Supports Paper Trading, MetaApi Cloud MT4/MT5, and Local Python MT5 Bridge.
 */
export class BrokerManager {
  readonly brokers: Partial<Record<AccountKey, Broker>> = {};
  private stopped = false;
  private wasConnected: Partial<Record<AccountKey, boolean>> = {};
  private priceSource: () => number | null;

  constructor(
    private store: Store,
    private notifier: Notifier,
    priceSource: () => number | null,
  ) {
    this.priceSource = priceSource;
    this.initBrokers();
  }

  initBrokers() {
    const metaToken = this.store.getKv<string>('metaapi_token') ?? env.METAAPI_TOKEN;
    const demoId = this.store.getKv<string>('demo_account_id') ?? env.DEMO_ACCOUNT_ID;
    const liveId = this.store.getKv<string>('live_account_id') ?? env.LIVE_ACCOUNT_ID;
    const localUrl = this.store.getKv<string>('local_mt5_url') ?? env.LOCAL_MT5_URL;
    const engine = this.store.getKv<string>('execution_engine') ?? env.EXECUTION_ENGINE;

    if (engine === 'paper') {
      this.brokers.demo = new PaperBroker('demo', env.DEMO_SYMBOL, this.priceSource, env.PAPER_SPREAD, env.PAPER_START_BALANCE, this.store);
    } else if (engine === 'local_mt5') {
      this.brokers.demo = new LocalMT5Adapter({
        baseUrl: localUrl,
        key: 'demo',
        label: 'Local MT5 Demo',
        symbol: env.DEMO_SYMBOL,
      });
      if (liveId || env.LIVE_TRADING_ENABLED) {
        this.brokers.live = new LocalMT5Adapter({
          baseUrl: localUrl,
          key: 'live',
          label: 'Local MT5 Live',
          symbol: env.LIVE_SYMBOL,
        });
      }
    } else {
      if (metaToken) {
        const api = getMetaApi(metaToken, env.METAAPI_DOMAIN);
        if (demoId) this.brokers.demo = new MetaApiBroker(api, 'demo', 'Demo', demoId, env.DEMO_SYMBOL, env.MAGIC);
        if (liveId) this.brokers.live = new MetaApiBroker(api, 'live', 'Live', liveId, env.LIVE_SYMBOL, env.MAGIC);
      }
    }
    if (!this.brokers.demo && !this.brokers.live) logger.warn('No trading accounts configured');
  }

  async reconfigure(cfg: {
    engine?: 'paper' | 'metaapi' | 'local_mt5';
    metaToken?: string;
    demoId?: string;
    liveId?: string;
    localUrl?: string;
  }) {
    if (cfg.engine) this.store.setKv('execution_engine', cfg.engine);
    if (cfg.metaToken !== undefined) this.store.setKv('metaapi_token', cfg.metaToken);
    if (cfg.demoId !== undefined) this.store.setKv('demo_account_id', cfg.demoId);
    if (cfg.liveId !== undefined) this.store.setKv('live_account_id', cfg.liveId);
    if (cfg.localUrl !== undefined) this.store.setKv('local_mt5_url', cfg.localUrl);

    // Disconnect old
    await Promise.all(this.all().map((b) => b.disconnect()));
    delete this.brokers.demo;
    delete this.brokers.live;

    this.initBrokers();
    for (const b of this.all()) void this.keepAlive(b);
  }

  all(): Broker[] {
    return Object.values(this.brokers).filter((b): b is Broker => !!b);
  }

  get(key: AccountKey): Broker | undefined {
    return this.brokers[key];
  }

  tradeTargets(s: RuntimeSettings): Broker[] {
    const out: Broker[] = [];
    const wantDemo = s.tradingMode === 'DEMO_ONLY' || s.tradingMode === 'DUAL_MIRROR';
    const wantLive = (s.tradingMode === 'LIVE_ONLY' || s.tradingMode === 'DUAL_MIRROR') && liveTradingAllowed;
    if (wantDemo && this.brokers.demo) out.push(this.brokers.demo);
    if (wantLive && this.brokers.live) out.push(this.brokers.live);
    return out;
  }

  start() {
    for (const b of this.all()) void this.keepAlive(b);
  }

  private async keepAlive(b: Broker) {
    const log = logger.child({ account: b.key });
    while (!this.stopped) {
      if (!b.isConnected()) {
        try {
          await b.connect();
          if (b.isConnected() && env.EXECUTION_ENGINE === 'metaapi') {
            this.notifier.notify({ type: 'ACCOUNT_RECONNECTED', severity: 'success', data: { accountLabel: b.label } });
          }
        } catch (e) {
          log.error({ err: errMsg(e) }, 'Broker connect failed');
          if (env.EXECUTION_ENGINE === 'metaapi') {
            this.notifier.notify({
              type: 'ACCOUNT_DISCONNECTED',
              severity: 'critical',
              data: { accountLabel: b.label, error: errMsg(e) },
              dedupeKey: `disc-${b.key}`,
            });
          }
        }
      } else if (this.wasConnected[b.key] === false && env.EXECUTION_ENGINE === 'metaapi') {
        this.notifier.notify({ type: 'ACCOUNT_RECONNECTED', severity: 'success', data: { accountLabel: b.label } });
      }
      this.wasConnected[b.key] = b.isConnected();
      await sleep(b.isConnected() ? 15_000 : 30_000);
    }
  }

  async stop() {
    this.stopped = true;
    await Promise.all(this.all().map((b) => b.disconnect()));
  }
}
