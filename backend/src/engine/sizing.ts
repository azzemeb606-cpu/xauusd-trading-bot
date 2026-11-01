import { floorToStep } from '../lib/utils';

export interface SizingInput {
  balance: number;
  riskPercent: number;
  fixedLot: number;
  maxLot: number;
  entry: number;
  sl: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  /** Split weights, e.g. [50,30,20]. */
  split: number[];
  /** Number of TP levels available in the signal (1..3). */
  tpCount: number;
}

/** Total lots so that hitting SL loses ≈ riskPercent of balance (USD account, XAUUSD). */
export function totalVolume(i: SizingInput): number {
  if (i.fixedLot > 0) return Math.min(i.fixedLot, i.maxLot, i.maxVolume);
  const riskMoney = (i.balance * i.riskPercent) / 100;
  const lossPerLot = Math.abs(i.entry - i.sl) * i.contractSize;
  if (lossPerLot <= 0 || riskMoney <= 0) return 0;
  return Math.min(riskMoney / lossPerLot, i.maxLot, i.maxVolume);
}

/**
 * Splits total volume across TP legs. If a leg would fall below the broker's
 * minimum lot, the number of legs is reduced. Returns [] if even a single
 * minimum lot exceeds the risk budget (strict: never over-risk).
 */
export function legVolumes(i: SizingInput): number[] {
  const total = totalVolume(i);
  for (let n = Math.min(i.tpCount, i.split.length, 3); n >= 1; n--) {
    const w = i.split.slice(0, n);
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) continue;
    const legs = w.map((x) => floorToStep((total * x) / sum, i.volumeStep));
    if (legs.every((v) => v >= i.minVolume)) return legs;
  }
  return [];
}
