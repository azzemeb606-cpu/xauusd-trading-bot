import crypto from 'node:crypto';
import type { Bias, Direction, MarketContext, OrderKind, Signal } from '../types';

/**
 * Pure text → signal parsing. No I/O here so it is fully unit-testable.
 * All patterns are case-insensitive regexes applied to normalised page text.
 */
export interface SignalPatterns {
  direction: string;
  limitHint: string;
  marketHint: string;
  /** Group 1 = entry (or zone bound), optional group 2 = other zone bound. */
  entry: string;
  sl: string;
  tp1: string;
  tp2: string;
  tp3: string;
  /** If matched (and no full setup found), the page shows "no active setup". */
  noSetup: string;
}

export interface ContextPatterns {
  price: string;
  bullish: string;
  bearish: string;
}

const NUM = '(\\d{3,5}(?:\\.\\d{1,3})?)';
const SEP = '\\s*[:=@\\-–]?\\s*\\$?\\s*';

export const DEFAULT_SIGNAL_PATTERNS: SignalPatterns = {
  direction: '\\b(BUY|SELL)\\b',
  limitHint: '\\b(LIMIT|PENDING|PULLBACK)\\b',
  marketHint: '\\b(MARKET|BUY NOW|SELL NOW|INSTANT|EXECUTE NOW)\\b',
  entry: `(?:ENTRY(?:\\s*(?:ZONE|PRICE|POINT|LEVEL))?|OPEN\\s*PRICE|\\b(?:BUY|SELL)(?:\\s*(?:LIMIT|NOW|ZONE))?\\s*(?:@|\\bAT\\b))${SEP}${NUM}(?:\\s*(?:-|–|~|/|TO)\\s*${NUM})?`,
  sl: `(?:\\bSL\\b|STOP\\s*-?\\s*LOSS)${SEP}${NUM}`,
  tp1: `(?:\\bTP\\s*1\\b|TAKE\\s*PROFIT\\s*1|TARGET\\s*1)${SEP}${NUM}`,
  tp2: `(?:\\bTP\\s*2\\b|TAKE\\s*PROFIT\\s*2|TARGET\\s*2)${SEP}${NUM}`,
  tp3: `(?:\\bTP\\s*3\\b|TAKE\\s*PROFIT\\s*3|TARGET\\s*3)${SEP}${NUM}`,
  noSetup: '\\b(NO\\s+(?:ACTIVE\\s+)?(?:SETUP|SIGNAL|TRADE)|WAITING\\s+FOR\\s+(?:SETUP|SIGNAL)|SCANNING)\\b',
};

export const DEFAULT_CONTEXT_PATTERNS: ContextPatterns = {
  price: '(?:XAU\\s*/?\\s*USD|GOLD|SPOT|LIVE\\s*PRICE|BID|PRICE)\\D{0,25}(\\d{3,5}\\.\\d{1,3})',
  bullish: '\\b(BULLISH|UP\\s*TREND|STRONG\\s+BUY|BUYERS?\\s+IN\\s+CONTROL)\\b',
  bearish: '\\b(BEARISH|DOWN\\s*TREND|STRONG\\s+SELL|SELLERS?\\s+IN\\s+CONTROL)\\b',
};

export interface ParseOptions {
  priceMin: number;
  priceMax: number;
  now?: number;
}

export type ParseResult = { signal: Signal; reason?: undefined } | { signal: null; reason: string };

export function normaliseText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/(\d),(\d{3})/g, '$1$2') // 4,012.50 -> 4012.50
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const rx = (p: string, flags = 'i') => new RegExp(p, flags);

function matchNum(text: string, pattern: string, opts: ParseOptions): number | undefined {
  const m = rx(pattern).exec(text);
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= opts.priceMin && v <= opts.priceMax ? v : undefined;
}

export function signalId(s: Pick<Signal, 'direction' | 'entry' | 'sl' | 'tp1' | 'tp2' | 'tp3'>): string {
  return crypto
    .createHash('sha1')
    .update([s.direction, s.entry, s.sl, s.tp1, s.tp2 ?? '', s.tp3 ?? ''].join('|'))
    .digest('hex')
    .slice(0, 16);
}

export function parseSignal(rawText: string, patterns: SignalPatterns, opts: ParseOptions): ParseResult {
  const text = normaliseText(rawText);
  if (!text) return { signal: null, reason: 'empty page text' };

  const entryMatch = rx(patterns.entry).exec(text);
  const sl = matchNum(text, patterns.sl, opts);
  const tp1 = matchNum(text, patterns.tp1, opts);

  if (!entryMatch || sl === undefined || tp1 === undefined) {
    if (rx(patterns.noSetup).test(text)) return { signal: null, reason: 'no active setup on page' };
    return { signal: null, reason: 'incomplete setup (entry/SL/TP1 not all found)' };
  }

  const a = Number(entryMatch[1]);
  const b = entryMatch[2] !== undefined ? Number(entryMatch[2]) : undefined;
  const inRange = (v: number) => Number.isFinite(v) && v >= opts.priceMin && v <= opts.priceMax;
  if (!inRange(a) || (b !== undefined && !inRange(b))) return { signal: null, reason: 'entry out of price range' };

  const entryLow = b !== undefined ? Math.min(a, b) : undefined;
  const entryHigh = b !== undefined ? Math.max(a, b) : undefined;
  const entry = b !== undefined ? Math.round(((a + b) / 2) * 100) / 100 : a;

  // Direction from geometry is authoritative; text direction must agree.
  if (sl === entry) return { signal: null, reason: 'SL equals entry' };
  const geomDir: Direction = sl < entry ? 'BUY' : 'SELL';

  const windowStart = Math.max(0, entryMatch.index - 250);
  const nearby = text.slice(windowStart, entryMatch.index + 60);
  const dirNear = rx(patterns.direction).exec(nearby)?.[1] as Direction | undefined;
  const dirAny = rx(patterns.direction).exec(text)?.[1] as Direction | undefined;
  const textDir = dirNear ?? dirAny;
  if (textDir && textDir !== geomDir) {
    return { signal: null, reason: `direction conflict: text says ${textDir} but SL/entry geometry implies ${geomDir}` };
  }

  const ahead = (x: number, y: number) => (geomDir === 'BUY' ? x > y : x < y);
  if (!ahead(tp1, entry)) return { signal: null, reason: 'TP1 is not beyond entry in trade direction' };

  let tp2 = matchNum(text, patterns.tp2, opts);
  let tp3 = matchNum(text, patterns.tp3, opts);
  if (tp2 !== undefined && !ahead(tp2, tp1)) tp2 = undefined;
  if (tp3 !== undefined && !ahead(tp3, tp2 ?? tp1)) tp3 = undefined;
  if (tp2 === undefined) tp3 = undefined;

  const ctx = text.slice(windowStart, entryMatch.index + 400);
  let hintedKind: OrderKind | null = null;
  if (rx(patterns.marketHint).test(ctx)) hintedKind = 'MARKET';
  else if (rx(patterns.limitHint).test(ctx)) hintedKind = 'LIMIT';

  const base = { direction: geomDir, entry, sl, tp1, tp2, tp3 };
  return {
    signal: {
      id: signalId(base),
      source: 'radar',
      ...base,
      entryLow,
      entryHigh,
      hintedKind,
      detectedAt: opts.now ?? Date.now(),
      rawExcerpt: ctx.slice(0, 500),
    },
  };
}

export function parseContext(rawText: string, patterns: ContextPatterns, opts: ParseOptions): MarketContext {
  const text = normaliseText(rawText);
  const price = matchNum(text, patterns.price, opts) ?? null;
  const bull = text.match(rx(patterns.bullish, 'gi'))?.length ?? 0;
  const bear = text.match(rx(patterns.bearish, 'gi'))?.length ?? 0;
  let bias: Bias = 'UNKNOWN';
  if (bull || bear) bias = bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NEUTRAL';
  return { bias, price, at: opts.now ?? Date.now(), rawExcerpt: text.slice(0, 300) };
}
