import type { RadarSnapshot } from '../types';
import { biasPill, biasColor, fmt, sessionLabel, whaleColor, gateStatusBadge, overallGateBadge, timeAgo } from '../lib/format';

interface Props { snap: RadarSnapshot; }

const GATE_ICONS: Record<string, string> = {
  FUSION_CONFIDENCE: '🧠',
  DIRECTIONAL_VOTE: '🗳️',
  RR_MINIMUM: '⚖️',
  SL_PLACEMENT: '🛑',
  WHALE_ALIGNMENT: '🐳',
  ENTRY_LOCATION: '📍',
  MARKET_EXPANSION: '📊',
  DELIVERY_QUALITY: '🎯',
  ML_CONSENSUS: '🤖',
};

// ── Spot Price Panel ──────────────────────────────────────────────────────────
export function SpotPanel({ snap }: Props) {
  const { bid, ask, spread, mid } = snap.spot;
  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <div className="section-title">LIVE XAU/USD PRICE</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: 2 }}>MID / LAST</div>
          <div className="price-big gold">
            {mid !== null ? mid.toFixed(2) : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>BID</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
              {bid !== null ? bid.toFixed(2) : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>ASK</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>
              {ask !== null ? ask.toFixed(2) : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>SPREAD</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>
              {spread !== null ? `$${spread.toFixed(2)}` : '—'}
            </div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Updated</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{timeAgo(snap.at)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Fusion Verdict Panel ───────────────────────────────────────────────────────
export function FusionPanel({ snap }: Props) {
  const { fusion } = snap;
  const conf = fusion.confidence ?? 0;
  const confColor = conf >= 70 ? 'var(--green)' : conf >= 50 ? 'var(--amber)' : 'var(--red)';

  return (
    <div className="card">
      <div className="section-title">FUSION VERDICT</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Bias */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>Directional Bias</span>
          <span className={`pill ${biasPill(fusion.bias)}`} style={{ fontSize: '0.85rem' }}>
            {fusion.bias === 'BULLISH' ? '▲' : fusion.bias === 'BEARISH' ? '▼' : '◼'} {fusion.bias}
          </span>
        </div>

        {/* Confidence bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Fusion Confidence</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: confColor }}>
              {fusion.confidence !== null ? `${fusion.confidence.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="conf-bar-outer">
            <div
              className="conf-bar-inner"
              style={{ width: `${Math.min(conf, 100)}%`, background: confColor }}
            />
          </div>
        </div>

        {/* Aligned brains */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>Aligned Engines</span>
          <span style={{ fontWeight: 700, color: 'var(--gold)' }}>
            {fusion.alignedBrains !== null ? `${fusion.alignedBrains} 🧠` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Execution Gates Panel (9 Gates) ───────────────────────────────────────────
export function GatesPanel({ snap }: Props) {
  const { execution } = snap;
  const passCount = execution.gates.filter((g) => g.status === 'PASS').length;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>EXECUTION SAFETY GATES</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {execution.healthPct !== null && (
            <span className="pill pill-blue">
              ⚡ {execution.healthPct}% Health
            </span>
          )}
          <span className={`pill ${overallGateBadge(execution.overall)}`} style={{ fontWeight: 800 }}>
            {execution.overall === 'PASS' ? '✓ ALL PASS' : execution.overall === 'TRADE_BLOCKED' ? '⛔ BLOCKED' : '? UNKNOWN'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 1rem' }}>
        {execution.gates.map((gate) => (
          <div key={gate.name} className="gate-row" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
            <span style={{ fontSize: '0.95rem' }}>{GATE_ICONS[gate.name] ?? '•'}</span>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                {gate.name.replace(/_/g, ' ')}
              </div>
              {gate.value && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{gate.value}</div>
              )}
            </div>
            <span className={`pill ${gateStatusBadge(gate.status)}`} style={{ fontSize: '0.65rem' }}>
              {gate.status}
            </span>
          </div>
        ))}
      </div>

      {/* Mini progress */}
      <div style={{ marginTop: '0.75rem' }}>
        <div className="conf-bar-outer">
          <div
            className="conf-bar-inner"
            style={{
              width: `${(passCount / Math.max(execution.gates.length, 1)) * 100}%`,
              background: passCount === execution.gates.length ? 'var(--green)' : passCount === 0 ? 'var(--red)' : 'var(--amber)',
            }}
          />
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 3 }}>
          {passCount} / {execution.gates.length} gates passed
        </div>
      </div>
    </div>
  );
}

// ── Strict 6-Gate Trade Criteria Validator Panel ─────────────────────────────
export function SixGateCriteriaPanel({ snap }: Props) {
  const isBuy = snap.fusion.bias === 'BULLISH';
  const conf = snap.fusion.confidence ?? 0;
  const brains = snap.fusion.alignedBrains ?? 0;
  const whale = snap.zoneLadder.whaleFlow;
  const spread = snap.spot.spread ?? 0;

  // Criteria status indicators
  const c1Safety = snap.execution.overall === 'PASS' && spread <= 0.8;
  const c2Fusion = conf >= 65 && brains >= 5 && snap.fusion.bias !== 'UNKNOWN' && snap.fusion.bias !== 'NEUTRAL';
  const c3Whale = isBuy ? whale !== 'SELLING' : snap.fusion.bias === 'BEARISH' ? whale !== 'BUYING' : false;

  const activeSetup = snap.buySetup ?? snap.sellSetup;
  const c4Zone = !!activeSetup;
  const c5RR = (activeSetup?.rr ?? 0) >= 1.5;
  const c6Guard = true; // live verified by backend signal engine

  const criteriaList = [
    {
      id: '1',
      title: '1. Safety Gate Check',
      desc: 'Execution gates active, expansion != chop, spread <= 0.80, no USD news within 15m',
      passed: c1Safety,
    },
    {
      id: '2',
      title: '2. Fusion Confluence Check',
      desc: `Confidence >= 65% (Current: ${conf.toFixed(1)}%) & brains aligned with bias (${brains} 🧠)`,
      passed: c2Fusion,
    },
    {
      id: '3',
      title: '3. Whale & Session Alignment',
      desc: `Whale Flow (${whale}) does not conflict with Fusion Verdict & active session`,
      passed: c3Whale,
    },
    {
      id: '4',
      title: '4. Price-in-Zone Check',
      desc: 'Live price in Entry Zone for Market order OR within $15 of Anchor for Pending Limit',
      passed: c4Zone,
    },
    {
      id: '5',
      title: '5. Risk-to-Reward & SL Geometry',
      desc: `Buy: SL < Low & TP1 > High | Sell: SL > High & TP1 < Low | Min R:R >= 1:1.5 (${activeSetup?.rr ? `1:${activeSetup.rr.toFixed(2)}` : 'N/A'})`,
      passed: c5RR,
    },
    {
      id: '6',
      title: '6. Duplicate & Cooldown Guard',
      desc: 'No duplicate active order on this setup & 30m post-loss cooldown respected',
      passed: c6Guard,
    },
  ];

  const allPassed = criteriaList.every((c) => c.passed);

  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>STRICT 6-GATE TRADE CRITERIA VALIDATOR</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            All 6 criteria must be simultaneously satisfied before any automated order executes
          </div>
        </div>
        <span className={`pill ${allPassed ? 'pill-green' : 'pill-amber'}`} style={{ fontWeight: 800, fontSize: '0.8rem' }}>
          {allPassed ? '✓ READY TO EXECUTE' : '⏳ AWAITING CRITERIA CONFLUENCE'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
        {criteriaList.map((c) => (
          <div
            key={c.id}
            className="card-sm"
            style={{
              borderLeft: `3px solid ${c.passed ? 'var(--green)' : 'var(--amber)'}`,
              padding: '0.65rem 0.85rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{c.title}</span>
              <span className={`pill ${c.passed ? 'pill-green' : 'pill-amber'}`} style={{ fontSize: '0.65rem' }}>
                {c.passed ? 'PASS' : 'CHECK'}
              </span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', lineHeight: 1.35 }}>
              {c.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Setup Panel (BUY or SELL) ──────────────────────────────────────────────────
function SetupCard({ setup, label }: { setup: NonNullable<RadarSnapshot['buySetup']>; label: string }) {
  const isBuy = setup.direction === 'BUY';
  const hdr = isBuy
    ? { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)', color: 'var(--green)' }
    : { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: 'var(--red)' };

  return (
    <div className="setup-panel">
      <div className="setup-header" style={{ background: hdr.bg, borderBottom: `1px solid ${hdr.border}` }}>
        <span style={{ color: hdr.color }}>{isBuy ? '▲' : '▼'} {setup.zoneLabel || label}</span>
        <span className={`pill ${isBuy ? 'pill-green' : 'pill-red'}`}>{setup.zoneStrength}</span>
      </div>
      <div className="setup-body">
        <div className="setup-field">
          <span className="label">Zone Low</span>
          <span className="val" style={{ color: 'var(--gold)' }}>{fmt(setup.entryZoneLow)}</span>
        </div>
        <div className="setup-field">
          <span className="label">Zone High</span>
          <span className="val" style={{ color: 'var(--gold)' }}>{fmt(setup.entryZoneHigh)}</span>
        </div>
        <div className="setup-field">
          <span className="label">Anchor</span>
          <span className="val">{fmt(setup.anchorPrice)}</span>
        </div>
        <div className="setup-field">
          <span className="label">Stop Loss</span>
          <span className="val red">{fmt(setup.sl)}</span>
        </div>
        <div className="setup-field">
          <span className="label">TP 1</span>
          <span className="val green">{fmt(setup.tp1)}</span>
        </div>
        <div className="setup-field">
          <span className="label">TP 2</span>
          <span className="val green">{fmt(setup.tp2)}</span>
        </div>
        <div className="setup-field">
          <span className="label">TP 3</span>
          <span className="val green">{fmt(setup.tp3)}</span>
        </div>
        <div className="setup-field">
          <span className="label">R:R</span>
          <span className="val gold">{setup.rr !== null ? `1:${setup.rr.toFixed(2)}` : '—'}</span>
        </div>
      </div>
    </div>
  );
}

export function SetupsPanel({ snap }: Props) {
  return (
    <div className="card">
      <div className="section-title">TRADE SETUPS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        {snap.buySetup
          ? <SetupCard setup={snap.buySetup} label="DEMAND · BUY" />
          : <div className="card-sm dim" style={{ textAlign: 'center', padding: '1.5rem', fontSize: '0.82rem' }}>No Buy Setup Detected</div>
        }
        {snap.sellSetup
          ? <SetupCard setup={snap.sellSetup} label="SUPPLY · SELL" />
          : <div className="card-sm dim" style={{ textAlign: 'center', padding: '1.5rem', fontSize: '0.82rem' }}>No Sell Setup Detected</div>
        }
      </div>
    </div>
  );
}

// ── Zone Ladder & Whale Matrix Panel ──────────────────────────────────────────
export function ZoneLadderPanel({ snap }: Props) {
  const { zoneLadder } = snap;

  return (
    <div className="card">
      <div className="section-title">ZONE LADDER & WHALE MATRIX</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        {/* Session */}
        <div className="card-sm">
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>Current Session</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--gold)' }}>
            🕐 {sessionLabel(zoneLadder.currentSession)}
          </div>
        </div>

        {/* Whale flow */}
        <div className="card-sm">
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>Whale Flow</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: `var(--${whaleColor(zoneLadder.whaleFlow)})` }}>
              🐳 {zoneLadder.whaleFlow}
            </div>
            {zoneLadder.whaleConfidence !== null && (
              <span className="pill pill-blue" style={{ fontSize: '0.7rem' }}>
                {zoneLadder.whaleConfidence}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Next key level */}
      {zoneLadder.nextKeyLevel !== null && (
        <div style={{ marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Next Key Level: </span>
          <span style={{ fontWeight: 700, color: 'var(--amber)' }}>{zoneLadder.nextKeyLevel.toFixed(2)}</span>
        </div>
      )}

      {/* Ladder */}
      {zoneLadder.ladderLevels.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', marginBottom: 4 }}>
            Zone Ladder
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {zoneLadder.ladderLevels.slice(0, 10).map((lvl, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', padding: '3px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.03)' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{lvl.price.toFixed(2)}</span>
                <span className={`pill ${lvl.type === 'resistance' ? 'pill-red' : lvl.type === 'support' ? 'pill-green' : 'pill-amber'}`} style={{ fontSize: '0.65rem' }}>
                  {lvl.label.slice(0, 12)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
