import { logger } from '../lib/logger';
import { errMsg, round } from '../lib/utils';
import type { AccountKey, Direction, Quote } from '../types';
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

export interface LocalMT5Config {
  baseUrl: string;
  key: AccountKey;
  label: string;
  symbol: string;
  login?: number;
  password?: string;
  server?: string;
  timeoutMs?: number;
}

/**
 * LocalMT5Adapter connects the bot to a local Python MetaTrader5 process
 * running on the host machine or a Windows VPS via HTTP REST.
 *
 * This provides zero-cloud, 100% free broker execution without MetaApi subscription.
 */
export class LocalMT5Adapter implements Broker {
  readonly key: AccountKey;
  readonly label: string;
  readonly symbol: string;
  private baseUrl: string;
  private connected = false;
  private specCache: { spec: SymbolSpec; at: number } | null = null;
  private timeoutMs: number;
  private login?: number;
  private password?: string;
  private server?: string;

  constructor(cfg: LocalMT5Config) {
    this.key = cfg.key;
    this.label = cfg.label;
    this.symbol = cfg.symbol;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.login = cfg.login;
    this.password = cfg.password;
    this.server = cfg.server;
    this.timeoutMs = cfg.timeoutMs ?? 5_000;
  }

  private async request<T = any>(
    path: string,
    options: { method?: string; body?: any; timeout?: number } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout ?? this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Account-Key': this.key,
          Accept: 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Local MT5 HTTP ${res.status}: ${text || res.statusText}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async connect(): Promise<void> {
    try {
      const initPayload = this.login
        ? { login: this.login, password: this.password, server: this.server, symbol: this.symbol }
        : { symbol: this.symbol };

      const res = await this.request<{ ok: boolean; message?: string }>('/connect', {
        method: 'POST',
        body: initPayload,
      });

      if (!res.ok) {
        throw new Error(res.message || 'Failed to connect to local MT5 terminal');
      }

      this.connected = true;
      logger.info({ account: this.key, label: this.label }, 'Local MT5 connected successfully');
    } catch (e) {
      this.connected = false;
      throw new Error(`Local MT5 connection error: ${errMsg(e)}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const data = await this.request<any>('/account');
    return {
      balance: round(data.balance ?? 0, 2),
      equity: round(data.equity ?? 0, 2),
      margin: round(data.margin ?? 0, 2),
      freeMargin: round(data.freeMargin ?? data.margin_free ?? 0, 2),
      marginLevel: data.marginLevel ?? data.margin_level ?? null,
      currency: data.currency ?? 'USD',
      leverage: data.leverage,
      name: data.name ?? this.label,
      server: data.server,
      broker: data.company ?? data.broker ?? 'Local MT5',
      platform: 'MT5',
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const list = await this.request<any[]>(`/positions?symbol=${encodeURIComponent(this.symbol)}`);
    return (list ?? []).map((p) => ({
      id: String(p.ticket ?? p.id),
      symbol: p.symbol ?? this.symbol,
      type: (p.type === 0 || p.type === 'BUY' ? 'BUY' : 'SELL') as Direction,
      volume: round(p.volume ?? 0, 2),
      openPrice: p.price_open ?? p.openPrice,
      currentPrice: p.price_current ?? p.currentPrice,
      stopLoss: p.sl ?? p.stopLoss,
      takeProfit: p.tp ?? p.takeProfit,
      profit: round(p.profit ?? 0, 2),
      swap: round(p.swap ?? 0, 2),
      commission: round(p.commission ?? 0, 2),
      time: p.time ? new Date(p.time * 1000).toISOString() : new Date().toISOString(),
      comment: p.comment,
      clientId: p.clientId ?? (p.magic ? String(p.magic) : undefined),
    }));
  }

  async getOrders(): Promise<BrokerOrder[]> {
    const list = await this.request<any[]>(`/orders?symbol=${encodeURIComponent(this.symbol)}`);
    return (list ?? []).map((o) => ({
      id: String(o.ticket ?? o.id),
      symbol: o.symbol ?? this.symbol,
      type: String(o.type_str ?? o.type),
      volume: round(o.volume_current ?? o.volume ?? 0, 2),
      openPrice: o.price_open ?? o.openPrice,
      stopLoss: o.sl ?? o.stopLoss,
      takeProfit: o.tp ?? o.takeProfit,
      clientId: o.clientId ?? (o.magic ? String(o.magic) : undefined),
    }));
  }

  async getQuote(): Promise<Quote> {
    const res = await this.request<{ bid: number; ask: number; time?: number }>(
      `/quote?symbol=${encodeURIComponent(this.symbol)}`,
    );
    return {
      bid: res.bid,
      ask: res.ask,
      time: res.time ? res.time * 1000 : Date.now(),
    };
  }

  async getSpec(): Promise<SymbolSpec> {
    if (this.specCache && Date.now() - this.specCache.at < 3_600_000) {
      return this.specCache.spec;
    }

    const data = await this.request<any>(`/spec?symbol=${encodeURIComponent(this.symbol)}`);
    const spec: SymbolSpec = {
      contractSize: data.trade_contract_size ?? data.contractSize ?? 100,
      minVolume: data.volume_min ?? data.minVolume ?? 0.01,
      maxVolume: data.volume_max ?? data.maxVolume ?? 50.0,
      volumeStep: data.volume_step ?? data.volumeStep ?? 0.01,
      digits: data.digits ?? 2,
    };

    this.specCache = { spec, at: Date.now() };
    return spec;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<TradeResult> {
    try {
      const res = await this.request<any>('/order', {
        method: 'POST',
        body: {
          symbol: this.symbol,
          direction: req.direction,
          kind: req.kind,
          volume: req.volume,
          price: req.price,
          sl: req.sl,
          tp: req.tp,
          comment: req.comment,
          clientId: req.clientId,
          expiresAt: req.expiresAt?.toISOString(),
        },
      });

      return {
        ok: !!res.ok,
        orderId: res.orderId ? String(res.orderId) : undefined,
        positionId: res.positionId ? String(res.positionId) : undefined,
        code: res.code ?? (res.ok ? 'TRADE_RETCODE_DONE' : 'FAILED'),
        message: res.message ?? (res.ok ? 'Order placed' : 'Order rejected'),
      };
    } catch (e) {
      return { ok: false, code: 'NETWORK_ERROR', message: errMsg(e) };
    }
  }

  async modifyPosition(positionId: string, sl: number, tp: number): Promise<TradeResult> {
    try {
      const res = await this.request<any>('/position/modify', {
        method: 'POST',
        body: { ticket: Number(positionId), sl, tp },
      });
      return {
        ok: !!res.ok,
        code: res.code,
        message: res.message ?? (res.ok ? 'Modified' : 'Modify failed'),
      };
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    }
  }

  async cancelOrder(orderId: string): Promise<TradeResult> {
    try {
      const res = await this.request<any>('/order/cancel', {
        method: 'POST',
        body: { ticket: Number(orderId) },
      });
      return {
        ok: !!res.ok,
        code: res.code,
        message: res.message ?? (res.ok ? 'Cancelled' : 'Cancel failed'),
      };
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    }
  }

  async closePosition(positionId: string, volume?: number): Promise<TradeResult> {
    try {
      const res = await this.request<any>('/position/close', {
        method: 'POST',
        body: { ticket: Number(positionId), volume },
      });
      return {
        ok: !!res.ok,
        code: res.code,
        message: res.message ?? (res.ok ? 'Closed' : 'Close failed'),
      };
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    }
  }

  async getPositionClose(positionId: string): Promise<ClosedDeal | null> {
    try {
      const res = await this.request<any>(`/positions/${positionId}/close`);
      if (!res || !res.deal) return null;
      const d = res.deal;
      return {
        positionId: String(d.position_id ?? positionId),
        symbol: d.symbol ?? this.symbol,
        type: d.type === 0 ? 'BUY' : 'SELL',
        volume: d.volume,
        price: d.price,
        profit: round((d.profit ?? 0) + (d.swap ?? 0) + (d.commission ?? 0), 2),
        reason: d.reason === 3 ? 'TP' : d.reason === 4 ? 'SL' : 'MANUAL',
        time: d.time ? new Date(d.time * 1000).toISOString() : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async getClosedDealsSince(since: Date): Promise<ClosedDeal[]> {
    try {
      const list = await this.request<any[]>(`/deals?since=${Math.floor(since.getTime() / 1000)}`);
      return (list ?? []).map((d) => ({
        positionId: String(d.position_id ?? d.ticket),
        symbol: d.symbol ?? this.symbol,
        type: d.type === 0 ? 'BUY' : 'SELL',
        volume: d.volume,
        price: d.price,
        profit: round((d.profit ?? 0) + (d.swap ?? 0) + (d.commission ?? 0), 2),
        reason: d.reason === 3 ? 'TP' : d.reason === 4 ? 'SL' : 'MANUAL',
        time: d.time ? new Date(d.time * 1000).toISOString() : new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
