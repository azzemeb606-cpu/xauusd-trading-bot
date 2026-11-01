export type Direction = 'BUY' | 'SELL';
export type OrderKind = 'MARKET' | 'LIMIT';
export type AccountKey = 'demo' | 'live';
export type TradingMode = 'DEMO_ONLY' | 'LIVE_ONLY' | 'DUAL_MIRROR';
export type ConfluenceMode = 'STRICT' | 'NO_CONFLICT' | 'OFF';
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

/** A normalised trade setup extracted from the Bond 007 radar page. */
export interface Signal {
  id: string;
  source: 'radar';
  direction: Direction;
  /** Order type hinted by the source (LIMIT if the page says "limit"/"zone"). */
  hintedKind: OrderKind | null;
  entry: number;
  entryLow?: number;
  entryHigh?: number;
  anchorPrice?: number;
  sl: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  detectedAt: number;
  rawExcerpt: string;
}

/** Secondary market context from the main live chart page. */
export interface MarketContext {
  bias: Bias;
  price: number | null;
  at: number;
  rawExcerpt: string;
}

export type SignalStatus = 'NEW' | 'BLOCKED' | 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'EXPIRED';

export interface GateResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface Quote {
  bid: number;
  ask: number;
  time: number;
}

export interface RuntimeSettings {
  autoTrading: boolean;
  killSwitch: boolean;
  tradingMode: TradingMode;
  riskPercent: number;
  fixedLot: number;
  maxLot: number;
  tpSplit: number[];
  minRR: number;
  minSlDistance: number;
  maxSlDistance: number;
  maxSpread: number;
  maxEntryDeviation: number;
  signalMaxAgeSec: number;
  confluenceMode: ConfluenceMode;
  sessionWindows: string;
  blackoutWindows: string;
  maxOpenGroups: number;
  maxDailyDrawdownPct: number;
  dailyDdWarnPct: number;
  cooldownAfterLossMin: number;
  minMarginLevel: number;
  orderTypePreference: 'AUTO' | OrderKind;
  pendingExpiryMin: number;
  beBuffer: number;
  moveBeOnTp1: boolean;
  trailToTp1OnTp2: boolean;
  notifyGateBlocks: boolean;
  minFusionConfidence: number;
  minBrainsAgreement: number;
  maxLimitProximity: number;
  allowPendingOrders: boolean;
  newsBlackoutMin: number;
  tpExecutionStyle: 'SPLIT_ORDERS' | 'SINGLE_ORDER_PARTIAL';
}

export type LegStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'FAILED';
export type GroupStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'FAILED';
export type CloseReason = 'TP' | 'SL' | 'MANUAL' | 'EXPIRED' | 'OTHER';

export interface TradeLeg {
  tpLevel: 1 | 2 | 3;
  volume: number;
  tp: number;
  clientId: string;
  orderId?: string;
  positionId?: string;
  status: LegStatus;
  openPrice?: number;
  closePrice?: number;
  profit?: number;
  closeReason?: CloseReason;
  error?: string;
  missingTicks?: number;
}

export interface TradeGroup {
  id: string;
  signalId: string;
  account: AccountKey;
  accountLabel: string;
  symbol: string;
  direction: Direction;
  kind: OrderKind;
  entry: number;
  sl: number;
  currentSl: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  legs: TradeLeg[];
  status: GroupStatus;
  beMoved: boolean;
  trailedToTp1: boolean;
  createdAt: number;
  openedAt?: number;
  closedAt?: number;
  expiresAt?: number;
  realizedPnl: number;
}

export type AlertType =
  | 'SYSTEM_STARTED'
  | 'SETUP_FORMED'
  | 'GATES_BLOCKED'
  | 'ORDER_PLACED'
  | 'TRADE_OPENED'
  | 'TP_HIT'
  | 'BE_MOVED'
  | 'SL_TRAILED'
  | 'TRADE_CLOSED'
  | 'ORDER_CANCELLED'
  | 'TRADE_FAILED'
  | 'DRAWDOWN_WARNING'
  | 'DRAWDOWN_LIMIT'
  | 'FEED_DOWN'
  | 'FEED_RESTORED'
  | 'ACCOUNT_DISCONNECTED'
  | 'ACCOUNT_RECONNECTED'
  | 'KILL_SWITCH'
  | 'TEST';

export type Severity = 'info' | 'success' | 'warning' | 'critical';

export interface AlertEvent {
  type: AlertType;
  severity: Severity;
  data: Record<string, unknown>;
  /** Optional de-duplication key; identical keys within the cooldown are dropped. */
  dedupeKey?: string;
}
