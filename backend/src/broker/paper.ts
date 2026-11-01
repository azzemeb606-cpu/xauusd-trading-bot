import crypto from 'node:crypto';
import type { Store } from '../db/store';
import { round } from '../lib/utils';
import type { AccountKey, CloseReason, Direction, Quote } from '../types';
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

interface PaperPos {
  id: string;
  type: Direction;
  volume: number;
  openPrice: number;
  sl: number;
  tp: number;
  time: string;
  clientId: string;
  comment: string;
}
interface PaperOrder extends PaperPos {
  expiresAt?: number;
}
interface PaperState {
  balance: number;
  positions: PaperPos[];
  orders: PaperOrder[];
  closed: ClosedDeal[];
}

const CONTRACT = 100;

/**
 * Paper-trading broker that simulates fills against the price scraped from the
 * live chart. Lets you run the full pipeline (gates → orders → TP/BE → alerts)
 * safely before connecting a real MetaApi account.
 */
export class PaperBroker implements Broker {
  readonly label: string;
  private state: PaperState;
  private readonly kvKey: string;

  constructor(
    readonly key: AccountKey,
    readonly symbol: string,
    private priceSource: () => number | null,
    private spread: number,
    startBalance: number,
    private store: Store,
  ) {
    this.label = `Paper ${key === 'demo' ? 'Demo' : 'Live'}`;
    this.kvKey = `paper_state_${key}`;
    this.state = store.getKv<PaperState>(this.kvKey) ?? { balance: startBalance, positions: [], orders: [], closed: [] };
  }

  async connect() {}
  isConnected() {
    return this.priceSource() !== null;
  }
  async disconnect() {}

  private persist() {
    this.state.closed = this.state.closed.slice(-500);
    this.store.setKv(this.kvKey, this.state);
  }

  private quoteNow(): Quote | null {
    const p = this.priceSource();
    if (p === null) return null;
    return { bid: round(p - this.spread / 2, 2), ask: round(p + this.spread / 2, 2), time: Date.now() };
  }

  private pnl(p: PaperPos, q: Quote) {
    const exit = p.type === 'BUY' ? q.bid : q.ask;
    return round((p.type === 'BUY' ? exit - p.openPrice : p.openPrice - exit) * p.volume * CONTRACT, 2);
  }

  private closePos(p: PaperPos, price: number, reason: CloseReason, closeVol?: number) {
    const vol = closeVol && closeVol < p.volume ? closeVol : p.volume;
    const profit = round((p.type === 'BUY' ? price - p.openPrice : p.openPrice - price) * vol * CONTRACT, 2);
    this.state.balance = round(this.state.balance + profit, 2);
    if (vol < p.volume) {
      p.volume = round(p.volume - vol, 2);
    } else {
      this.state.positions = this.state.positions.filter((x) => x.id !== p.id);
    }
    this.state.closed.push({ positionId: p.id, symbol: this.symbol, type: p.type, volume: vol, price, profit, reason, time: new Date().toISOString() });
  }

  /** Simulation step: fill limits, expire orders, trigger SL/TP. */
  private tick() {
    const q = this.quoteNow();
    if (!q) return;
    let changed = false;
    for (const o of [...this.state.orders]) {
      if (o.expiresAt && Date.now() > o.expiresAt) {
        this.state.orders = this.state.orders.filter((x) => x.id !== o.id);
        changed = true;
        continue;
      }
      const fill = o.type === 'BUY' ? q.ask <= o.openPrice : q.bid >= o.openPrice;
      if (fill) {
        this.state.orders = this.state.orders.filter((x) => x.id !== o.id);
        this.state.positions.push({ ...o, time: new Date().toISOString() });
        changed = true;
      }
    }
    for (const p of [...this.state.positions]) {
      const px = p.type === 'BUY' ? q.bid : q.ask;
      const slHit = p.type === 'BUY' ? px <= p.sl : px >= p.sl;
      const tpHit = p.type === 'BUY' ? px >= p.tp : px <= p.tp;
      if (slHit) this.closePos(p, p.sl, 'SL');
      else if (tpHit) this.closePos(p, p.tp, 'TP');
      else continue;
      changed = true;
    }
    if (changed) this.persist();
  }

  async getAccountInfo(): Promise<AccountInfo> {
    this.tick();
    const q = this.quoteNow();
    const floating = q ? this.state.positions.reduce((a, p) => a + this.pnl(p, q), 0) : 0;
    const margin = this.state.positions.reduce((a, p) => a + (p.volume * CONTRACT * p.openPrice) / 100, 0); // 1:100
    const equity = round(this.state.balance + floating, 2);
    return {
      balance: this.state.balance,
      equity,
      margin: round(margin, 2),
      freeMargin: round(equity - margin, 2),
      marginLevel: margin > 0 ? round((equity / margin) * 100, 2) : null,
      currency: 'USD',
      leverage: 100,
      name: this.label,
      server: 'paper',
      broker: 'Simulator',
      platform: 'paper',
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    this.tick();
    const q = this.quoteNow();
    return this.state.positions.map((p) => ({
      id: p.id,
      symbol: this.symbol,
      type: p.type,
      volume: p.volume,
      openPrice: p.openPrice,
      currentPrice: q ? (p.type === 'BUY' ? q.bid : q.ask) : undefined,
      stopLoss: p.sl,
      takeProfit: p.tp,
      profit: q ? this.pnl(p, q) : 0,
      swap: 0,
      commission: 0,
      time: p.time,
      comment: p.comment,
      clientId: p.clientId,
    }));
  }

  async getOrders(): Promise<BrokerOrder[]> {
    this.tick();
    return this.state.orders.map((o) => ({
      id: o.id,
      symbol: this.symbol,
      type: `${o.type}_LIMIT`,
      volume: o.volume,
      openPrice: o.openPrice,
      stopLoss: o.sl,
      takeProfit: o.tp,
      clientId: o.clientId,
    }));
  }

  async getQuote(): Promise<Quote> {
    const q = this.quoteNow();
    if (!q) throw new Error('Paper broker: no price available yet from the live chart');
    return q;
  }

  async getSpec(): Promise<SymbolSpec> {
    return { contractSize: CONTRACT, minVolume: 0.01, maxVolume: 50, volumeStep: 0.01, digits: 2 };
  }

  async placeOrder(req: PlaceOrderRequest): Promise<TradeResult> {
    const q = this.quoteNow();
    if (!q) return { ok: false, message: 'No price' };
    const id = String(Date.now()) + crypto.randomInt(100, 999);
    const base = { id, type: req.direction, volume: req.volume, sl: req.sl, tp: req.tp, time: new Date().toISOString(), clientId: req.clientId, comment: req.comment };
    if (req.kind === 'MARKET') {
      this.state.positions.push({ ...base, openPrice: req.direction === 'BUY' ? q.ask : q.bid });
    } else {
      this.state.orders.push({ ...base, openPrice: req.price!, expiresAt: req.expiresAt?.getTime() });
    }
    this.persist();
    return { ok: true, orderId: id, positionId: id, code: 'TRADE_RETCODE_DONE', message: 'Paper fill' };
  }

  async modifyPosition(positionId: string, sl: number, tp: number): Promise<TradeResult> {
    const p = this.state.positions.find((x) => x.id === positionId);
    if (!p) return { ok: false, message: 'Position not found' };
    p.sl = sl;
    p.tp = tp;
    this.persist();
    return { ok: true, message: 'Modified' };
  }

  async cancelOrder(orderId: string): Promise<TradeResult> {
    this.state.orders = this.state.orders.filter((o) => o.id !== orderId);
    this.persist();
    return { ok: true, message: 'Cancelled' };
  }

  async closePosition(positionId: string, volume?: number): Promise<TradeResult> {
    const p = this.state.positions.find((x) => x.id === positionId);
    const q = this.quoteNow();
    if (!p || !q) return { ok: false, message: 'Position not found or no price' };
    this.closePos(p, p.type === 'BUY' ? q.bid : q.ask, 'MANUAL', volume);
    this.persist();
    return { ok: true, message: volume && volume < p.volume ? 'Partially closed' : 'Closed' };
  }

  async getPositionClose(positionId: string): Promise<ClosedDeal | null> {
    return this.state.closed.find((d) => d.positionId === positionId) ?? null;
  }

  async getClosedDealsSince(since: Date): Promise<ClosedDeal[]> {
    return this.state.closed.filter((d) => new Date(d.time).getTime() >= since.getTime());
  }
}
