import { describe, it, expect } from 'vitest';
import { validateSixGates, isNearNewsBlackout } from './validator';
import type { Signal, RuntimeSettings, Quote, TradeGroup } from '../types';
import type { RadarSnapshot } from '../scraper/radar-parser';

describe('isNearNewsBlackout()', () => {
  it('detects when inside or near blackout window', () => {
    // Window is 12:30 to 12:45 UTC
    const inside = new Date('2026-11-04T12:35:00Z').getTime();
    expect(isNearNewsBlackout(inside, '12:30-12:45', 15)).toBe(true);

    // 10 minutes before window (12:20 UTC)
    const tenMinBefore = new Date('2026-11-04T12:20:00Z').getTime();
    expect(isNearNewsBlackout(tenMinBefore, '12:30-12:45', 15)).toBe(true);

    // 40 minutes before window (11:50 UTC)
    const farBefore = new Date('2026-11-04T11:50:00Z').getTime();
    expect(isNearNewsBlackout(farBefore, '12:30-12:45', 15)).toBe(false);
  });
});

describe('Module 2: Strict 6-Gate Trade Criteria Validator', () => {
  const baseSignal: Signal = {
    id: 'test-buy-sig-01',
    source: 'radar',
    direction: 'BUY',
    hintedKind: null,
    entry: 3240,
    entryLow: 3238,
    entryHigh: 3242,
    anchorPrice: 3240,
    sl: 3230,
    tp1: 3255,
    tp2: 3270,
    tp3: 3285,
    detectedAt: Date.now(),
    rawExcerpt: '',
  };

  const baseSnapshot: RadarSnapshot = {
    at: Date.now(),
    spot: { bid: 3239.8, ask: 3240.2, spread: 0.4, mid: 3240, at: Date.now() },
    fusion: {
      bias: 'BULLISH',
      confidence: 72.5,
      alignedBrains: 7,
      rawText: 'FUSION VERDICT: BULLISH 72.5%',
    },
    execution: {
      overall: 'PASS',
      healthPct: 90,
      gates: [
        { name: 'FUSION_CONFIDENCE', label: 'Fusion Confidence', status: 'PASS', value: '72.5%' },
        { name: 'MARKET_EXPANSION', label: 'Market Expansion', status: 'PASS', value: 'EXPANDING' },
        { name: 'DIRECTIONAL_VOTE', label: 'Directional Vote', status: 'PASS' },
        { name: 'RR_MINIMUM', label: 'RR Minimum', status: 'PASS' },
        { name: 'SL_PLACEMENT', label: 'SL Placement', status: 'PASS' },
        { name: 'WHALE_ALIGNMENT', label: 'Whale Alignment', status: 'PASS' },
        { name: 'ENTRY_LOCATION', label: 'Entry Location', status: 'PASS' },
        { name: 'DELIVERY_QUALITY', label: 'Delivery Quality', status: 'PASS' },
        { name: 'ML_CONSENSUS', label: 'ML Consensus', status: 'PASS' },
      ],
      rawText: 'ALL GATES PASS',
    },
    buySetup: null,
    sellSetup: null,
    zoneLadder: {
      currentSession: 'LONDON',
      whaleFlow: 'BUYING',
      whaleConfidence: 85,
      nextKeyLevel: 3260,
      ladderLevels: [],
    },
    rawExcerpt: '',
  };

  const baseQuote: Quote = {
    bid: 3239.8,
    ask: 3240.2, // Live price 3240.2 is inside [3238, 3242]
    time: Date.now(),
  };

  const baseSettings: RuntimeSettings = {
    autoTrading: true,
    killSwitch: false,
    tradingMode: 'DEMO_ONLY',
    riskPercent: 1,
    fixedLot: 0,
    maxLot: 1,
    tpSplit: [50, 30, 20],
    minRR: 1.5,
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

  const createInput = (overrides = {}) => ({
    signal: baseSignal,
    snapshot: baseSnapshot,
    quote: baseQuote,
    settings: baseSettings,
    activeGroups: [] as TradeGroup[],
    lastLossAt: null,
    now: Date.now(),
    ...overrides,
  });

  it('passes all 6 gates simultaneously under ideal criteria', () => {
    const res = validateSixGates(createInput());
    expect(res.allPassed).toBe(true);
    expect(res.orderKind).toBe('MARKET');
    expect(res.gates.gate1Safety.passed).toBe(true);
    expect(res.gates.gate2Fusion.passed).toBe(true);
    expect(res.gates.gate3WhaleSession.passed).toBe(true);
    expect(res.gates.gate4PriceInZone.passed).toBe(true);
    expect(res.gates.gate5RiskRewardSl.passed).toBe(true);
    expect(res.gates.gate6DuplicateCooldown.passed).toBe(true);
  });

  describe('Gate 1: Safety Gate Check', () => {
    it('fails if radar overall status is TRADE_BLOCKED', () => {
      const snap = {
        ...baseSnapshot,
        execution: { ...baseSnapshot.execution, overall: 'TRADE_BLOCKED' as const },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate1Safety.passed).toBe(false);
      expect(res.allPassed).toBe(false);
    });

    it('fails if Market Expansion is CHOP MARKET', () => {
      const snap = {
        ...baseSnapshot,
        execution: {
          ...baseSnapshot.execution,
          gates: baseSnapshot.execution.gates.map((g) =>
            g.name === 'MARKET_EXPANSION' ? { ...g, status: 'FAIL' as const, value: 'CHOP MARKET' } : g
          ),
        },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate1Safety.passed).toBe(false);
      expect(res.gates.gate1Safety.detail).toContain('CHOP');
    });

    it('fails if live spread exceeds maxSpread', () => {
      const highSpreadQuote = { bid: 3239.0, ask: 3240.0, time: Date.now() }; // Spread = $1.00 > max $0.80
      const res = validateSixGates(createInput({ quote: highSpreadQuote }));
      expect(res.gates.gate1Safety.passed).toBe(false);
      expect(res.gates.gate1Safety.detail).toContain('Spread');
    });

    it('fails if within 15 minutes of high-impact USD news window', () => {
      // Set blackout window at 14:00-14:30, and current time is 13:50 (10 min before)
      const now = new Date('2026-11-04T13:50:00Z').getTime();
      const s = { ...baseSettings, blackoutWindows: '14:00-14:30', newsBlackoutMin: 15 };
      const res = validateSixGates(createInput({ settings: s, now }));
      expect(res.gates.gate1Safety.passed).toBe(false);
      expect(res.gates.gate1Safety.detail).toContain('news');
    });
  });

  describe('Gate 2: Fusion Confluence Check', () => {
    it('fails if Fusion Confidence is below 65%', () => {
      const snap = {
        ...baseSnapshot,
        fusion: { ...baseSnapshot.fusion, confidence: 62.0 },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate2Fusion.passed).toBe(false);
      expect(res.gates.gate2Fusion.detail).toContain('62.0%');
    });

    it('fails if Fusion Bias conflicts with trade direction (BUY vs BEARISH)', () => {
      const snap = {
        ...baseSnapshot,
        fusion: { ...baseSnapshot.fusion, bias: 'BEARISH' as const },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate2Fusion.passed).toBe(false);
      expect(res.gates.gate2Fusion.detail).toContain('BEARISH');
    });

    it('fails if Brains Agreement is below minimum (e.g. 3 < 5)', () => {
      const snap = {
        ...baseSnapshot,
        fusion: { ...baseSnapshot.fusion, alignedBrains: 3 },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate2Fusion.passed).toBe(false);
      expect(res.gates.gate2Fusion.detail).toContain('Aligned Brains');
    });
  });

  describe('Gate 3: Whale & Session Alignment', () => {
    it('fails if BUY setup conflicts with SELLING whale flow', () => {
      const snap = {
        ...baseSnapshot,
        zoneLadder: { ...baseSnapshot.zoneLadder, whaleFlow: 'SELLING' as const },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate3WhaleSession.passed).toBe(false);
      expect(res.gates.gate3WhaleSession.detail).toContain('SELLING');
    });

    it('passes if BUY setup has NEUTRAL whale flow', () => {
      const snap = {
        ...baseSnapshot,
        zoneLadder: { ...baseSnapshot.zoneLadder, whaleFlow: 'NEUTRAL' as const },
      };
      const res = validateSixGates(createInput({ snapshot: snap }));
      expect(res.gates.gate3WhaleSession.passed).toBe(true);
    });

    it('fails if SELL setup conflicts with BUYING whale flow', () => {
      const sellSig: Signal = {
        ...baseSignal,
        direction: 'SELL',
        sl: 3250,
        tp1: 3225,
      };
      const snap = {
        ...baseSnapshot,
        fusion: { ...baseSnapshot.fusion, bias: 'BEARISH' as const },
        zoneLadder: { ...baseSnapshot.zoneLadder, whaleFlow: 'BUYING' as const },
      };
      const res = validateSixGates(createInput({ signal: sellSig, snapshot: snap }));
      expect(res.gates.gate3WhaleSession.passed).toBe(false);
    });
  });

  describe('Gate 4: Price-in-Zone Check', () => {
    it('executes MARKET order when price is inside [Entry Low, Entry High]', () => {
      const quoteInZone: Quote = { bid: 3239.8, ask: 3240.2, time: Date.now() }; // In [3238, 3242]
      const res = validateSixGates(createInput({ quote: quoteInZone }));
      expect(res.gates.gate4PriceInZone.passed).toBe(true);
      expect(res.orderKind).toBe('MARKET');
    });

    it('places BUY LIMIT at Anchor when price is above zone but within $15', () => {
      // Zone is [3238, 3242], Anchor is 3240. Live ask is 3248 ($8 away <= $15)
      const quotePullback: Quote = { bid: 3247.8, ask: 3248.0, time: Date.now() };
      const res = validateSixGates(createInput({ quote: quotePullback }));
      expect(res.gates.gate4PriceInZone.passed).toBe(true);
      expect(res.orderKind).toBe('LIMIT');
      expect(res.orderPrice).toBe(3240);
      expect(res.gates.gate4PriceInZone.detail).toContain('LIMIT');
    });

    it('fails when price is further than $15 away from zone/anchor', () => {
      // Live price is 3265 ($25 away from 3240)
      const quoteFar: Quote = { bid: 3264.8, ask: 3265.0, time: Date.now() };
      const res = validateSixGates(createInput({ quote: quoteFar }));
      expect(res.gates.gate4PriceInZone.passed).toBe(false);
      expect(res.gates.gate4PriceInZone.detail).toContain('exceeds max proximity');
    });
  });

  describe('Gate 5: Risk-to-Reward & SL Validation', () => {
    it('fails for BUY if SL is above or equal to Entry Low', () => {
      const invalidSlSig: Signal = {
        ...baseSignal,
        sl: 3239, // EntryLow is 3238, so SL > EntryLow is INVALID for BUY
      };
      const res = validateSixGates(createInput({ signal: invalidSlSig }));
      expect(res.gates.gate5RiskRewardSl.passed).toBe(false);
      expect(res.gates.gate5RiskRewardSl.detail).toContain('strictly below Entry Low');
    });

    it('fails for BUY if TP1 is below or equal to Entry High', () => {
      const invalidTpSig: Signal = {
        ...baseSignal,
        tp1: 3241, // EntryHigh is 3242, so TP1 <= EntryHigh is INVALID
      };
      const res = validateSixGates(createInput({ signal: invalidTpSig }));
      expect(res.gates.gate5RiskRewardSl.passed).toBe(false);
      expect(res.gates.gate5RiskRewardSl.detail).toContain('strictly above Entry High');
    });

    it('fails if minimum weighted R:R is below 1:1.5', () => {
      // Entry 3240, SL 3230 (risk 10), TP1 3242, TP2 3245, TP3 3248 (Reward < 10)
      const lowRrSig: Signal = {
        ...baseSignal,
        tp1: 3244,
        tp2: 3246,
        tp3: 3248,
      };
      const res = validateSixGates(createInput({ signal: lowRrSig }));
      expect(res.gates.gate5RiskRewardSl.passed).toBe(false);
      expect(res.gates.gate5RiskRewardSl.detail).toContain('below minimum 1:1.50');
    });
  });

  describe('Gate 6: Duplicate & Cooldown Guard', () => {
    it('fails if an active trade already exists for this setup', () => {
      const activeTrade: TradeGroup = {
        id: 'active-g-1',
        signalId: baseSignal.id,
        account: 'demo',
        accountLabel: 'Demo',
        symbol: 'XAUUSD',
        direction: 'BUY',
        kind: 'MARKET',
        entry: 3240,
        sl: 3230,
        currentSl: 3230,
        tp1: 3255,
        legs: [],
        status: 'OPEN',
        beMoved: false,
        trailedToTp1: false,
        createdAt: Date.now() - 10000,
        realizedPnl: 0,
      };
      const res = validateSixGates(createInput({ activeGroups: [activeTrade] }));
      expect(res.gates.gate6DuplicateCooldown.passed).toBe(false);
      expect(res.gates.gate6DuplicateCooldown.detail).toContain('already active');
    });

    it('fails if post-loss cooldown is active (e.g. 10m elapsed out of 30m)', () => {
      const tenMinutesAgo = Date.now() - 10 * 60_000;
      const res = validateSixGates(createInput({ lastLossAt: tenMinutesAgo }));
      expect(res.gates.gate6DuplicateCooldown.passed).toBe(false);
      expect(res.gates.gate6DuplicateCooldown.detail).toContain('cooldown active');
      expect(res.gates.gate6DuplicateCooldown.detail).toContain('20 minutes remaining');
    });

    it('passes if cooldown has fully elapsed (e.g. 35m elapsed)', () => {
      const thirtyFiveMinAgo = Date.now() - 35 * 60_000;
      const res = validateSixGates(createInput({ lastLossAt: thirtyFiveMinAgo }));
      expect(res.gates.gate6DuplicateCooldown.passed).toBe(true);
    });
  });
});
