import type { Direction, GateResult, MarketContext, OrderKind, Quote, RuntimeSettings, Signal } from '../types';

/**
 * Strict multi-gate evaluation. Every gate is a pure check; a trade is only
 * executed when ALL gates pass. Results are persisted and shown on the
 * dashboard so every decision is auditable.
 */
export interface GateContext {
  signal: Signal;
  context: MarketContext | null;
  quote: Quote | null;
  settings: RuntimeSettings;
  now: number;
  feedHealthy: boolean;
  brokerReady: boolean;
  openGroups: number;
  /** Worst daily drawdown % across target accounts. */
  dailyDrawdownPct: number;
  /** Lowest margin level across target accounts (null = no open positions). */
  marginLevel: number | null;
  lastLossAt: number | null;
  /** Volume that sizing produced for the primary account (0 = too small). */
  plannedVolume: number | null;
}

const fmt = (n: number, d = 2) => n.toFixed(d);

export function parseWindows(spec: string): Array<[number, number]> {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((w) => {
      const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(w);
      if (!m) throw new Error(`Invalid time window "${w}" (expected HH:MM-HH:MM)`);
      return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])] as [number, number];
    });
}

/** True when the UTC minute-of-day is inside any window (windows may wrap midnight). */
export function inWindows(now: number, spec: string): boolean {
  const windows = parseWindows(spec);
  if (windows.length === 0) return false;
  const d = new Date(now);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return windows.some(([a, b]) => (a <= b ? m >= a && m <= b : m >= a || m <= b));
}

/** Spot gold trades ~Sun 22:00 UTC → Fri 21:00 UTC (approximate; broker hours vary). */
export function isMarketOpen(now: number): boolean {
  const d = new Date(now);
  const day = d.getUTCDay();
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (day === 6) return false;
  if (day === 0) return m >= 22 * 60;
  if (day === 5) return m < 21 * 60;
  return true;
}

export const execPrice = (dir: Direction, q: Quote) => (dir === 'BUY' ? q.ask : q.bid);

/** Decides MARKET vs LIMIT (or null = not executable right now). */
export function decideOrderKind(signal: Signal, quote: Quote, s: RuntimeSettings): OrderKind | null {
  const price = execPrice(signal.direction, quote);
  const withinDev = Math.abs(price - signal.entry) <= s.maxEntryDeviation;
  const minGap = 0.1;
  const limitFeasible =
    signal.direction === 'BUY'
      ? price > signal.entry + minGap && price < signal.tp1 && price > signal.sl
      : price < signal.entry - minGap && price > signal.tp1 && price < signal.sl;

  if (s.orderTypePreference === 'MARKET') return withinDev ? 'MARKET' : null;
  if (s.orderTypePreference === 'LIMIT') return limitFeasible ? 'LIMIT' : null;
  // AUTO
  if (signal.hintedKind === 'LIMIT' && limitFeasible && !withinDev) return 'LIMIT';
  if (withinDev) return 'MARKET';
  if (limitFeasible) return 'LIMIT';
  return null;
}

/** Volume-weighted reward:risk across the TP legs. */
export function weightedRR(signal: Signal, entry: number, split: number[]): number {
  const tps = [signal.tp1, signal.tp2, signal.tp3].filter((v): v is number => v !== undefined);
  const w = split.slice(0, tps.length);
  const wSum = w.reduce((a, b) => a + b, 0) || 1;
  const risk = Math.abs(entry - signal.sl);
  if (risk <= 0) return 0;
  return tps.reduce((acc, tp, i) => acc + ((w[i] ?? 0) / wSum) * (Math.abs(tp - entry) / risk), 0);
}

export function evaluateGates(c: GateContext): { passed: boolean; results: GateResult[]; kind: OrderKind | null } {
  const { signal: sig, settings: s, quote } = c;
  const results: GateResult[] = [];
  const add = (id: string, name: string, passed: boolean, detail: string) => results.push({ id, name, passed, detail });

  add('AUTO_TRADING', 'Auto-trading enabled & kill switch off', s.autoTrading && !s.killSwitch,
    s.killSwitch ? 'Kill switch is ACTIVE' : s.autoTrading ? 'Enabled' : 'Auto-trading is OFF (monitor-only mode)');

  add('BROKER', 'Broker connection ready', c.brokerReady, c.brokerReady ? 'Connected' : 'Trading account not connected');

  add('FEED', 'Signal feeds healthy', c.feedHealthy, c.feedHealthy ? 'Both pages fresh' : 'Feed stale / scraper errors');

  add('MARKET_OPEN', 'Gold market open', isMarketOpen(c.now), isMarketOpen(c.now) ? 'Open' : 'Weekend / market closed');

  const ageSec = (c.now - sig.detectedAt) / 1000;
  add('FRESH', 'Signal is fresh', ageSec <= s.signalMaxAgeSec, `Age ${fmt(ageSec, 0)}s / max ${s.signalMaxAgeSec}s`);

  const inSession = inWindows(c.now, s.sessionWindows);
  const inBlackout = s.blackoutWindows.trim() ? inWindows(c.now, s.blackoutWindows) : false;
  add('SESSION', 'Inside trading session, outside blackout', inSession && !inBlackout,
    inBlackout ? 'Inside blackout window (news/rollover)' : inSession ? 'In session' : `Outside session ${s.sessionWindows} UTC`);

  const slDist = Math.abs(sig.entry - sig.sl);
  add('SL_DISTANCE', 'Stop-loss distance within limits', slDist >= s.minSlDistance && slDist <= s.maxSlDistance,
    `SL distance $${fmt(slDist)} (allowed $${s.minSlDistance}–$${s.maxSlDistance})`);

  let kind: OrderKind | null = null;
  if (!quote) {
    add('QUOTE', 'Live quote available', false, 'No live bid/ask from broker');
  } else {
    const spread = quote.ask - quote.bid;
    const quoteAge = (c.now - quote.time) / 1000;
    add('QUOTE', 'Live quote available', quoteAge < 120, `Bid ${fmt(quote.bid)} / Ask ${fmt(quote.ask)} (age ${fmt(quoteAge, 0)}s)`);
    add('SPREAD', 'Spread acceptable', spread <= s.maxSpread, `Spread $${fmt(spread)} / max $${s.maxSpread}`);

    kind = decideOrderKind(sig, quote, s);
    const price = execPrice(sig.direction, quote);
    add('ENTRY', 'Price at entry (market) or valid for limit', kind !== null,
      kind ? `${kind} — price ${fmt(price)} vs entry ${fmt(sig.entry)}`
        : `Price ${fmt(price)} too far from entry ${fmt(sig.entry)} (max dev $${s.maxEntryDeviation}) and limit not valid`);

    const effEntry = kind === 'MARKET' ? price : sig.entry;
    const rr = weightedRR(sig, effEntry, s.tpSplit);
    add('RISK_REWARD', 'Reward:risk acceptable', rr >= s.minRR, `Weighted R:R ${fmt(rr)} / min ${s.minRR}`);
  }

  if (s.confluenceMode !== 'OFF') {
    const bias = c.context?.bias ?? 'UNKNOWN';
    const wanted = sig.direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const opposite = sig.direction === 'BUY' ? 'BEARISH' : 'BULLISH';
    const ok = s.confluenceMode === 'STRICT' ? bias === wanted : bias !== opposite;
    add('CONFLUENCE', `Main chart confluence (${s.confluenceMode})`, ok, `Main page bias: ${bias}, signal: ${sig.direction}`);
  }

  add('EXPOSURE', 'Max open trade groups', c.openGroups < s.maxOpenGroups, `${c.openGroups} open / max ${s.maxOpenGroups}`);

  add('DAILY_DD', 'Daily drawdown below limit', c.dailyDrawdownPct < s.maxDailyDrawdownPct,
    `Daily DD ${fmt(c.dailyDrawdownPct)}% / max ${s.maxDailyDrawdownPct}%`);

  const coolLeft = c.lastLossAt ? s.cooldownAfterLossMin * 60_000 - (c.now - c.lastLossAt) : 0;
  add('COOLDOWN', 'Cooldown after loss elapsed', coolLeft <= 0, coolLeft > 0 ? `${Math.ceil(coolLeft / 60_000)} min remaining` : 'OK');

  add('MARGIN', 'Margin level healthy', c.marginLevel === null || c.marginLevel >= s.minMarginLevel,
    c.marginLevel === null ? 'No margin in use' : `Margin level ${fmt(c.marginLevel, 0)}% / min ${s.minMarginLevel}%`);

  if (c.plannedVolume !== null) {
    add('VOLUME', 'Position size valid', c.plannedVolume > 0,
      c.plannedVolume > 0 ? `${c.plannedVolume} lots planned` : 'Risk-based size below broker minimum lot');
  }

  return { passed: results.every((r) => r.passed), results, kind };
}
