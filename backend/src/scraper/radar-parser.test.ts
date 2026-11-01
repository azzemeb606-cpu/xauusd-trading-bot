import { describe, it, expect } from 'vitest';
import {
  parseSpotPrice,
  parseFusionVerdict,
  parseExecutionGates,
  parseZoneLadder,
  parseRadarSnapshot,
  normalise,
  splitSections,
} from '../src/scraper/radar-parser';

// ─────────────────────────────────────────────────────────────────────────────
// Test data — synthetic page texts that mimic what the radar might render
// ─────────────────────────────────────────────────────────────────────────────

const SPOT_TEXT = `
  LIVE XAU/USD
  BID: 3,248.50  ASK: 3,249.20  SPREAD: 0.70
`;

const FUSION_TEXT = `
  FUSION VERDICT
  Directional Bias: BULLISH
  Fusion Confidence: 69.6%
  Aligned Engines: 7 / 9
`;

const GATES_TEXT = `
  ENGINE HEALTH: 88%
  GATE STATUS: PASS
  ✓ Fusion Confidence   69.6%   PASS
  ✓ Directional Vote           PASS
  ✓ RR Minimum                 PASS
  ✓ SL Placement               PASS
  ✓ Whale Alignment            PASS
  ✗ Entry Location             FAIL
  ✓ Market Expansion           PASS
  ✓ Delivery Quality           PASS
  ✓ ML Consensus               PASS
`;

const GATES_BLOCKED_TEXT = `
  ENGINE HEALTH: 55%
  TRADE BLOCKED
  ✗ Fusion Confidence  45.2%  FAIL
  ✗ Directional Vote         FAIL
  ✓ RR Minimum               PASS
  ✓ SL Placement             PASS
  ✗ Whale Alignment          FAIL
  ✓ Entry Location           PASS
  ✗ Market Expansion         FAIL
  ✓ Delivery Quality         PASS
  ✓ ML Consensus             PASS
`;

const BUY_SETUP_TEXT = `
  DEMAND · STRONG
  Entry Zone: 3238.00 – 3241.50
  Anchor: 3239.75
  Stop Loss: 3233.00
  TP 1: 3248.00
  TP 2: 3258.00
  TP 3: 3270.00
  R:R  1:2.30
`;

const SELL_SETUP_TEXT = `
  SUPPLY · STRONG
  Entry Zone: 3260.00 – 3264.00
  Anchor: 3262.00
  Stop Loss: 3270.00
  TP 1: 3248.00
  TP 2: 3235.00
  TP 3: 3220.00
  R:R  1:1.80
`;

const WHALE_TEXT = `
  Current Session: LONDON
  Whale Flow: BUYING (84%)
  Next Key Level: 3260.00
  Zone Ladder:
    3270.00  RESISTANCE
    3260.00  PIVOT
    3248.00  SUPPORT
    3238.00  SUPPORT
`;

const FULL_RADAR_PAGE = [
  SPOT_TEXT, FUSION_TEXT, GATES_TEXT, BUY_SETUP_TEXT, SELL_SETUP_TEXT, WHALE_TEXT,
].join('\n\n');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('normalise()', () => {
  it('strips thousands comma from prices', () => {
    expect(normalise('3,248.50')).toBe('3248.50');
  });
  it('collapses whitespace', () => {
    expect(normalise('  BID :  3248.50  ')).toBe('BID : 3248.50');
  });
  it('uppercases', () => {
    expect(normalise('bullish')).toBe('BULLISH');
  });
});

describe('parseSpotPrice()', () => {
  const now = Date.now();
  it('extracts bid, ask, spread', () => {
    const r = parseSpotPrice(SPOT_TEXT, now);
    expect(r.bid).toBeCloseTo(3248.50, 2);
    expect(r.ask).toBeCloseTo(3249.20, 2);
    expect(r.spread).toBeCloseTo(0.70, 2);
  });
  it('calculates mid when bid+ask present', () => {
    const r = parseSpotPrice(SPOT_TEXT, now);
    expect(r.mid).toBeCloseTo((3248.50 + 3249.20) / 2, 1);
  });
  it('returns nulls for empty text', () => {
    const r = parseSpotPrice('', now);
    expect(r.bid).toBeNull();
    expect(r.ask).toBeNull();
  });
});

describe('parseFusionVerdict()', () => {
  const now = Date.now();
  it('detects BULLISH bias', () => {
    const r = parseFusionVerdict(FUSION_TEXT, now);
    expect(r.bias).toBe('BULLISH');
  });
  it('extracts confidence percentage', () => {
    const r = parseFusionVerdict(FUSION_TEXT, now);
    expect(r.confidence).toBeCloseTo(69.6, 1);
  });
  it('extracts aligned brains', () => {
    const r = parseFusionVerdict(FUSION_TEXT, now);
    expect(r.alignedBrains).toBe(7);
  });
  it('returns BEARISH for bearish text', () => {
    const r = parseFusionVerdict('Fusion Verdict | BEARISH | Confidence: 55.3%', now);
    expect(r.bias).toBe('BEARISH');
  });
  it('returns UNKNOWN for empty text', () => {
    const r = parseFusionVerdict('', now);
    expect(r.bias).toBe('UNKNOWN');
    expect(r.confidence).toBeNull();
  });
});

describe('parseExecutionGates()', () => {
  it('detects PASS overall', () => {
    const r = parseExecutionGates(GATES_TEXT);
    expect(r.overall).toBe('PASS');
  });
  it('detects TRADE_BLOCKED overall', () => {
    const r = parseExecutionGates(GATES_BLOCKED_TEXT);
    expect(r.overall).toBe('TRADE_BLOCKED');
  });
  it('extracts engine health %', () => {
    const r = parseExecutionGates(GATES_TEXT);
    expect(r.healthPct).toBe(88);
  });
  it('extracts 9 gates', () => {
    const r = parseExecutionGates(GATES_TEXT);
    expect(r.gates).toHaveLength(9);
  });
  it('correctly marks Fusion Confidence as PASS', () => {
    const r = parseExecutionGates(GATES_TEXT);
    const fc = r.gates.find((g) => g.name === 'FUSION_CONFIDENCE');
    expect(fc?.status).toBe('PASS');
  });
  it('correctly marks Entry Location as FAIL', () => {
    const r = parseExecutionGates(GATES_TEXT);
    const el = r.gates.find((g) => g.name === 'ENTRY_LOCATION');
    expect(el?.status).toBe('FAIL');
  });
  it('extracts confidence value for Fusion Confidence gate', () => {
    const r = parseExecutionGates(GATES_TEXT);
    const fc = r.gates.find((g) => g.name === 'FUSION_CONFIDENCE');
    expect(fc?.value).toMatch(/69/);
  });
});

describe('parseZoneLadder()', () => {
  it('detects LONDON session', () => {
    const r = parseZoneLadder(WHALE_TEXT);
    expect(r.currentSession).toBe('LONDON');
  });
  it('detects BUYING whale flow', () => {
    const r = parseZoneLadder(WHALE_TEXT);
    expect(r.whaleFlow).toBe('BUYING');
  });
  it('extracts whale confidence', () => {
    const r = parseZoneLadder(WHALE_TEXT);
    expect(r.whaleConfidence).toBe(84);
  });
  it('extracts next key level', () => {
    const r = parseZoneLadder(WHALE_TEXT);
    expect(r.nextKeyLevel).toBeCloseTo(3260.00, 2);
  });
  it('extracts ladder levels with types', () => {
    const r = parseZoneLadder(WHALE_TEXT);
    expect(r.ladderLevels.length).toBeGreaterThanOrEqual(1);
    const resistance = r.ladderLevels.find((l) => l.type === 'resistance');
    expect(resistance?.price).toBeCloseTo(3270, 0);
  });
});

describe('parseRadarSnapshot()', () => {
  const now = Date.now();
  it('produces a full snapshot from combined text', () => {
    const snap = parseRadarSnapshot(FULL_RADAR_PAGE, SPOT_TEXT, { priceMin: 1000, priceMax: 10000, now });
    expect(snap.spot.bid).toBeCloseTo(3248.50, 1);
    expect(snap.fusion.bias).toBe('BULLISH');
    expect(snap.execution.overall).toBe('PASS');
    expect(snap.buySetup).not.toBeNull();
    expect(snap.sellSetup).not.toBeNull();
    expect(snap.zoneLadder.currentSession).toBe('LONDON');
  });
  it('extracts buy setup entry zone', () => {
    const snap = parseRadarSnapshot(FULL_RADAR_PAGE, '', { now });
    expect(snap.buySetup?.entryZoneLow).toBeCloseTo(3238.00, 1);
    expect(snap.buySetup?.entryZoneHigh).toBeCloseTo(3241.50, 1);
  });
  it('extracts buy setup SL and TPs', () => {
    const snap = parseRadarSnapshot(FULL_RADAR_PAGE, '', { now });
    expect(snap.buySetup?.sl).toBeCloseTo(3233.00, 1);
    expect(snap.buySetup?.tp1).toBeCloseTo(3248.00, 1);
    expect(snap.buySetup?.tp2).toBeCloseTo(3258.00, 1);
    expect(snap.buySetup?.tp3).toBeCloseTo(3270.00, 1);
  });
  it('extracts sell setup', () => {
    const snap = parseRadarSnapshot(FULL_RADAR_PAGE, '', { now });
    expect(snap.sellSetup?.sl).toBeCloseTo(3270.00, 1);
    expect(snap.sellSetup?.rr).toBeCloseTo(1.80, 1);
  });
  it('returns null setups for empty page', () => {
    const snap = parseRadarSnapshot('', '', { now });
    expect(snap.buySetup).toBeNull();
    expect(snap.sellSetup).toBeNull();
  });
});

describe('splitSections()', () => {
  it('detects all section blocks', () => {
    const s = splitSections(FULL_RADAR_PAGE);
    expect(s.fusionBlock.toUpperCase()).toContain('BULLISH');
    expect(s.gateBlock.toUpperCase()).toMatch(/ENGINE HEALTH|GATE/);
    expect(s.buyBlock.toUpperCase()).toContain('DEMAND');
    expect(s.sellBlock.toUpperCase()).toContain('SUPPLY');
    expect(s.whaleBlock.toUpperCase()).toContain('LONDON');
  });
});
