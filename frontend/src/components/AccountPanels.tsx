import React, { useState } from 'react';
import type { AccountSnapshot, TradeGroup, TradeLeg } from '../types';
import { fmt, pnlColor, pnlStr, groupStatusColor, dirColor, timeAgo, round } from '../lib/format';
import { EquityChart } from './EquityChart';

// ── Account Card ───────────────────────────────────────────────────────────────
export function AccountCard({ acc, token }: { acc: AccountSnapshot; token: string }) {
  const info = acc.info;
  const ddColor = acc.dailyDdPct > 4 ? 'var(--red)' : acc.dailyDdPct > 2 ? 'var(--amber)' : 'var(--green)';
  const [posLoading, setPosLoading] = useState<string | null>(null);

  const wins = acc.history?.filter((d) => d.profit > 0).length ?? 0;
  const totalClosed = acc.history?.length ?? 0;
  const winRate = totalClosed > 0 ? `${Math.round((wins / totalClosed) * 100)}%` : '—';

  const handlePosClose = async (posId: string) => {
    if (!confirm(`Close position #${posId} immediately?`)) return;
    setPosLoading(posId);
    try {
      await fetch(`/api/accounts/${acc.key}/positions/${posId}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      setPosLoading(null);
    }
  };

  const handlePosMoveBe = async (posId: string) => {
    setPosLoading(posId);
    try {
      await fetch(`/api/accounts/${acc.key}/positions/${posId}/move-be`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      setPosLoading(null);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{acc.label}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            {acc.info?.broker ?? acc.key} · {acc.info?.platform ?? '—'} · Leverage 1:{acc.info?.leverage ?? 100}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className={`pill ${acc.connected ? 'pill-green' : 'pill-red'}`}>
            <span className="pulse-dot" style={{ background: acc.connected ? 'var(--green)' : 'var(--red)' }} />
            {acc.connected ? 'Online' : 'Offline'}
          </span>
          {acc.tradingEnabled ? (
            <span className="pill pill-gold">Trading Active</span>
          ) : (
            <span className="pill pill-dim">Monitor Only</span>
          )}
        </div>
      </div>

      {info ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
          <Stat label="Balance" value={`$${info.balance.toFixed(2)}`} />
          <Stat label="Equity" value={`$${info.equity.toFixed(2)}`} />
          <Stat label="Floating P&L" value={pnlStr(acc.floating)} color={`var(--${pnlColor(acc.floating)})`} />
          <Stat
            label="Win Rate"
            value={winRate}
            color={totalClosed > 0 && wins / totalClosed >= 0.5 ? 'var(--green)' : undefined}
          />
          <Stat label="Margin Used" value={`$${info.margin.toFixed(2)}`} />
          <Stat label="Free Margin" value={`$${info.freeMargin.toFixed(2)}`} />
          <Stat
            label="Today Realized"
            value={`${pnlStr(acc.todayRealized)}${acc.todayRealizedPct !== undefined ? ` (${acc.todayRealizedPct >= 0 ? '+' : ''}${acc.todayRealizedPct.toFixed(1)}%)` : ''}`}
            color={`var(--${pnlColor(acc.todayRealized)})`}
          />
          <Stat label="Daily Drawdown" value={`${acc.dailyDdPct.toFixed(2)}%`} color={ddColor} />
        </div>
      ) : (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem', padding: '1rem 0' }}>{acc.error ?? 'Connecting to broker…'}</div>
      )}

      {/* Embedded Chart */}
      <EquityChart accountKey={acc.key} token={token} />

      {/* Live Positions on Broker */}
      {acc.positions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', marginBottom: 6 }}>
            Live Broker Open Positions ({acc.positions.length})
          </div>
          {acc.positions.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.78rem',
                padding: '6px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.02)',
                marginBottom: 6,
                borderBottom: '1px solid rgba(30,45,79,0.3)',
              }}
            >
              <div>
                <span style={{ color: `var(--${dirColor(p.type)})`, fontWeight: 700, marginRight: 8 }}>{p.type}</span>
                <span>{p.volume} lot @ {p.openPrice.toFixed(2)}</span>
                <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>#{p.id}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: 'var(--text-dim)' }}>
                  SL: {p.stopLoss?.toFixed(2) ?? '—'} | TP: {p.takeProfit?.toFixed(2) ?? '—'}
                </span>
                <span style={{ color: `var(--${pnlColor(p.profit)})`, fontWeight: 700 }}>
                  {pnlStr(p.profit)}
                </span>
                <button
                  onClick={() => handlePosMoveBe(p.id)}
                  disabled={posLoading === p.id}
                  style={{
                    fontSize: '0.68rem',
                    padding: '3px 8px',
                    background: 'rgba(59,130,246,0.15)',
                    border: '1px solid rgba(59,130,246,0.4)',
                    borderRadius: 4,
                    color: 'var(--blue)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  🛡️ Move BE
                </button>
                <button
                  onClick={() => handlePosClose(p.id)}
                  disabled={posLoading === p.id}
                  style={{
                    fontSize: '0.68rem',
                    padding: '3px 8px',
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: 4,
                    color: 'var(--red)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  ❌ Close
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card-sm" style={{ padding: '0.5rem 0.6rem' }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

// ── Trade Group Row with Leg Details & Control ─────────────────────────────────
export function TradeGroupCard({
  g,
  token,
  onRefresh,
}: {
  g: TradeGroup;
  token: string;
  onRefresh?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newSl, setNewSl] = useState(g.currentSl.toString());
  const [actionLoading, setActionLoading] = useState(false);

  const openLegs = g.legs.filter((l) => l.status === 'OPEN');
  const floatPnl = round(g.realizedPnl + openLegs.reduce((a, l) => a + (l.profit ?? 0), 0), 2);

  const handleClose = async () => {
    if (!confirm(`Are you sure you want to close trade ${g.direction} ${g.symbol}?`)) return;
    setActionLoading(true);
    try {
      await fetch(`/api/trades/${g.id}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      onRefresh?.();
    } finally {
      setActionLoading(false);
    }
  };

  const handleMoveBe = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/trades/${g.id}/move-be`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      onRefresh?.();
    } finally {
      setActionLoading(false);
    }
  };

  const handleCloseLeg = async (tpLevel: number) => {
    setActionLoading(true);
    try {
      await fetch(`/api/trades/${g.id}/legs/${tpLevel}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      onRefresh?.();
    } finally {
      setActionLoading(false);
    }
  };

  const handleModifySl = async () => {
    const parsed = parseFloat(newSl);
    if (!Number.isFinite(parsed)) return;
    setActionLoading(true);
    try {
      await fetch(`/api/trades/${g.id}/modify-sl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sl: parsed }),
      });
      onRefresh?.();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="card-sm" style={{ marginBottom: '0.75rem', borderLeft: `4px solid var(--${dirColor(g.direction)})` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: `var(--${dirColor(g.direction)})`, fontWeight: 800, fontSize: '1rem' }}>
            {g.direction}
          </span>
          <span className="pill pill-gold" style={{ fontSize: '0.7rem' }}>{g.symbol}</span>
          <span className={`pill ${groupStatusColor(g.status) === 'green' ? 'pill-green' : groupStatusColor(g.status) === 'amber' ? 'pill-amber' : 'pill-dim'}`}>
            {g.status}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{g.accountLabel}</span>
          {g.beMoved && <span className="pill pill-blue" style={{ fontSize: '0.65rem' }}>Break-Even ✓</span>}
          {g.trailedToTp1 && <span className="pill pill-green" style={{ fontSize: '0.65rem' }}>Trailed to TP1 ✓</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Net P&L</div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: `var(--${pnlColor(floatPnl)})`, fontVariantNumeric: 'tabular-nums' }}>
              {pnlStr(floatPnl)}
            </div>
          </div>
          {['OPEN'].includes(g.status) && (
            <button
              onClick={handleMoveBe}
              disabled={actionLoading}
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: 6,
                color: 'var(--blue)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🛡️ Move BE
            </button>
          )}
          {['OPEN', 'PENDING'].includes(g.status) && (
            <button
              onClick={handleClose}
              disabled={actionLoading}
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: 'rgba(239,68,68,0.2)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 6,
                color: 'var(--red)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {actionLoading ? 'Closing...' : 'Close All'}
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              fontSize: '0.75rem',
              padding: '4px 8px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-dim)',
              cursor: 'pointer',
            }}
          >
            {expanded ? '▲ Hide Legs' : '▼ View Legs'}
          </button>
        </div>
      </div>

      {/* Main pricing levels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: '0.6rem', fontSize: '0.78rem' }}>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>Entry: </span>
          <span style={{ fontWeight: 600 }}>{g.entry.toFixed(2)}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>Current SL: </span>
          <span style={{ fontWeight: 600, color: 'var(--red)' }}>{g.currentSl.toFixed(2)}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>TP1: </span>
          <span style={{ fontWeight: 600, color: 'var(--green)' }}>{g.tp1.toFixed(2)}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>TP2: </span>
          <span style={{ fontWeight: 600, color: 'var(--green)' }}>{g.tp2?.toFixed(2) ?? '—'}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>TP3: </span>
          <span style={{ fontWeight: 600, color: 'var(--green)' }}>{g.tp3?.toFixed(2) ?? '—'}</span>
        </div>
      </div>

      {/* Expanded multi-leg table & SL modification */}
      {expanded && (
        <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(30,45,79,0.5)' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
            Multi-Leg Target Breakdown (TP1 50% · TP2 30% · TP3 20%)
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.legs.map((leg) => (
              <div
                key={leg.tpLevel}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(0,0,0,0.2)',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="pill pill-gold" style={{ fontSize: '0.65rem' }}>TP {leg.tpLevel}</span>
                  <span>{leg.volume} lot @ Target: {leg.tp.toFixed(2)}</span>
                  <span className={`pill ${leg.status === 'OPEN' ? 'pill-green' : leg.status === 'CLOSED' ? 'pill-dim' : 'pill-amber'}`} style={{ fontSize: '0.65rem' }}>
                    {leg.status} {leg.closeReason ? `(${leg.closeReason})` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {leg.profit !== undefined && (
                    <span style={{ color: `var(--${pnlColor(leg.profit)})`, fontWeight: 700 }}>
                      {pnlStr(leg.profit)}
                    </span>
                  )}
                  {leg.status === 'OPEN' && (
                    <button
                      onClick={() => handleCloseLeg(leg.tpLevel)}
                      disabled={actionLoading}
                      style={{
                        fontSize: '0.65rem',
                        padding: '2px 6px',
                        background: 'rgba(239,68,68,0.15)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: 4,
                        color: 'var(--red)',
                        cursor: 'pointer',
                      }}
                    >
                      Close Leg
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Quick SL Update */}
          {['OPEN', 'PENDING'].includes(g.status) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Adjust Stop Loss:</span>
              <input
                type="number"
                step="0.1"
                value={newSl}
                onChange={(e) => setNewSl(e.target.value)}
                style={{
                  width: 90,
                  padding: '3px 6px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text)',
                  fontSize: '0.78rem',
                }}
              />
              <button
                onClick={handleModifySl}
                disabled={actionLoading}
                style={{
                  fontSize: '0.72rem',
                  padding: '3px 8px',
                  background: 'var(--gold)',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: '#000',
                }}
              >
                Update SL
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Events Feed ────────────────────────────────────────────────────────────────
const SEV_COLORS: Record<string, string> = {
  success: 'var(--green)',
  warning: 'var(--amber)',
  critical: 'var(--red)',
  info: 'var(--blue)',
};
const SEV_ICONS: Record<string, string> = { success: '✅', warning: '⚠️', critical: '🚨', info: 'ℹ️' };

export function EventFeed({ events }: { events: any[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.slice(0, 50).map((ev) => (
        <div
          key={ev.id}
          className="card-sm"
          style={{ borderLeft: `3px solid ${SEV_COLORS[ev.severity] ?? 'var(--border)'}`, padding: '0.6rem 0.75rem' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>
              {SEV_ICONS[ev.severity] ?? '•'} {ev.title}
            </div>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{timeAgo(ev.at)}</span>
          </div>
          {ev.message && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
              {ev.message.slice(0, 350)}
            </div>
          )}
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(ev.message || ev.title)}`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.68rem',
                color: '#25D366',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 600,
              }}
            >
              📱 Share on WhatsApp
            </a>
          </div>
        </div>
      ))}
      {events.length === 0 && (
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '2rem', fontSize: '0.82rem' }}>
          No events yet. The bot is actively monitoring…
        </div>
      )}
    </div>
  );
}
