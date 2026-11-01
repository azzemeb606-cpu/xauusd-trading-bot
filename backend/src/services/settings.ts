import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { env, liveTradingAllowed } from '../config/env';
import type { Store } from '../db/store';
import { parseWindows } from '../engine/gates';
import type { RuntimeSettings } from '../types';

const KEY = 'runtime_settings';

export function defaultsFromEnv(): RuntimeSettings {
  return {
    autoTrading: env.AUTO_TRADING,
    killSwitch: false,
    tradingMode: env.TRADING_MODE,
    riskPercent: env.RISK_PERCENT,
    fixedLot: env.FIXED_LOT,
    maxLot: env.MAX_LOT,
    tpSplit: env.TP_SPLIT.map(Number),
    minRR: env.MIN_RR,
    minSlDistance: env.MIN_SL_DISTANCE,
    maxSlDistance: env.MAX_SL_DISTANCE,
    maxSpread: env.MAX_SPREAD,
    maxEntryDeviation: env.MAX_ENTRY_DEVIATION,
    signalMaxAgeSec: env.SIGNAL_MAX_AGE_SECONDS,
    confluenceMode: env.CONFLUENCE_MODE,
    sessionWindows: env.SESSION_WINDOWS,
    blackoutWindows: env.BLACKOUT_WINDOWS,
    maxOpenGroups: env.MAX_OPEN_GROUPS,
    maxDailyDrawdownPct: env.MAX_DAILY_DRAWDOWN_PCT,
    dailyDdWarnPct: env.DAILY_DD_WARN_PCT,
    cooldownAfterLossMin: env.COOLDOWN_AFTER_LOSS_MIN,
    minMarginLevel: env.MIN_MARGIN_LEVEL,
    orderTypePreference: env.ORDER_TYPE_PREFERENCE,
    pendingExpiryMin: env.PENDING_EXPIRY_MINUTES,
    beBuffer: env.BE_BUFFER,
    moveBeOnTp1: env.MOVE_BE_ON_TP1,
    trailToTp1OnTp2: env.TRAIL_TO_TP1_ON_TP2,
    notifyGateBlocks: env.NOTIFY_GATE_BLOCKS,
    minFusionConfidence: env.MIN_FUSION_CONFIDENCE,
    minBrainsAgreement: env.MIN_BRAINS_AGREEMENT,
    maxLimitProximity: env.MAX_LIMIT_PROXIMITY,
    allowPendingOrders: env.ALLOW_PENDING_ORDERS,
    newsBlackoutMin: env.NEWS_BLACKOUT_MIN,
    tpExecutionStyle: (process.env.TP_EXECUTION_STYLE as any) || 'SPLIT_ORDERS',
  };
}

const windowStr = z.string().refine((v) => {
  try {
    parseWindows(v);
    return true;
  } catch {
    return false;
  }
}, 'Invalid window list, expected e.g. "07:00-20:00,22:00-23:30"');

export const settingsPatchSchema = z
  .object({
    autoTrading: z.boolean(),
    killSwitch: z.boolean(),
    tradingMode: z.enum(['DEMO_ONLY', 'LIVE_ONLY', 'DUAL_MIRROR']),
    riskPercent: z.number().min(0.01).max(10),
    fixedLot: z.number().min(0).max(100),
    maxLot: z.number().min(0.01).max(100),
    tpSplit: z.array(z.number().min(0)).min(1).max(3),
    minRR: z.number().min(0).max(20),
    minSlDistance: z.number().min(0),
    maxSlDistance: z.number().min(0.1),
    maxSpread: z.number().min(0),
    maxEntryDeviation: z.number().min(0),
    signalMaxAgeSec: z.number().int().min(10),
    confluenceMode: z.enum(['STRICT', 'NO_CONFLICT', 'OFF']),
    sessionWindows: windowStr,
    blackoutWindows: z.string().refine((v) => v.trim() === '' || windowStr.safeParse(v).success, 'Invalid blackout windows'),
    maxOpenGroups: z.number().int().min(1).max(20),
    maxDailyDrawdownPct: z.number().min(0.1).max(100),
    dailyDdWarnPct: z.number().min(0.1).max(100),
    cooldownAfterLossMin: z.number().min(0),
    minMarginLevel: z.number().min(0),
    orderTypePreference: z.enum(['AUTO', 'MARKET', 'LIMIT']),
    pendingExpiryMin: z.number().int().min(1).max(1440),
    beBuffer: z.number().min(0),
    moveBeOnTp1: z.boolean(),
    trailToTp1OnTp2: z.boolean(),
    notifyGateBlocks: z.boolean(),
    minFusionConfidence: z.number().min(0).max(100),
    minBrainsAgreement: z.number().int().min(1).max(9),
    maxLimitProximity: z.number().min(1).max(100),
    allowPendingOrders: z.boolean(),
    newsBlackoutMin: z.number().int().min(0).max(120),
    tpExecutionStyle: z.enum(['SPLIT_ORDERS', 'SINGLE_ORDER_PARTIAL']),
  })
  .partial()
  .strict();

export class SettingsService extends EventEmitter {
  private current: RuntimeSettings;

  constructor(private store: Store) {
    super();
    const saved = store.getKv<Partial<RuntimeSettings>>(KEY) ?? {};
    this.current = this.enforce({ ...defaultsFromEnv(), ...saved });
  }

  get(): RuntimeSettings {
    return { ...this.current, tpSplit: [...this.current.tpSplit] };
  }

  update(patch: unknown): RuntimeSettings {
    const parsed = settingsPatchSchema.parse(patch);
    if (parsed.tradingMode && parsed.tradingMode !== 'DEMO_ONLY' && !liveTradingAllowed) {
      throw new Error('Live trading is locked. Set LIVE_TRADING_ENABLED=true and LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK on the server.');
    }
    this.current = this.enforce({ ...this.current, ...parsed });
    this.store.setKv(KEY, this.current);
    this.emit('change', this.get());
    return this.get();
  }

  /** Server-side safety rails that the dashboard can never override. */
  private enforce(s: RuntimeSettings): RuntimeSettings {
    if (!liveTradingAllowed && s.tradingMode !== 'DEMO_ONLY') s.tradingMode = 'DEMO_ONLY';
    if (s.maxSlDistance < s.minSlDistance) s.maxSlDistance = s.minSlDistance;
    return s;
  }
}
