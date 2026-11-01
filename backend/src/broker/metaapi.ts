import MetaApi from 'metaapi.cloud-sdk';
import { logger } from '../lib/logger';
import { errMsg, withTimeout } from '../lib/utils';
import type { AccountKey, CloseReason, Quote } from '../types';
import type {
  AccountInfo,
  Broker,
  BrokerOrder,
  BrokerPosition,
  ClosedDeal,
  PlaceOrderRequest,
  SymbolSpec,
  TradeResult,
} from './types';

const OK_CODES = new Set(['TRADE_RETCODE_DONE', 'TRADE_RETCODE_PLACED', 'TRADE_RETCODE_DONE_PARTIAL', 'ERR_NO_ERROR']);
const EXIT_ENTRIES = new Set(['DEAL_ENTRY_OUT', 'DEAL_ENTRY_INOUT', 'DEAL_ENTRY_OUT_BY']);
const CALL_TIMEOUT = 20_000;

let sharedApi: any = null;
export function getMetaApi(token: string, domain?: string): any {
  if (!sharedApi) sharedApi = new (MetaApi as any)(token, domain ? { domain } : {});
  return sharedApi;
}

function mapReason(deal: any): CloseReason {
  const r = String(deal.reason ?? '');
  const c = String(deal.comment ?? '').toLowerCase();
  if (r === 'DEAL_REASON_TP' || c.includes('[tp]')) return 'TP';
  if (r === 'DEAL_REASON_SL' || c.includes('[sl]')) return 'SL';
  if (['DEAL_REASON_CLIENT', 'DEAL_REASON_MOBILE', 'DEAL_REASON_WEB', 'DEAL_REASON_EXPERT'].includes(r)) return 'MANUAL';
  return 'OTHER';
}

const dealsOf = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.deals) ? res.deals : []);
const iso = (t: any) => (t instanceof Date ? t.toISOString() : String(t ?? new Date().toISOString()));

/**
 * MetaApi.cloud RPC connection wrapper for one MT4/MT5 account.
 * RPC (request/response) is used rather than streaming to keep memory small
 * and behaviour predictable for a 24/7 single-instance bot.
 */
export class MetaApiBroker implements Broker {
  private account: any = null;
  private conn: any = null;
  private connected = false;
  private specCache: { spec: SymbolSpec; at: number } | null = null;

  constructor(
    private api: any,
    readonly key: AccountKey,
    readonly label: string,
    private accountId: string,
    readonly symbol: string,
    private magic: number,
  ) {}

  async connect(): Promise<void> {
    const log = logger.child({ account: this.key });
    if (this.conn) {
      try {
        await this.conn.close();
      } catch {
        /* ignore */
      }
      this.conn = null;
    }
    this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);
    if (!['DEPLOYING', 'DEPLOYED'].includes(this.account.state)) {
      log.info('Deploying MetaApi account');
      await this.account.deploy();
    }
    log.info('Waiting for MetaApi account to connect to broker');
    await this.account.waitConnected();
    this.conn = this.account.getRPCConnection();
    await this.conn.connect();
    await this.conn.waitSynchronized();
    this.connected = true;
    log.info({ name: this.account.name, platform: this.account.platform }, 'MetaApi account synchronized');
  }

  isConnected() {
    return this.connected;
  }

  private failures = 0;

  private async call<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.conn) throw new Error(`${this.label}: not connected`);
    try {
      const r = await withTimeout(fn(), CALL_TIMEOUT, `${this.label} ${label}`);
      this.failures = 0;
      return r;
    } catch (e) {
      const msg = errMsg(e);
      // The SDK reconnects internally; only flag as down after repeated failures.
      if (/not connected|disconnected|timeout|NotSynchronized|NotConnected/i.test(msg) && ++this.failures >= 3) this.connected = false;
      throw e;
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const i = await this.call('getAccountInformation', () => this.conn.getAccountInformation());
    this.connected = true;
    return {
      balance: i.balance,
      equity: i.equity,
      margin: i.margin ?? 0,
      freeMargin: i.freeMargin ?? 0,
      marginLevel: i.marginLevel ?? null,
      currency: i.currency,
      leverage: i.leverage,
      name: i.name,
      server: i.server,
      broker: i.broker,
      platform: i.platform,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const list: any[] = await this.call('getPositions', () => this.conn.getPositions());
    return list.map((p) => ({
      id: String(p.id),
      symbol: p.symbol,
      type: p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
      volume: p.volume,
      openPrice: p.openPrice,
      currentPrice: p.currentPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      profit: p.profit ?? 0,
      swap: p.swap ?? 0,
      commission: p.commission ?? 0,
      time: iso(p.time),
      comment: p.comment,
      clientId: p.clientId,
    }));
  }

  async getOrders(): Promise<BrokerOrder[]> {
    const list: any[] = await this.call('getOrders', () => this.conn.getOrders());
    return list.map((o) => ({
      id: String(o.id),
      symbol: o.symbol,
      type: String(o.type).replace('ORDER_TYPE_', ''),
      volume: o.currentVolume ?? o.volume,
      openPrice: o.openPrice,
      stopLoss: o.stopLoss,
      takeProfit: o.takeProfit,
      clientId: o.clientId,
    }));
  }

  async getQuote(): Promise<Quote> {
    const p = await this.call('getSymbolPrice', () => this.conn.getSymbolPrice(this.symbol));
    return { bid: p.bid, ask: p.ask, time: p.time ? new Date(p.time).getTime() : Date.now() };
  }

  async getSpec(): Promise<SymbolSpec> {
    if (this.specCache && Date.now() - this.specCache.at < 3_600_000) return this.specCache.spec;
    const s = await this.call('getSymbolSpecification', () => this.conn.getSymbolSpecification(this.symbol));
    const spec: SymbolSpec = {
      contractSize: s.contractSize ?? 100,
      minVolume: s.minVolume ?? 0.01,
      maxVolume: s.maxVolume ?? 100,
      volumeStep: s.volumeStep ?? 0.01,
      digits: s.digits ?? 2,
    };
    this.specCache = { spec, at: Date.now() };
    return spec;
  }

  private result(r: any): TradeResult {
    const code = r?.stringCode ?? '';
    return {
      ok: OK_CODES.has(code) || (!code && !!(r?.orderId || r?.positionId)),
      orderId: r?.orderId ? String(r.orderId) : undefined,
      positionId: r?.positionId ? String(r.positionId) : undefined,
      code,
      message: r?.message ?? code,
    };
  }

  private failure(e: any): TradeResult {
    return { ok: false, code: e?.stringCode ?? e?.name, message: e?.message ?? errMsg(e) };
  }

  async placeOrder(req: PlaceOrderRequest): Promise<TradeResult> {
    const opts: Record<string, unknown> = { comment: req.comment, clientId: req.clientId, magic: this.magic };
    try {
      let r: any;
      if (req.kind === 'MARKET') {
        r =
          req.direction === 'BUY'
            ? await this.call('marketBuy', () => this.conn.createMarketBuyOrder(this.symbol, req.volume, req.sl, req.tp, opts))
            : await this.call('marketSell', () => this.conn.createMarketSellOrder(this.symbol, req.volume, req.sl, req.tp, opts));
      } else {
        if (req.price === undefined) throw new Error('Limit order requires price');
        if (req.expiresAt) opts.expiration = { type: 'ORDER_TIME_SPECIFIED', time: req.expiresAt };
        r =
          req.direction === 'BUY'
            ? await this.call('limitBuy', () => this.conn.createLimitBuyOrder(this.symbol, req.volume, req.price, req.sl, req.tp, opts))
            : await this.call('limitSell', () => this.conn.createLimitSellOrder(this.symbol, req.volume, req.price, req.sl, req.tp, opts));
      }
      return this.result(r);
    } catch (e) {
      return this.failure(e);
    }
  }

  async modifyPosition(positionId: string, sl: number, tp: number): Promise<TradeResult> {
    try {
      return this.result(await this.call('modifyPosition', () => this.conn.modifyPosition(positionId, sl, tp)));
    } catch (e) {
      return this.failure(e);
    }
  }

  async cancelOrder(orderId: string): Promise<TradeResult> {
    try {
      return this.result(await this.call('cancelOrder', () => this.conn.cancelOrder(orderId)));
    } catch (e) {
      return this.failure(e);
    }
  }

  async closePosition(positionId: string, volume?: number): Promise<TradeResult> {
    try {
      const opts = volume !== undefined && volume > 0 ? { volume } : {};
      return this.result(await this.call('closePosition', () => this.conn.closePosition(positionId, opts)));
    } catch (e) {
      return this.failure(e);
    }
  }

  private toClosed(d: any): ClosedDeal {
    return {
      positionId: String(d.positionId),
      symbol: d.symbol,
      type: d.type,
      volume: d.volume,
      price: d.price,
      profit: (d.profit ?? 0) + (d.swap ?? 0) + (d.commission ?? 0),
      reason: mapReason(d),
      time: iso(d.time),
    };
  }

  async getPositionClose(positionId: string): Promise<ClosedDeal | null> {
    const res = await this.call('getDealsByPosition', () => this.conn.getDealsByPosition(positionId));
    const deals = dealsOf(res);
    const exits = deals.filter((d) => EXIT_ENTRIES.has(d.entryType));
    if (!exits.length) return null;
    // Aggregate partial exits; reason/price from the last exit deal.
    const last = this.toClosed(exits[exits.length - 1]);
    const total = deals.reduce((a, d) => a + (d.profit ?? 0) + (d.swap ?? 0) + (d.commission ?? 0), 0);
    return { ...last, profit: total };
  }

  async getClosedDealsSince(since: Date): Promise<ClosedDeal[]> {
    const res = await this.call('getDealsByTimeRange', () => this.conn.getDealsByTimeRange(since, new Date()));
    return dealsOf(res)
      .filter((d) => EXIT_ENTRIES.has(d.entryType))
      .map((d) => this.toClosed(d));
  }

  async disconnect() {
    try {
      await this.conn?.close?.();
    } catch (e) {
      logger.warn({ err: errMsg(e) }, 'MetaApi close failed');
    }
    this.connected = false;
  }
}
