import { describe, it, expect } from 'vitest';
import { evaluateGates, inWindows, isMarketOpen, weightedRR } from '../src/engine/gates';
import type { GateContext } from '../src/engine/gates';
import type { Signal, RuntimeSettings } from '../src/types';

const baseSignal: Signal = {
  id: 'test-signal-001',
  source: 'radar',
  direction: 'BUY',
  hintedKind: null,
  entry: 3240,
  sl: 3230,
  tp1: 3260,
  tp2: 3280,
  tp3: 3300,
  detectedAt: Date.now(),
  rawExcerpt: '',
};

const baseSettings: RuntimeSettings = {
  autoTrading: true,
  killSwitch: false,
  tradingMode: 'DEMO_ONLY',
  riskPercent: 1,
  fixedLot: 0,
  maxLot: 1,
  tpSplit: [50, 30, 20],
  minRR: 1.2,
  minSlDistance: 2,
  maxSlDistance: 30,
  maxSpread: 0.8,
  maxEntryDeviation: 2,
  signalMaxAgeSec: 600,
  confluenceMode: 'NO_CONFLICT',
  sessionWindows: '00:00-23:59',
  blackoutWindows: '',
  maxOpenGroups: 1,
  maxDailyDrawdownPct: 5,
  dailyDdWarnPct: 3,
  cooldownAfterLossMin: 30,
  minMarginLevel: 300,
  orderTypePreference: 'AUTO',
  pendingExpiryMin: 60,
  beBuffer: 0.3,
  moveBeOnTp1: true,
  trailToTp1OnTp2: true,
  notifyGateBlocks: false,
  minFusionConfidence: 65,
  minBrainsAgreement: 5,
  maxLimitProximity: 15,
  allowPendingOrders: true,
  newsBlackoutMin: 15,
  tpExecutionStyle: 'SPLIT_ORDERS',
};

const baseCtx = (overrides: Partial<GateContext> = {}): GateContext => ({
  signal: baseSignal,
  context: { bias: 'BULLISH', price: 3242, at: Date.now(), rawExcerpt: '' },
  quote: { bid: 3240.5, ask: 3241.0, time: Date.now() },
  settings: baseSettings,
  now: Date.now(),
  feedHealthy: true,
  brokerReady: true,
  openGroups: 0,
  dailyDrawdownPct: 0,
  marginLevel: 500,
  lastLossAt: null,
  plannedVolume: 0.05,
  ...overrides,
});

describe('isMarketOpen()', () => {
  it('returns true on Wednesday UTC', () => {
    // 2026-11-04 is a Wednesday
    expect(isMarketOpen(new Date('2026-11-04T12:00:00Z').getTime())).toBe(true);
  });
  it('returns false on Saturday UTC', () => {
    // 2026-11-07 is a Saturday
    expect(isMarketOpen(new Date('2026-11-07T12:00:00Z').getTime())).toBe(false);
  });
  it('returns false on Sunday before 22:00 UTC', () => {
    expect(isMarketOpen(new Date('2026-11-08T10:00:00Z').getTime())).toBe(false);
  });
  it('returns true on Sunday at 22:00 UTC', () => {
    expect(isMarketOpen(new Date('2026-11-08T22:00:00Z').getTime())).toBe(true);
  });
  it('returns false on Friday at 21:00 UTC', () => {
    expect(isMarketOpen(new Date('2026-11-06T21:00:00Z').getTime())).toBe(false);
  });
});

describe('inWindows()', () => {
  const at = new Date('2026-11-04T14:30:00Z').getTime(); // 14:30 UTC
  it('matches when inside a single window', () => {
    expect(inWindows(at, '07:00-20:00')).toBe(true);
  });
  it('rejects when outside the window', () => {
    expect(inWindows(at, '20:00-22:00')).toBe(false);
  });
  it('matches when inside one of multiple windows', () => {
    expect(inWindows(at, '07:00-11:00,13:00-17:00')).toBe(true);
  });
  it('handles midnight-crossing window', () => {
    const lateNight = new Date('2026-11-04T23:30:00Z').getTime();
    expect(inWindows(lateNight, '22:00-02:00')).toBe(true);
  });
});

describe('weightedRR()', () => {
  it('calculates weighted RR correctly for a BUY signal', () => {
    const rr = weightedRR(baseSignal, 3240, [50, 30, 20]);
    // risk = 10, TP1 reward = 20, TP2 = 40, TP3 = 60
    // weighted = (0.5 * 20 + 0.3 * 40 + 0.2 * 60) / 10 = (10+12+12)/10 = 3.4
    expect(rr).toBeCloseTo(3.4, 1);
  });
  it('returns 0 for zero risk', () => {
    const s = { ...baseSignal, entry: 3240, sl: 3240 };
    expect(weightedRR(s, 3240, [100])).toBe(0);
  });
});

describe('evaluateGates()', () => {
  it('passes all gates in ideal conditions', () => {
    const { passed } = evaluateGates(baseCtx());
    expect(passed).toBe(true);
  });

  it('blocks when autoTrading is off', () => {
    const { passed, results } = evaluateGates(
      baseCtx({ settings: { ...baseSettings, autoTrading: false } }),
    );
    expect(passed).toBe(false);
    expect(results.find((r) => r.id === 'AUTO_TRADING')?.passed).toBe(false);
  });

  it('blocks when kill switch is on', () => {
    const { passed } = evaluateGates(
      baseCtx({ settings: { ...baseSettings, killSwitch: true } }),
    );
    expect(passed).toBe(false);
  });

  it('blocks when feed is unhealthy', () => {
    const { passed } = evaluateGates(baseCtx({ feedHealthy: false }));
    expect(passed).toBe(false);
  });

  it('blocks when signal is too old', () => {
    const old = Date.now() - 700_000;
    const { passed } = evaluateGates(
      baseCtx({ signal: { ...baseSignal, detectedAt: old } }),
    );
    expect(passed).toBe(false);
  });

  it('blocks when daily drawdown exceeds limit', () => {
    const { passed } = evaluateGates(baseCtx({ dailyDrawdownPct: 6 }));
    expect(passed).toBe(false);
  });

  it('blocks when spread is too wide', () => {
    const { passed } = evaluateGates(
      baseCtx({ quote: { bid: 3239, ask: 3241, time: Date.now() } }),
    );
    expect(passed).toBe(false);
  });

  it('blocks when opposing confluence in STRICT mode', () => {
    const { passed } = evaluateGates(
      baseCtx({
        context: { bias: 'BEARISH', price: 3240, at: Date.now(), rawExcerpt: '' },
        settings: { ...baseSettings, confluenceMode: 'STRICT' },
      }),
    );
    expect(passed).toBe(false);
  });

  it('passes with BEARISH bias in NO_CONFLICT mode for SELL signal', () => {
    const sellSignal: Signal = {
      ...baseSignal,
      direction: 'SELL',
      entry: 3260,
      sl: 3270,
      tp1: 3240,
      tp2: 3220,
      tp3: 3200,
    };
    const { passed } = evaluateGates(
      baseCtx({
        signal: sellSignal,
        context: { bias: 'BEARISH', price: 3260, at: Date.now(), rawExcerpt: '' },
        quote: { bid: 3259.5, ask: 3260.0, time: Date.now() },
        settings: { ...baseSettings, confluenceMode: 'NO_CONFLICT' },
      }),
    );
    expect(passed).toBe(true);
  });

  it('blocks when max open groups reached', () => {
    const { passed } = evaluateGates(baseCtx({ openGroups: 1 }));
    expect(passed).toBe(false);
  });

  it('blocks when cooldown has not elapsed', () => {
    const { passed } = evaluateGates(
      baseCtx({ lastLossAt: Date.now() - 10_000 }), // 10 s ago, cooldown = 30 min
    );
    expect(passed).toBe(false);
  });

  it('blocks when SL distance is below minimum', () => {
    const tightSl: Signal = { ...baseSignal, sl: 3239.5 }; // 0.5 < minSlDistance=2
    const { passed } = evaluateGates(baseCtx({ signal: tightSl }));
    expect(passed).toBe(false);
  });

  it('blocks when no quote available', () => {
    const { passed } = evaluateGates(baseCtx({ quote: null }));
    expect(passed).toBe(false);
  });
});
