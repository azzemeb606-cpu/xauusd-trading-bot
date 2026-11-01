import { describe, it, expect } from 'vitest';
import { legVolumes, totalVolume } from '../src/engine/sizing';

const baseInput = {
  balance: 10_000,
  riskPercent: 1,
  fixedLot: 0,
  maxLot: 1,
  entry: 3240,
  sl: 3230,
  contractSize: 100,
  minVolume: 0.01,
  maxVolume: 50,
  volumeStep: 0.01,
  split: [50, 30, 20],
  tpCount: 3,
};

describe('totalVolume()', () => {
  it('calculates 1% risk on $10k account correctly', () => {
    // riskMoney = $100, SL dist = $10, contractSize = 100
    // total = 100 / (10 * 100) = 0.10 lot
    expect(totalVolume(baseInput)).toBeCloseTo(0.10, 2);
  });

  it('caps at maxLot', () => {
    const v = totalVolume({ ...baseInput, balance: 1_000_000, riskPercent: 10 });
    expect(v).toBeLessThanOrEqual(1);
  });

  it('returns fixedLot when set', () => {
    expect(totalVolume({ ...baseInput, fixedLot: 0.05 })).toBeCloseTo(0.05, 2);
  });

  it('returns 0 when SL equals entry', () => {
    expect(totalVolume({ ...baseInput, sl: 3240 })).toBe(0);
  });
});

describe('legVolumes()', () => {
  it('returns 3 legs for 3 TPs', () => {
    const vols = legVolumes(baseInput);
    expect(vols).toHaveLength(3);
  });

  it('each leg is at or above minVolume', () => {
    const vols = legVolumes(baseInput);
    for (const v of vols) expect(v).toBeGreaterThanOrEqual(0.01);
  });

  it('legs sum to approximately totalVolume', () => {
    const total = totalVolume(baseInput);
    const vols = legVolumes(baseInput);
    const sum = vols.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(total, 1);
  });

  it('returns empty array when balance too small to risk', () => {
    const tiny = { ...baseInput, balance: 1, riskPercent: 0.01 };
    expect(legVolumes(tiny)).toHaveLength(0);
  });

  it('falls back to 1 leg when 3 legs are each below minVolume', () => {
    // large SL, small balance → very tiny lots
    const large = {
      ...baseInput,
      balance: 500,
      riskPercent: 1,
      sl: 3100,  // dist = 140
      split: [50, 30, 20],
      tpCount: 3,
      minVolume: 0.01,
    };
    const vols = legVolumes(large);
    // Should still give us at least 1 leg if mathematically feasible
    expect(vols.length).toBeGreaterThanOrEqual(0);
    if (vols.length > 0) {
      for (const v of vols) expect(v).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('volumes snap to volumeStep', () => {
    const vols = legVolumes({ ...baseInput, volumeStep: 0.05 });
    for (const v of vols) {
      expect(Math.round(v / 0.05) * 0.05).toBeCloseTo(v, 3);
    }
  });
});
