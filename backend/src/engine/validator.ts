/**
 * validator.ts — Module 2: Strict 6-Gate Trade Criteria Validator
 *
 * Before placing any automatic trade, the Decision Engine MUST verify that
 * ALL 6 criteria are satisfied simultaneously:
 *
 * 1. Safety Gate Check:
 *    - Execution Safety Gates must NOT be blocked (overall != TRADE_BLOCKED).
 *    - Market Expansion is NOT "CHOP MARKET" (gate passed, no chop indicators).
 *    - Live spread is below user-configured max spread (e.g. 0.80).
 *    - No high-impact USD news is within 15 minutes (news/blackout window).
 *
 * 2. Fusion Confluence Check:
 *    - Fusion Confidence must be >= 65% (configurable via minFusionConfidence).
 *    - Brains Agreement must align with the trade direction (BUY -> BULLISH, SELL -> BEARISH).
 *    - Aligned engine count >= minBrainsAgreement (e.g. >= 5).
 *
 * 3. Whale & Session Alignment:
 *    - Whale Matrix flow must NOT conflict with the Fusion Verdict / trade direction
 *      (BUY cannot have SELLING flow; SELL cannot have BUYING flow).
 *    - Must be in an active trading session (ASIA, LONDON, NEW YORK).
 *
 * 4. Price-in-Zone Check:
 *    - Live XAU/USD price is inside valid Entry Zone (Entry Low <= Live Price <= Entry High) -> MARKET order.
 *    - OR if configured for Pending Orders, place a BUY LIMIT / SELL LIMIT at the Anchor Price
 *      when price is within $15 of the zone (and on the pullback side).
 *
 * 5. Risk-to-Reward & SL Validation:
 *    - For BUY setups: SL < Entry Low AND TP1 > Entry High.
 *    - For SELL setups: SL > Entry High AND TP1 < Entry Low.
 *    - Minimum Risk-to-Reward ratio (R:R) >= 1:1.5.
 *    - SL distance within configured range ($2 min to $30 max).
 *
 * 6. Duplicate & Cooldown Guard:
 *    - Ensure NO duplicate trade is opened for the same zone/signal if an order is already active.
 *    - Enforce a configurable cooldown after any Stop Loss hit (e.g. 30 minutes).
 */

import type {
  GateResult,
  OrderKind,
  Quote,
  RuntimeSettings,
  Signal,
  TradeGroup,
} from '../types';
import type { RadarSnapshot } from '../scraper/radar-parser';
import { execPrice, inWindows, weightedRR } from './gates';

export interface SixGateInput {
  signal: Signal;
  snapshot: RadarSnapshot;
  quote: Quote | null;
  settings: RuntimeSettings;
  activeGroups: TradeGroup[];
  lastLossAt: number | null;
  now?: number;
}

export interface SixGateEvaluation {
  allPassed: boolean;
  orderKind: OrderKind | null;
  orderPrice?: number;
  gates: {
    gate1Safety: GateResult;
    gate2Fusion: GateResult;
    gate3WhaleSession: GateResult;
    gate4PriceInZone: GateResult;
    gate5RiskRewardSl: GateResult;
    gate6DuplicateCooldown: GateResult;
  };
  results: GateResult[];
}

const fmt = (n: number, d = 2) => n.toFixed(d);

/**
 * Validates whether the current moment is within `blackoutMin` minutes of any
 * configured blackout/news time window.
 */
export function isNearNewsBlackout(now: number, blackoutSpec: string, blackoutMin: number): boolean {
  if (!blackoutSpec || !blackoutSpec.trim()) return false;
  // Check exact blackout window first
  if (inWindows(now, blackoutSpec)) return true;

  // Check proximity (+/- blackoutMin minutes)
  const padMs = blackoutMin * 60_000;
  if (inWindows(now + padMs, blackoutSpec)) return true;
  if (inWindows(now - padMs, blackoutSpec)) return true;

  return false;
}

/**
 * Primary 6-Gate Validator function.
 */
export function validateSixGates(input: SixGateInput): SixGateEvaluation {
  const { signal: sig, snapshot: snap, quote, settings: s, activeGroups } = input;
  const now = input.now ?? Date.now();

  const isBuy = sig.direction === 'BUY';

  // ─────────────────────────────────────────────────────────────────────────
  // GATE 1: Safety Gate Check
  // ─────────────────────────────────────────────────────────────────────────
  //  - Execution Safety Gates must NOT be blocked
  //  - Market Expansion is not CHOP MARKET
  //  - Spread is below user-configured max spread (e.g. 0.80)
  //  - No high-impact USD news is within 15 minutes
  let gate1Passed = true;
  const gate1Issues: string[] = [];

  // Check 1.1: Overall radar status
  if (snap.execution.overall === 'TRADE_BLOCKED') {
    gate1Passed = false;
    gate1Issues.push(`Radar overall: TRADE BLOCKED (Health ${snap.execution.healthPct ?? '?'}%)`);
  }

  // Check 1.2: Market Expansion is not CHOP MARKET
  const marketExpansionGate = snap.execution.gates.find((g) => g.name === 'MARKET_EXPANSION');
  const chopDetected =
    (marketExpansionGate && marketExpansionGate.status === 'FAIL') ||
    (marketExpansionGate?.value && /CHOP|CHOPPY|SIDEWAYS|CONSOLIDAT/i.test(marketExpansionGate.value)) ||
    /CHOP\s*MARKET|CHOPPY|EXPANSION:\s*FAIL/i.test(snap.execution.rawText);

  if (chopDetected) {
    gate1Passed = false;
    gate1Issues.push('Market Expansion is CHOP MARKET (sideways/consolidation)');
  }

  // Check 1.3: Spread
  let liveSpread = 0;
  if (!quote) {
    gate1Passed = false;
    gate1Issues.push('No live quote available to verify spread');
  } else {
    liveSpread = quote.ask - quote.bid;
    if (liveSpread > s.maxSpread) {
      gate1Passed = false;
      gate1Issues.push(`Spread $${fmt(liveSpread)} exceeds max $${fmt(s.maxSpread)}`);
    }
  }

  // Check 1.4: High-impact USD news within 15 minutes
  const nearNews = isNearNewsBlackout(now, s.blackoutWindows, s.newsBlackoutMin);
  if (nearNews) {
    gate1Passed = false;
    gate1Issues.push(`Within ${s.newsBlackoutMin}m of high-impact USD news blackout window`);
  }

  const gate1Result: GateResult = {
    id: 'GATE_1_SAFETY',
    name: 'Gate 1: Safety Gate Check (Expansion, Spread, News)',
    passed: gate1Passed,
    detail: gate1Passed
      ? `PASS — Expansion active, spread $${fmt(liveSpread)} <= $${fmt(s.maxSpread)}, news clear`
      : `BLOCKED — ${gate1Issues.join('; ')}`,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GATE 2: Fusion Confluence Check
  // ─────────────────────────────────────────────────────────────────────────
  //  - Fusion Confidence must be >= 65% (configurable)
  //  - Brains Agreement must align with the trade direction
  let gate2Passed = true;
  const gate2Issues: string[] = [];

  const conf = snap.fusion.confidence;
  if (conf === null || conf < s.minFusionConfidence) {
    gate2Passed = false;
    gate2Issues.push(
      `Fusion Confidence ${conf !== null ? `${fmt(conf, 1)}%` : 'N/A'} < required ${s.minFusionConfidence}%`
    );
  }

  const expectedBias = isBuy ? 'BULLISH' : 'BEARISH';
  if (snap.fusion.bias !== expectedBias) {
    gate2Passed = false;
    gate2Issues.push(`Fusion bias is ${snap.fusion.bias}, but trade setup is ${sig.direction}`);
  }

  const brains = snap.fusion.alignedBrains;
  if (brains !== null && brains < s.minBrainsAgreement) {
    gate2Passed = false;
    gate2Issues.push(`Aligned Brains: ${brains} < required ${s.minBrainsAgreement}`);
  }

  const gate2Result: GateResult = {
    id: 'GATE_2_FUSION',
    name: 'Gate 2: Fusion Confluence (Confidence >= 65% & Brains)',
    passed: gate2Passed,
    detail: gate2Passed
      ? `PASS — Confidence ${conf !== null ? `${fmt(conf, 1)}%` : 'OK'} >= ${s.minFusionConfidence}%, Bias ${snap.fusion.bias}, Brains ${brains ?? 'aligned'}`
      : `BLOCKED — ${gate2Issues.join('; ')}`,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GATE 3: Whale & Session Alignment
  // ─────────────────────────────────────────────────────────────────────────
  //  - Whale Matrix flow must NOT conflict with the Fusion Verdict
  //  - Must align with active session
  let gate3Passed = true;
  const gate3Issues: string[] = [];

  const whale = snap.zoneLadder.whaleFlow;
  // Conflict definition: BUY cannot be SELLING; SELL cannot be BUYING
  if (isBuy && whale === 'SELLING') {
    gate3Passed = false;
    gate3Issues.push(`Whale Flow is SELLING — conflicts with BUY setup`);
  } else if (!isBuy && whale === 'BUYING') {
    gate3Passed = false;
    gate3Issues.push(`Whale Flow is BUYING — conflicts with SELL setup`);
  }

  const session = snap.zoneLadder.currentSession;
  const validSessions = ['ASIA', 'LONDON', 'NEW_YORK'];
  if (session !== 'UNKNOWN' && !validSessions.includes(session)) {
    gate3Passed = false;
    gate3Issues.push(`Session ${session} is not an active trading session`);
  }

  const gate3Result: GateResult = {
    id: 'GATE_3_WHALE_SESSION',
    name: 'Gate 3: Whale & Session Alignment',
    passed: gate3Passed,
    detail: gate3Passed
      ? `PASS — Whale Flow: ${whale} (aligned), Session: ${session}`
      : `BLOCKED — ${gate3Issues.join('; ')}`,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GATE 4: Price-in-Zone Check
  // ─────────────────────────────────────────────────────────────────────────
  //  - Live XAU/USD price must enter the valid Entry Zone
  //    (Entry Low <= Live Price <= Entry High) -> MARKET order
  //  - OR if configured for Pending Orders, place a BUY LIMIT / SELL LIMIT
  //    at the Anchor Price when price is within $15 of the zone.
  let gate4Passed = false;
  let orderKind: OrderKind | null = null;
  let orderPrice: number | undefined = undefined;
  let gate4Detail = '';

  const zoneLow = sig.entryLow ?? sig.entry;
  const zoneHigh = sig.entryHigh ?? sig.entry;
  const anchor = sig.anchorPrice ?? sig.entry;

  if (!quote) {
    gate4Detail = 'BLOCKED — No live quote to evaluate price against entry zone';
  } else {
    const livePrice = execPrice(sig.direction, quote);

    // Case A: Price is inside the Entry Zone
    if (livePrice >= zoneLow - 0.05 && livePrice <= zoneHigh + 0.05) {
      gate4Passed = true;
      orderKind = 'MARKET';
      orderPrice = livePrice;
      gate4Detail = `PASS (MARKET) — Price $${fmt(livePrice)} is INSIDE Entry Zone [$${fmt(zoneLow)} – $${fmt(zoneHigh)}]`;
    }
    // Case B: Pending Order (Limit at Anchor within $15 of zone)
    else if (s.allowPendingOrders) {
      const distFromAnchor = Math.abs(livePrice - anchor);
      const isPullbackPosition = isBuy ? livePrice > zoneHigh : livePrice < zoneLow;

      if (distFromAnchor <= s.maxLimitProximity && isPullbackPosition) {
        gate4Passed = true;
        orderKind = 'LIMIT';
        orderPrice = anchor;
        gate4Detail = `PASS (LIMIT) — Price $${fmt(livePrice)} is $${fmt(distFromAnchor)} from Anchor $${fmt(anchor)} (<= $${s.maxLimitProximity}). Placing ${sig.direction} LIMIT at $${fmt(anchor)}`;
      } else if (!isPullbackPosition) {
        gate4Detail = `BLOCKED — Price $${fmt(livePrice)} is on wrong side of zone [$${fmt(zoneLow)} – $${fmt(zoneHigh)}] for limit pullback`;
      } else {
        gate4Detail = `BLOCKED — Price $${fmt(livePrice)} is $${fmt(distFromAnchor)} away from Anchor $${fmt(anchor)} (exceeds max proximity $${s.maxLimitProximity})`;
      }
    } else {
      gate4Detail = `BLOCKED — Price $${fmt(livePrice)} is outside zone [$${fmt(zoneLow)} – $${fmt(zoneHigh)}] and pending orders disabled`;
    }
  }

  const gate4Result: GateResult = {
    id: 'GATE_4_PRICE_IN_ZONE',
    name: 'Gate 4: Price-in-Zone Check (Market in Zone OR Limit within $15)',
    passed: gate4Passed,
    detail: gate4Detail,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GATE 5: Risk-to-Reward & SL Validation
  // ─────────────────────────────────────────────────────────────────────────
  //  - For Buy setups: SL < Entry Low AND TP1 > Entry High
  //  - For Sell setups: SL > Entry High AND TP1 < Entry Low
  //  - Minimum R:R >= 1:1.5
  let gate5Passed = true;
  const gate5Issues: string[] = [];

  // Check 5.1: Geometry
  if (isBuy) {
    if (sig.sl >= zoneLow) {
      gate5Passed = false;
      gate5Issues.push(`Buy SL $${fmt(sig.sl)} must be strictly below Entry Low $${fmt(zoneLow)}`);
    }
    if (sig.tp1 <= zoneHigh) {
      gate5Passed = false;
      gate5Issues.push(`Buy TP1 $${fmt(sig.tp1)} must be strictly above Entry High $${fmt(zoneHigh)}`);
    }
  } else {
    if (sig.sl <= zoneHigh) {
      gate5Passed = false;
      gate5Issues.push(`Sell SL $${fmt(sig.sl)} must be strictly above Entry High $${fmt(zoneHigh)}`);
    }
    if (sig.tp1 >= zoneLow) {
      gate5Passed = false;
      gate5Issues.push(`Sell TP1 $${fmt(sig.tp1)} must be strictly below Entry Low $${fmt(zoneLow)}`);
    }
  }

  // Check 5.2: SL distance
  const slDistance = Math.abs(sig.entry - sig.sl);
  if (slDistance < s.minSlDistance || slDistance > s.maxSlDistance) {
    gate5Passed = false;
    gate5Issues.push(`SL distance $${fmt(slDistance)} outside limits [$${s.minSlDistance} – $${s.maxSlDistance}]`);
  }

  // Check 5.3: Reward-to-Risk ratio >= 1:1.5
  const effectiveEntry = orderPrice ?? sig.entry;
  const rr = weightedRR(sig, effectiveEntry, s.tpSplit);
  const minRequiredRR = Math.max(s.minRR, 1.5); // Strict 1:1.5 baseline
  if (rr < minRequiredRR) {
    gate5Passed = false;
    gate5Issues.push(`Weighted R:R 1:${fmt(rr)} is below minimum 1:${fmt(minRequiredRR)}`);
  }

  const gate5Result: GateResult = {
    id: 'GATE_5_RISK_REWARD_SL',
    name: 'Gate 5: Risk-to-Reward & SL Geometry (Min R:R >= 1:1.5)',
    passed: gate5Passed,
    detail: gate5Passed
      ? `PASS — SL geometry valid, SL dist $${fmt(slDistance)}, Weighted R:R 1:${fmt(rr)} >= 1:${fmt(minRequiredRR)}`
      : `BLOCKED — ${gate5Issues.join('; ')}`,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GATE 6: Duplicate & Cooldown Guard
  // ─────────────────────────────────────────────────────────────────────────
  //  - Ensure NO duplicate trade is opened for the same zone if an order is active
  //  - Enforce configurable cooldown after any Stop Loss hit
  let gate6Passed = true;
  const gate6Issues: string[] = [];

  // Check 6.1: Duplicate active order on this setup
  const isDuplicate = activeGroups.some((g) => {
    if (g.signalId === sig.id) return true;
    // Also guard same direction and overlapping entry zone (within $1.00)
    if (g.direction === sig.direction && Math.abs(g.entry - sig.entry) <= 1.0) return true;
    return false;
  });

  if (isDuplicate) {
    gate6Passed = false;
    gate6Issues.push(`A trade is already active on this setup/zone (Active: ${activeGroups.length})`);
  }

  // Check 6.2: Post-loss cooldown
  if (input.lastLossAt !== null) {
    const elapsed = now - input.lastLossAt;
    const cooldownMs = s.cooldownAfterLossMin * 60_000;
    if (elapsed < cooldownMs) {
      gate6Passed = false;
      const minLeft = Math.ceil((cooldownMs - elapsed) / 60_000);
      gate6Issues.push(`Post-loss cooldown active (${minLeft} minutes remaining)`);
    }
  }

  const gate6Result: GateResult = {
    id: 'GATE_6_DUPLICATE_COOLDOWN',
    name: 'Gate 6: Duplicate & Cooldown Guard',
    passed: gate6Passed,
    detail: gate6Passed
      ? 'PASS — No active duplicate trade and cooldown elapsed'
      : `BLOCKED — ${gate6Issues.join('; ')}`,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Final Verdict: ALL 6 gates must pass simultaneously
  // ─────────────────────────────────────────────────────────────────────────
  const sixGates = [
    gate1Result,
    gate2Result,
    gate3Result,
    gate4Result,
    gate5Result,
    gate6Result,
  ];

  const allPassed = sixGates.every((g) => g.passed);

  return {
    allPassed,
    orderKind: allPassed ? orderKind : null,
    orderPrice: allPassed ? orderPrice : undefined,
    gates: {
      gate1Safety: gate1Result,
      gate2Fusion: gate2Result,
      gate3WhaleSession: gate3Result,
      gate4PriceInZone: gate4Result,
      gate5RiskRewardSl: gate5Result,
      gate6DuplicateCooldown: gate6Result,
    },
    results: sixGates,
  };
}
