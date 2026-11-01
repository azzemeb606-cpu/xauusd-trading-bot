/**
 * shared/types.ts — Shared Types & Constants between Backend and Frontend
 */

export type Direction = 'BUY' | 'SELL';
export type TradeBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
export type SessionLabel = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'UNKNOWN';
export type WhaleFlow = 'BUYING' | 'SELLING' | 'NEUTRAL' | 'UNKNOWN';
export type GateStatus = 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';
export type OverallGateStatus = 'PASS' | 'TRADE_BLOCKED' | 'UNKNOWN';
export type ZoneStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'UNKNOWN';

export type AccountKey = 'demo' | 'live';
export type TradingMode = 'DEMO_ONLY' | 'LIVE_ONLY' | 'DUAL_MIRROR';
export type OrderKind = 'MARKET' | 'LIMIT';
export type ConfluenceMode = 'STRICT' | 'NO_CONFLICT' | 'OFF';

export interface SpotPrice {
  bid: number | null;
  ask: number | null;
  spread: number | null;
  mid: number | null;
  at: number;
}

export interface ExecutionGate {
  name: string;
  label: string;
  status: GateStatus;
  value?: string;
}

export interface ExecutionGates {
  overall: OverallGateStatus;
  healthPct: number | null;
  gates: ExecutionGate[];
  rawText: string;
}

export interface FusionVerdict {
  bias: TradeBias;
  confidence: number | null;
  alignedBrains: number | null;
  rawText: string;
}

export interface TradeSetup {
  direction: Direction;
  zoneLabel: string;
  zoneStrength: ZoneStrength;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  anchorPrice: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  rr: number | null;
  id: string;
}

export interface ZoneLadder {
  currentSession: SessionLabel;
  whaleFlow: WhaleFlow;
  whaleConfidence: number | null;
  nextKeyLevel: number | null;
  ladderLevels: Array<{ price: number; label: string; type: 'support' | 'resistance' | 'pivot' | 'unknown' }>;
}

export interface RadarSnapshot {
  at: number;
  spot: SpotPrice;
  fusion: FusionVerdict;
  execution: ExecutionGates;
  buySetup: TradeSetup | null;
  sellSetup: TradeSetup | null;
  zoneLadder: ZoneLadder;
  rawExcerpt: string;
}

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

export interface AccountSnapshot {
  key: string;
  label: string;
  symbol: string;
  connected: boolean;
  tradingEnabled: boolean;
  info: AccountInfo | null;
  positions: BrokerPosition[];
  orders: any[];
  floating: number;
  dayStartEquity: number | null;
  dailyDdPct: number;
  todayRealized: number;
  todayRealizedPct?: number;
  todayTrades: number;
  error: string | null;
  updatedAt: number;
}

export type GroupStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'FAILED';

export interface TradeLeg {
  tpLevel: number;
  volume: number;
  tp: number;
  clientId: string;
  orderId?: string;
  positionId?: string;
  status: string;
  openPrice?: number;
  closePrice?: number;
  profit?: number;
  closeReason?: string;
  error?: string;
}

export interface TradeGroup {
  id: string;
  signalId: string;
  account: string;
  accountLabel: string;
  symbol: string;
  direction: Direction;
  kind: string;
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

export interface RuntimeSettings {
  autoTrading: boolean;
  killSwitch: boolean;
  tradingMode: string;
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
  confluenceMode: string;
  sessionWindows: string;
  blackoutWindows: string;
  maxOpenGroups: number;
  maxDailyDrawdownPct: number;
  dailyDdWarnPct: number;
  cooldownAfterLossMin: number;
  minMarginLevel: number;
  orderTypePreference: string;
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
  tpExecutionStyle?: 'SPLIT_ORDERS' | 'SINGLE_ORDER_PARTIAL';
}

export interface StoredEvent {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  at: number;
}
