import type { AccountKey, CloseReason, Direction, OrderKind, Quote } from '../types';

export interface AccountInfo {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number | null;
  currency: string;
  leverage?: number;
  name?: string;
  server?: string;
  broker?: string;
  platform?: string;
}

export interface BrokerPosition {
  id: string;
  symbol: string;
  type: Direction;
  volume: number;
  openPrice: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  profit: number;
  swap: number;
  commission: number;
  time: string;
  comment?: string;
  clientId?: string;
}

export interface BrokerOrder {
  id: string;
  symbol: string;
  type: string;
  volume: number;
  openPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientId?: string;
}

export interface ClosedDeal {
  positionId: string;
  symbol?: string;
  type?: string;
  volume?: number;
  price: number;
  /** Net profit = profit + swap + commission. */
  profit: number;
  reason: CloseReason;
  time: string;
}

export interface SymbolSpec {
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  digits: number;
}

export interface PlaceOrderRequest {
  direction: Direction;
  kind: OrderKind;
  volume: number;
  price?: number;
  sl: number;
  tp: number;
  comment: string;
  clientId: string;
  expiresAt?: Date;
}

export interface TradeResult {
  ok: boolean;
  orderId?: string;
  positionId?: string;
  code?: string;
  message: string;
}

export interface Broker {
  readonly key: AccountKey;
  readonly label: string;
  readonly symbol: string;
  connect(): Promise<void>;
  isConnected(): boolean;
  getAccountInfo(): Promise<AccountInfo>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(): Promise<BrokerOrder[]>;
  getQuote(): Promise<Quote>;
  getSpec(): Promise<SymbolSpec>;
  placeOrder(req: PlaceOrderRequest): Promise<TradeResult>;
  modifyPosition(positionId: string, sl: number, tp: number): Promise<TradeResult>;
  cancelOrder(orderId: string): Promise<TradeResult>;
  closePosition(positionId: string, volume?: number): Promise<TradeResult>;
  /** Returns the closing deal for a position, or null if not (yet) in history. */
  getPositionClose(positionId: string): Promise<ClosedDeal | null>;
  /** Closed deals (exits) since the given time — used for daily P&L and history. */
  getClosedDealsSince(since: Date): Promise<ClosedDeal[]>;
  disconnect(): Promise<void>;
}
