/**
 * radar-parser.ts
 *
 * Full-fidelity DOM + text parser for:
 *   - https://xauusdlivechart.com/007  (Bond 007 Swing Trade Radar)
 *   - https://xauusdlivechart.com/     (Live XAU/USD chart)
 *
 * All extraction is regex-first (applied to normalised innerText) with
 * structured DOM selectors as fallback so it survives minor layout changes.
 *
 * --------------------------------------------------------------------------
 * IMPORTANT: The website's exact CSS classes / element structure may differ.
 * Every pattern below is documented with WHY it exists and WHERE it lives on
 * the page so you can update patterns without re-reading all the code.
 * --------------------------------------------------------------------------
 */

import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TradeBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
export type SessionLabel = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'UNKNOWN';
export type WhaleFlow = 'BUYING' | 'SELLING' | 'NEUTRAL' | 'UNKNOWN';
export type GateStatus = 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';
export type OverallGateStatus = 'PASS' | 'TRADE_BLOCKED' | 'UNKNOWN';
export type ZoneStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'UNKNOWN';

/** 9 named execution safety gates from the Bond 007 radar. */
export interface ExecutionGate {
  name: string;
  label: string;      // human-readable label from the page
  status: GateStatus;
  value?: string;     // raw value text if the gate shows one (e.g. "69.6%")
}

/** Fusion Verdict block — top-of-page intelligence summary. */
export interface FusionVerdict {
  bias: TradeBias;
  confidence: number | null;   // percentage, e.g. 69.6
  alignedBrains: number | null; // count of aligned engines
  rawText: string;
}

/** One trade setup (BUY or SELL). */
export interface TradeSetup {
  direction: 'BUY' | 'SELL';
  zoneLabel: string;            // e.g. "DEMAND · STRONG" or "SUPPLY · STRONG"
  zoneStrength: ZoneStrength;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  anchorPrice: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  rr: number | null;            // Risk-to-Reward ratio
  id: string;                   // stable hash for deduplication
}

/** Zone Ladder & Whale Matrix block. */
export interface ZoneLadder {
  currentSession: SessionLabel;
  whaleFlow: WhaleFlow;
  whaleConfidence: number | null;  // % if shown
  nextKeyLevel: number | null;
  ladderLevels: Array<{ price: number; label: string; type: 'support' | 'resistance' | 'pivot' | 'unknown' }>;
}

/** Live spot price from the main chart page or embedded widget. */
export interface SpotPrice {
  bid: number | null;
  ask: number | null;
  spread: number | null;    // ask − bid in USD
  mid: number | null;
  at: number;
}

/** Execution safety gates block — the 9-gate PASS / TRADE BLOCKED verdict. */
export interface ExecutionGates {
  overall: OverallGateStatus;
  healthPct: number | null;   // e.g. 88 = "88% health"
  gates: ExecutionGate[];
  rawText: string;
}

/** Complete parsed snapshot from the Bond 007 radar page. */
export interface RadarSnapshot {
  at: number;
  spot: SpotPrice;
  fusion: FusionVerdict;
  execution: ExecutionGates;
  buySetup: TradeSetup | null;
  sellSetup: TradeSetup | null;
  zoneLadder: ZoneLadder;
  /** Condensed excerpt for debug / logging. */
  rawExcerpt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const rx = (p: string, flags = 'gi') => new RegExp(p, flags);
const first = (t: string, p: string): RegExpExecArray | null => rx(p).exec(normalise(t));

export function normalise(text: string): string {
  return text
    .replace(/\u00a0|\u200b|\u200c|\u200d|\ufeff/g, ' ')
    .replace(/(\d),(\d{3})/g, '$1$2')   // strip thousands comma: 4,012 → 4012
    .replace(/\r?\n/g, ' | ')            // flatten newlines for single-pass regex
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}

// Matches XAUUSD prices: 3+ digits, optional decimal up to 3 places (e.g. 3248.50)
const PRICE = '(\\d{3,5}(?:\\.\\d{1,3})?)';
// Loose separator between label and number
const SEP = '[\\s:=@\\-–·|]*\\$?\\s*';

function extractNum(text: string, pattern: string, priceMin = 1000, priceMax = 10_000): number | null {
  const m = rx(pattern).exec(text);
  if (!m) return null;
  // Try each capture group for a valid price
  for (let i = 1; i < m.length; i++) {
    const v = parseFloat(m[i] ?? '');
    if (Number.isFinite(v) && v >= priceMin && v <= priceMax) return v;
  }
  return null;
}

function extractPct(text: string, pattern: string): number | null {
  const m = rx(pattern).exec(text);
  if (!m) return null;
  const v = parseFloat(m[1] ?? '');
  return Number.isFinite(v) ? v : null;
}

function setupId(s: Partial<TradeSetup>): string {
  return crypto
    .createHash('sha1')
    .update([s.direction, s.entryZoneLow, s.entryZoneHigh, s.sl, s.tp1, s.tp2, s.tp3].join('|'))
    .digest('hex')
    .slice(0, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Spot Price
// ─────────────────────────────────────────────────────────────────────────────
// The main chart page shows the live price prominently.  Multiple label forms:
//   BID: 3248.50   ASK: 3249.20   SPREAD: 0.70
//   XAU/USD  3248.85                (mid/last)
//   GOLD PRICE: $3,248.50

export function parseSpotPrice(rawText: string, now: number): SpotPrice {
  const t = normalise(rawText);

  const bid = extractNum(t, `(?:BID|B(?:ID)?\\s*PRICE|BUY\\s*PRICE)${SEP}${PRICE}`);
  const ask = extractNum(t, `(?:ASK|SELL\\s*PRICE|OFFER)${SEP}${PRICE}`);
  const spread = extractNum(
    t,
    `(?:SPREAD|SPR)${SEP}(\\d+(?:\\.\\d{1,3})?)`,
    0, 99
  );

  // Mid / last price fallback
  let mid: number | null = null;
  if (bid !== null && ask !== null) {
    mid = Math.round(((bid + ask) / 2) * 100) / 100;
  } else {
    // Look for a standalone price after known labels
    mid = extractNum(
      t,
      `(?:XAU\\s*\\/\\s*USD|GOLD|SPOT|LAST|PRICE|LIVE)${SEP}${PRICE}`
    ) ?? extractNum(t, `\\b${PRICE}\\s*(?:USD|USDT)?\\b`);
  }

  const calcSpread = bid !== null && ask !== null ? Math.round((ask - bid) * 100) / 100 : spread;

  return { bid, ask, spread: calcSpread, mid, at: now };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fusion Verdict
// ─────────────────────────────────────────────────────────────────────────────
// Bond 007 page shows a "FUSION VERDICT" or "INTELLIGENCE VERDICT" block:
//   Directional Bias:  BULLISH
//   Fusion Confidence: 69.6%
//   Aligned Engines:   7 / 9  or  7 Brains

export function parseFusionVerdict(rawText: string, now: number): FusionVerdict {
  const t = normalise(rawText);

  // Bias — look inside a bounded region if possible
  let bias: TradeBias = 'UNKNOWN';
  const bRegion = rx(`FUSION${SEP}(?:VERDICT|INTELLIGENCE)|DIRECTIONAL${SEP}BIAS`).exec(t);
  const bCtx = bRegion ? t.slice(bRegion.index, bRegion.index + 300) : t;
  if (/\bBULLISH\b/i.test(bCtx)) bias = 'BULLISH';
  else if (/\bBEARISH\b/i.test(bCtx)) bias = 'BEARISH';
  else if (/\bNEUTRAL\b/i.test(bCtx)) bias = 'NEUTRAL';

  // Confidence %
  const confidence = extractPct(
    t,
    `(?:FUSION${SEP}CONFIDENCE|CONFIDENCE${SEP}LEVEL|CONFIDENCE)${SEP}(\\d{1,3}(?:\\.\\d{1,2})?)\\s*%`
  ) ?? extractPct(
    bCtx,
    `(\\d{1,3}\\.\\d{1,2})\\s*%`
  );

  // Aligned brains/engines  "7 / 9" or "7 BRAINS" or "ALIGNED: 7"
  let alignedBrains: number | null = null;
  const brainMatch = rx(
    `(?:ALIGNED(?:\\s*ENGINES?|\\s*BRAINS?)?|ENGINES?\\s*ALIGNED|BRAINS?)${SEP}(\\d{1,2})(?:\\s*\\/\\s*\\d{1,2})?`
  ).exec(t);
  if (brainMatch) alignedBrains = parseInt(brainMatch[1], 10);
  // Fallback: "7 / 9 ENGINES"
  if (alignedBrains === null) {
    const fb = rx(`(\\d{1,2})\\s*\\/\\s*\\d{1,2}\\s*(?:ENGINES?|BRAINS?)`).exec(t);
    if (fb) alignedBrains = parseInt(fb[1], 10);
  }

  const excerpt = t.slice(bRegion ? Math.max(0, bRegion.index - 50) : 0, (bRegion?.index ?? 0) + 400).slice(0, 500);
  return { bias, confidence, alignedBrains, rawText: excerpt };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Execution Safety Gates (9 Gates)
// ─────────────────────────────────────────────────────────────────────────────
// Header shows: "ENGINE HEALTH: 88%" then "PASS" or "TRADE BLOCKED"
// Then 9 gate rows, each typically:
//   ✓ Fusion Confidence   69.6%   PASS
//   ✗ ML Consensus        ---     FAIL
//
// Gate names are fixed by the radar UI; patterns are searched in order.

const GATE_DEFS: Array<{ name: string; patterns: string[] }> = [
  {
    name: 'FUSION_CONFIDENCE',
    patterns: ['FUSION\\s*CONFIDENCE', 'FUSION\\s*CONF'],
  },
  {
    name: 'DIRECTIONAL_VOTE',
    patterns: ['DIRECTIONAL\\s*VOTE', 'DIR(?:ECTIONAL)?\\s*VOTE'],
  },
  {
    name: 'RR_MINIMUM',
    patterns: ['R\\s*[:\\-]?\\s*R\\s*MINIMUM', 'RISK\\s*(?:TO\\s*)?REWARD\\s*MIN', 'RR\\s*MIN'],
  },
  {
    name: 'SL_PLACEMENT',
    patterns: ['S\\.?L\\.?\\s*PLACEMENT', 'STOP\\s*LOSS\\s*PLACEMENT', 'SL\\s*PLACEMENT'],
  },
  {
    name: 'WHALE_ALIGNMENT',
    patterns: ['WHALE\\s*ALIGN(?:MENT)?', 'WHALE\\s*FLOW\\s*ALIGN'],
  },
  {
    name: 'ENTRY_LOCATION',
    patterns: ['ENTRY\\s*LOCATION', 'ENTRY\\s*LOC(?:ATION)?'],
  },
  {
    name: 'MARKET_EXPANSION',
    patterns: ['MARKET\\s*EXPANSION', 'EXPANSION\\s*(?:/\\s*CHOP)?', 'CHOP\\s*CHECK'],
  },
  {
    name: 'DELIVERY_QUALITY',
    patterns: ['DELIVERY\\s*QUALITY', 'PRICE\\s*DELIVERY'],
  },
  {
    name: 'ML_CONSENSUS',
    patterns: ['ML\\s*CONSENSUS', 'MACHINE\\s*LEARNING\\s*CONSENSUS', 'ML\\s*VOTE'],
  },
];

function matchGateStatus(chunk: string): GateStatus {
  const t = chunk.toUpperCase();
  if (/✓|✔|PASS(?:ED)?|\bOK\b|GREEN/.test(t)) return 'PASS';
  if (/✗|✘|FAIL(?:ED)?|RED|BLOCK/.test(t)) return 'FAIL';
  if (/WARN|CAUTION|YELLOW|AMBER/.test(t)) return 'WARN';
  return 'UNKNOWN';
}

function extractGateValue(chunk: string): string | undefined {
  // Look for a percentage or numeric value in the chunk
  const m = /(\d{1,3}(?:\.\d{1,2})?\s*%|\d{1,3}\.\d{2}|\d+\s*\/\s*\d+)/.exec(chunk);
  return m?.[1]?.trim();
}

export function parseExecutionGates(rawText: string): ExecutionGates {
  const t = normalise(rawText);

  // Overall status — whole line: "PASS" or "TRADE BLOCKED" after the gate header
  let overall: OverallGateStatus = 'UNKNOWN';
  if (/\bTRADE\s*BLOCKED\b/i.test(t)) overall = 'TRADE_BLOCKED';
  else if (/\bALL\s*GATES?\s*PASS(?:ED)?\b|\bEXECUTE\s*TRADE\b|\bSYSTEM\s*PASS\b/i.test(t)) overall = 'PASS';
  else if (/\b(?:GATE\s*)?STATUS:\s*PASS\b/i.test(t)) overall = 'PASS';

  // Engine health %  →  "ENGINE HEALTH: 88%" or "HEALTH: 88%" or "88% HEALTH"
  const healthPct =
    extractPct(t, `(?:ENGINE\\s*HEALTH|SYSTEM\\s*HEALTH|HEALTH)${SEP}(\\d{1,3})\\s*%`) ??
    extractPct(t, `(\\d{1,3})\\s*%\\s*HEALTH`);

  // Parse individual gates
  const gates: ExecutionGate[] = GATE_DEFS.map((def) => {
    for (const pat of def.patterns) {
      const m = rx(pat).exec(t);
      if (m) {
        // Take 120 chars after the gate label to determine status/value
        const chunk = t.slice(m.index, m.index + 120);
        return {
          name: def.name,
          label: chunk.slice(0, 40).trim().replace(/[|]+$/, '').trim(),
          status: matchGateStatus(chunk),
          value: extractGateValue(chunk.slice(20)),
        } satisfies ExecutionGate;
      }
    }
    return {
      name: def.name,
      label: def.name.replace(/_/g, ' '),
      status: 'UNKNOWN' as GateStatus,
    } satisfies ExecutionGate;
  });

  // Derive overall from individual gates when page doesn't show a verdict
  if (overall === 'UNKNOWN' && gates.some((g) => g.status !== 'UNKNOWN')) {
    overall = gates.every((g) => g.status === 'PASS' || g.status === 'UNKNOWN')
      ? 'PASS'
      : 'TRADE_BLOCKED';
  }

  const gStart = rx(`ENGINE\\s*HEALTH|EXECUTION\\s*GATES?|SAFETY\\s*GATES?`).exec(t);
  const rawExcerpt = t.slice(gStart ? gStart.index : 0, (gStart?.index ?? 0) + 600).slice(0, 600);

  return { overall, healthPct, gates, rawText: rawExcerpt };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Trade Setups (Buy / Sell)
// ─────────────────────────────────────────────────────────────────────────────
// The page shows two panels — one for demand (BUY) and one for supply (SELL):
//
//  ┌─ DEMAND · STRONG ──────────────────────────┐
//  │  Entry Zone: 3238.00 – 3241.50             │
//  │  Anchor:     3239.75                       │
//  │  Stop Loss:  3233.00                       │
//  │  TP1: 3248.00  TP2: 3258.00  TP3: 3270.00 │
//  │  R:R  1:2.3                                │
//  └────────────────────────────────────────────┘
//
// SUPPLY panel is the same structure for SELL.

function parseOneSetup(
  sectionText: string,
  direction: 'BUY' | 'SELL',
  priceMin: number,
  priceMax: number,
): TradeSetup | null {
  const t = normalise(sectionText);
  if (!t) return null;

  const inRange = (v: number | null): boolean =>
    v !== null && Number.isFinite(v) && v >= priceMin && v <= priceMax;

  // Zone label (e.g. "DEMAND · STRONG")
  const zoneStrengthMatch = rx(`(STRONG|MODERATE|WEAK)`).exec(t);
  const zoneStrength: ZoneStrength = (zoneStrengthMatch?.[1] as ZoneStrength) ?? 'UNKNOWN';
  const zoneLabelMatch = rx(`(?:DEMAND|SUPPLY)\\s*[·\\-·]\\s*(?:STRONG|MODERATE|WEAK)`, 'i').exec(sectionText.toUpperCase());
  const zoneLabel = zoneLabelMatch?.[0] ?? (direction === 'BUY' ? 'DEMAND · STRONG' : 'SUPPLY · STRONG');

  // Entry Zone — may be a range or single price
  //   "ENTRY ZONE: 3238.00 – 3241.50"
  //   "ENTRY: 3238.00"
  let entryZoneLow: number | null = null;
  let entryZoneHigh: number | null = null;
  const zoneRangeMatch = rx(
    `ENTRY\\s*(?:ZONE)?${SEP}${PRICE}\\s*(?:-|–|~|TO)\\s*${PRICE}`
  ).exec(t);
  if (zoneRangeMatch) {
    const a = parseFloat(zoneRangeMatch[1]);
    const b = parseFloat(zoneRangeMatch[2]);
    if (inRange(a) && inRange(b)) {
      entryZoneLow = Math.min(a, b);
      entryZoneHigh = Math.max(a, b);
    }
  }
  if (entryZoneLow === null) {
    const single = extractNum(t, `ENTRY(?:\\s*(?:ZONE|PRICE|LEVEL|POINT))?${SEP}${PRICE}`, priceMin, priceMax);
    if (single !== null) { entryZoneLow = single; entryZoneHigh = single; }
  }

  // Anchor price
  const anchorPrice = extractNum(t, `ANCHOR(?:\\s*PRICE)?${SEP}${PRICE}`, priceMin, priceMax);

  // Stop Loss
  const sl = extractNum(t, `(?:SL|STOP\\s*(?:LOSS)?)${SEP}${PRICE}`, priceMin, priceMax);

  // TP levels — we look for TP1/TP2/TP3 in multiple formats
  const tp1 = extractNum(t, `TP\\s*1${SEP}${PRICE}`, priceMin, priceMax)
    ?? extractNum(t, `TARGET\\s*1${SEP}${PRICE}`, priceMin, priceMax)
    ?? extractNum(t, `TAKE\\s*PROFIT\\s*1${SEP}${PRICE}`, priceMin, priceMax);

  const tp2 = extractNum(t, `TP\\s*2${SEP}${PRICE}`, priceMin, priceMax)
    ?? extractNum(t, `TARGET\\s*2${SEP}${PRICE}`, priceMin, priceMax);

  const tp3 = extractNum(t, `TP\\s*3${SEP}${PRICE}`, priceMin, priceMax)
    ?? extractNum(t, `TARGET\\s*3${SEP}${PRICE}`, priceMin, priceMax);

  // R:R ratio  →  "R:R  1:2.3" or "RR: 2.3" or "RISK/REWARD: 1:2.30"
  let rr: number | null = null;
  const rrMatch = rx(
    `(?:R\\s*[:\\-]?\\s*R|RISK\\s*(?:TO\\s*)?REWARD|REWARD\\s*RISK)${SEP}(?:1\\s*[:\\-/]\\s*)?(\\d{1,2}(?:\\.\\d{1,2})?)`
  ).exec(t);
  if (rrMatch) {
    const v = parseFloat(rrMatch[1]);
    if (Number.isFinite(v) && v > 0 && v < 50) rr = v;
  }

  // Validate minimally
  if (!inRange(entryZoneLow) && !inRange(anchorPrice)) return null;

  const partial: Partial<TradeSetup> = { direction, entryZoneLow, entryZoneHigh, sl, tp1, tp2, tp3 };
  return {
    direction,
    zoneLabel,
    zoneStrength,
    entryZoneLow,
    entryZoneHigh,
    anchorPrice,
    sl,
    tp1,
    tp2,
    tp3,
    rr,
    id: setupId(partial),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section splitter — break the page text into logical sections so the BUY/SELL
// parsers see only their relevant block rather than the whole page.
// ─────────────────────────────────────────────────────────────────────────────

export interface PageSections {
  priceBlock: string;
  fusionBlock: string;
  gateBlock: string;
  buyBlock: string;
  sellBlock: string;
  whaleBlock: string;
  full: string;
}

/**
 * Splits the normalised full-page text into named sections.
 * Section boundaries are detected by their heading patterns; when a heading
 * is absent the section falls back to the full text so extractors still work.
 */
export function splitSections(rawText: string): PageSections {
  const raw = rawText;   // preserve case for DOM selectors
  const t = normalise(rawText);   // UPPER, flat for section detection

  // Helper: extract slice between two boundary anchors (or to end)
  function region(startPat: string, endPat?: string): string {
    const s = rx(startPat).exec(t);
    if (!s) return t;                      // fallback: whole page
    const end = endPat ? rx(endPat).exec(t.slice(s.index + 20)) : null;
    const endIdx = end ? s.index + 20 + end.index : t.length;
    return raw.slice(s.index, Math.min(endIdx + 200, raw.length));
  }

  const priceBlock = region(
    `(?:BID|ASK|LIVE\\s*PRICE|XAU\\s*\\/\\s*USD|SPREAD)`,
    `FUSION|INTELLIGENCE|VERDICT`
  );
  const fusionBlock = region(
    `FUSION\\s*(?:VERDICT|INTELLIGENCE)|INTELLIGENCE\\s*SUMMARY`,
    `ENGINE\\s*HEALTH|EXECUTION\\s*GATES?|SAFETY\\s*GATES?`
  );
  const gateBlock = region(
    `ENGINE\\s*HEALTH|EXECUTION\\s*GATES?|SAFETY\\s*GATES?|9\\s*GATES?`,
    `DEMAND|SUPPLY|BUY\\s*SETUP|SELL\\s*SETUP|ZONE\\s*LADDER|WHALE`
  );

  // BUY / DEMAND block
  const buyBlock = region(
    `DEMAND|BUY\\s*SETUP|BUY\\s*ZONE`,
    `SUPPLY|SELL\\s*SETUP|SELL\\s*ZONE|ZONE\\s*LADDER|WHALE`
  );

  // SELL / SUPPLY block
  const sellBlock = region(
    `SUPPLY|SELL\\s*SETUP|SELL\\s*ZONE`,
    `ZONE\\s*LADDER|WHALE\\s*MATRIX|SESSION`
  );

  // Whale & Session block
  const whaleBlock = region(
    `WHALE|ZONE\\s*LADDER|SESSION\\s*(?:MATRIX|WINDOW|FLOW)|INSTITUTIONAL`
  );

  return { priceBlock, fusionBlock, gateBlock, buyBlock, sellBlock, whaleBlock, full: raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Zone Ladder & Whale Matrix
// ─────────────────────────────────────────────────────────────────────────────
// Typical display:
//   Current Session:  LONDON
//   Whale Flow:       BUYING  (84%)
//   Next Key Level:   3260.00
//   Zone Ladder:
//     3270.00  RESISTANCE
//     3260.00  PIVOT
//     3248.00  SUPPORT

function parseSession(text: string): SessionLabel {
  const t = text.toUpperCase();
  if (/\bNEW[\s_\-]*YORK\b/.test(t)) return 'NEW_YORK';
  if (/\bLONDON\b/.test(t)) return 'LONDON';
  if (/\bASIA(?:N)?\b/.test(t)) return 'ASIA';
  return 'UNKNOWN';
}

function parseWhaleFlow(text: string): WhaleFlow {
  const t = text.toUpperCase();
  if (/\bBUYING\b|\bACCUMULATION\b|\bBULLISH\s*FLOW\b/.test(t)) return 'BUYING';
  if (/\bSELLING\b|\bDISTRIBUTION\b|\bBEARISH\s*FLOW\b/.test(t)) return 'SELLING';
  if (/\bNEUTRAL\b/.test(t)) return 'NEUTRAL';
  return 'UNKNOWN';
}

export function parseZoneLadder(rawText: string, priceMin = 1000, priceMax = 10_000): ZoneLadder {
  const t = normalise(rawText);

  const currentSession = parseSession(t);

  // Whale flow + optional confidence
  let whaleFlow: WhaleFlow = 'UNKNOWN';
  let whaleConfidence: number | null = null;
  const whaleMatch = rx(`WHALE\\s*(?:FLOW|MATRIX|ALIGNMENT|SIGNAL)?${SEP}([A-Z]+)(?:\\s*[|(]\\s*(\\d{1,3})\\s*%)?`).exec(t);
  if (whaleMatch) {
    whaleFlow = parseWhaleFlow(whaleMatch[0]);
    if (whaleMatch[2]) whaleConfidence = parseFloat(whaleMatch[2]);
  }
  // Second attempt from just-flow text
  if (whaleFlow === 'UNKNOWN') whaleFlow = parseWhaleFlow(t);

  // Next key level
  const nextKeyLevel = extractNum(
    t,
    `NEXT\\s*(?:KEY\\s*)?LEVEL${SEP}${PRICE}`,
    priceMin, priceMax
  );

  // Ladder levels — scan for price+label pairs
  // Format: "3270.00  RESISTANCE" or "RESISTANCE  3270.00"
  const ladderLevels: ZoneLadder['ladderLevels'] = [];
  const levelPat = rx(
    `(?:(\\d{4,5}(?:\\.\\d{1,3})?)\\s*(?:\\|\\s*)?([A-Z][A-Z\\s]{2,20}?))|(?:([A-Z]{3,20})\\s*[|:\\-]?\\s*(\\d{4,5}(?:\\.\\d{1,3})?))`
  );
  let m: RegExpExecArray | null;
  while ((m = levelPat.exec(t)) !== null) {
    const priceStr = m[1] ?? m[4];
    const labelStr = (m[2] ?? m[3] ?? '').trim().replace(/[|:]+$/, '').trim();
    if (!priceStr || !labelStr) continue;
    const price = parseFloat(priceStr);
    if (!Number.isFinite(price) || price < priceMin || price > priceMax) continue;
    // Ignore non-level words
    if (/^(?:USD|GOLD|ENTRY|STOP|TAKE|PROFIT|LOSS|ZONE|SETUP|BUY|SELL|ASK|BID|TP|SL|FUSION|ENGINE|GATE|WHALE|LONDON|ASIA|NEW|YORK)$/.test(labelStr)) continue;
    const type = /RESIST/.test(labelStr) ? 'resistance'
      : /SUPPORT/.test(labelStr) ? 'support'
        : /PIVOT/.test(labelStr) ? 'pivot'
          : 'unknown';
    ladderLevels.push({ price, label: labelStr.slice(0, 25), type });
  }
  // Deduplicate by price, keep first occurrence
  const seen = new Set<number>();
  const uniqueLevels = ladderLevels.filter((l) => !seen.has(l.price) && seen.add(l.price));
  uniqueLevels.sort((a, b) => b.price - a.price);   // descending by price

  return { currentSession, whaleFlow, whaleConfidence, nextKeyLevel, ladderLevels: uniqueLevels.slice(0, 20) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Master parser — assembles everything into one RadarSnapshot
// ─────────────────────────────────────────────────────────────────────────────

export interface ParseRadarOptions {
  priceMin?: number;
  priceMax?: number;
  now?: number;
}

export function parseRadarSnapshot(
  radarPageText: string,
  mainPageText: string,
  opts: ParseRadarOptions = {},
): RadarSnapshot {
  const priceMin = opts.priceMin ?? 1000;
  const priceMax = opts.priceMax ?? 10_000;
  const now = opts.now ?? Date.now();

  const sections = splitSections(radarPageText);

  // Price: main chart page is more reliable for bid/ask; radar page as fallback
  const mainSpot = parseSpotPrice(mainPageText, now);
  const radarSpot = parseSpotPrice(sections.priceBlock || radarPageText, now);
  const spot: SpotPrice = {
    bid: mainSpot.bid ?? radarSpot.bid,
    ask: mainSpot.ask ?? radarSpot.ask,
    spread: mainSpot.spread ?? radarSpot.spread,
    mid: mainSpot.mid ?? radarSpot.mid,
    at: now,
  };

  const fusion = parseFusionVerdict(sections.fusionBlock || radarPageText, now);
  const execution = parseExecutionGates(sections.gateBlock || radarPageText);

  const buySetup = parseOneSetup(sections.buyBlock || radarPageText, 'BUY', priceMin, priceMax);
  const sellSetup = parseOneSetup(sections.sellBlock || radarPageText, 'SELL', priceMin, priceMax);

  const zoneLadder = parseZoneLadder(sections.whaleBlock || radarPageText, priceMin, priceMax);

  // Raw excerpt for logging (not sent to client in production)
  const rawExcerpt = normalise(radarPageText).slice(0, 600);

  return { at: now, spot, fusion, execution, buySetup, sellSetup, zoneLadder, rawExcerpt };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Change detection — emit events only when meaningful values change
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when two snapshots differ in a way the trader needs to know. */
export function radarChanged(prev: RadarSnapshot | null, next: RadarSnapshot): boolean {
  if (!prev) return true;

  // Price drift > $0.50
  const priceMoved =
    (prev.spot.mid !== null && next.spot.mid !== null && Math.abs((next.spot.mid ?? 0) - (prev.spot.mid ?? 0)) > 0.5) ||
    (prev.spot.bid === null) !== (next.spot.bid === null);

  // Fusion bias or confidence swing ≥ 1%
  const fusionChanged =
    prev.fusion.bias !== next.fusion.bias ||
    Math.abs((prev.fusion.confidence ?? 0) - (next.fusion.confidence ?? 0)) >= 1;

  // Gate overall status flipped
  const gateFlipped = prev.execution.overall !== next.execution.overall;

  // Setup appeared, disappeared, or price levels changed
  const setupId = (s: TradeSetup | null) => s?.id ?? 'none';
  const setupChanged = setupId(prev.buySetup) !== setupId(next.buySetup) || setupId(prev.sellSetup) !== setupId(next.sellSetup);

  // Whale or session changed
  const whaleMoved =
    prev.zoneLadder.whaleFlow !== next.zoneLadder.whaleFlow ||
    prev.zoneLadder.currentSession !== next.zoneLadder.currentSession;

  return priceMoved || fusionChanged || gateFlipped || setupChanged || whaleMoved;
}
