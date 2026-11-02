import React, { useState, useEffect } from 'react';
import { useLive } from './hooks/useLive';
import { SpotPanel, FusionPanel, GatesPanel, SetupsPanel, ZoneLadderPanel, SixGateCriteriaPanel } from './components/RadarPanels';
import { AccountCard, TradeGroupCard } from './components/AccountPanels';
import { SettingsPanel } from './components/SettingsPanel';
import { CredentialsModal } from './components/CredentialsModal';
import { SearchableLogTable } from './components/SearchableLogTable';
import type { TradeGroup } from './types';
import { pnlStr, pnlColor } from './lib/format';

type Tab = 'radar' | 'accounts' | 'trades' | 'events' | 'settings';

const TOKEN_KEY = 'xau_token';

function getToken() {
  return (import.meta.env['VITE_ADMIN_TOKEN'] as string) || localStorage.getItem(TOKEN_KEY) || '';
}

interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  breakEven: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  currentStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;
  todayPnl: number;
  todayTrades: number;
  weekPnl: number;
  avgDuration: string;
  profitFactor: number;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('radar');
  const [token, setToken] = useState(getToken);
  const [inputToken, setInputToken] = useState('');
  const [credModalOpen, setCredModalOpen] = useState(false);
  const live = useLive();

  const [stats, setStats] = useState<TradeStats | null>(null);
  const [allTrades, setAllTrades] = useState<TradeGroup[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradeSearch, setTradeSearch] = useState('');
  const [tradeAccountFilter, setTradeAccountFilter] = useState<'ALL' | 'demo' | 'live'>('ALL');

  const fetchTradeData = () => {
    if (!token) return;
    setTradesLoading(true);
    Promise.all([
      fetch('/api/trades/stats', { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/trades?limit=100', { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([s, t]) => {
        if (s) setStats(s);
        if (t) setAllTrades(t);
      })
      .finally(() => setTradesLoading(false));
  };

  useEffect(() => {
    if (tab === 'trades' && token) {
      fetchTradeData();
    }
  }, [tab, token]);

  const filterTrade = (t: TradeGroup) => {
    if (tradeAccountFilter !== 'ALL' && t.account !== tradeAccountFilter) return false;
    if (tradeSearch.trim()) {
      const q = tradeSearch.toLowerCase();
      const matchId = t.id.toLowerCase().includes(q);
      const matchSym = t.symbol.toLowerCase().includes(q);
      const matchDir = t.direction.toLowerCase().includes(q);
      const matchLabel = t.accountLabel.toLowerCase().includes(q);
      return matchId || matchSym || matchDir || matchLabel;
    }
    return true;
  };

  const activeGroups = (allTrades.length > 0 ? allTrades.filter((t) => ['PENDING', 'OPEN'].includes(t.status)) : live.trades).filter(filterTrade);
  const closedGroups = allTrades.filter((t) => ['CLOSED', 'CANCELLED', 'FAILED'].includes(t.status)).filter(filterTrade);

  const handleToggleAuto = (val: boolean) => {
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ autoTrading: val }),
    });
  };

  const handleModeChange = (val: string) => {
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tradingMode: val }),
    });
  };

  const handleToggleKillSwitch = () => {
    const newVal = !live.settings?.killSwitch;
    fetch('/api/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: newVal }),
    });
  };

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: 380, textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem' }}>🏅 XAUUSD 007 Bot</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '1.25rem' }}>
            Automated Trading, Multi-Gate Execution & Alert Engine
          </div>
          <input
            type="password"
            placeholder="Enter ADMIN_TOKEN from .env..."
            value={inputToken}
            onChange={(e) => setInputToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputToken.trim()) {
                localStorage.setItem(TOKEN_KEY, inputToken.trim());
                setToken(inputToken.trim());
              }
            }}
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'var(--bg-card2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: '0.9rem',
              marginBottom: '1rem',
            }}
          />
          <button
            onClick={() => {
              if (inputToken.trim()) {
                localStorage.setItem(TOKEN_KEY, inputToken.trim());
                setToken(inputToken.trim());
              }
            }}
            style={{
              width: '100%',
              padding: '10px',
              background: 'var(--gold)',
              border: 'none',
              borderRadius: 8,
              fontWeight: 800,
              cursor: 'pointer',
              fontSize: '0.9rem',
              color: '#000',
            }}
          >
            Authenticate & Launch Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          background: 'var(--bg-card)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>🏅 XAUUSD Bot</span>
          <span className="pill pill-gold" style={{ fontSize: '0.75rem' }}>Bond 007 Swing Radar</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Scanner Status */}
          <span className="pill pill-blue" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pulse-dot" style={{ background: 'var(--blue)' }} />
            Scanner: Checking 3-5s
          </span>

          {/* Master Auto-Trading Toggle */}
          {live.settings && (
            <button
              onClick={() => handleToggleAutoTrading(!live.settings!.autoTrading)}
              className={`pill ${live.settings.autoTrading ? 'pill-green' : 'pill-amber'}`}
              style={{ border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
              title="Click to toggle Auto-Trading on/off"
            >
              <span>{live.settings.autoTrading ? '⚡ Auto-Trading ON' : '⏸️ Auto-Trading OFF'}</span>
            </button>
          )}

          {/* Execution Mode Selector Dropdown */}
          {live.settings && (
            <select
              value={live.settings.tradingMode}
              onChange={(e) => handleModeChange(e.target.value)}
              style={{
                background: 'var(--bg-card2)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: '4px 10px',
                color: 'var(--text)',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <option value="DEMO_ONLY">Demo Account (Safe)</option>
              <option value="LIVE_ONLY">Live Account</option>
              <option value="DUAL_MIRROR">Both (Dual Mirror)</option>
            </select>
          )}

          {/* Kill Switch Toggle */}
          {live.settings && (
            <button
              onClick={handleToggleKillSwitch}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <span
                className={`pill ${live.settings.killSwitch ? 'pill-red' : 'pill-dim'}`}
                style={{ fontWeight: 800, fontSize: '0.72rem' }}
              >
                🛑 {live.settings.killSwitch ? 'HALTED (KILL SWITCH)' : 'Kill Switch'}
              </span>
            </button>
          )}

          {/* Settings & Credentials Modal Button */}
          <button
            onClick={() => setCredModalOpen(true)}
            style={{
              padding: '4px 12px',
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: 20,
              color: 'var(--gold)',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ⚙️ Credentials & Settings
          </button>
        </div>
      </header>

      {/* Navigation Tab Bar */}
      <div style={{ padding: '0 1.5rem', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <div className="tab-bar" style={{ borderBottom: 'none', marginBottom: 0 }}>
          {[
            { id: 'radar', label: '📡 Bond 007 Radar' },
            { id: 'accounts', label: '💼 Accounts & Equity' },
            { id: 'trades', label: `📊 Trades & Analytics (${activeGroups.length} Open)` },
            { id: 'events', label: `📋 Alert Log (${live.events.length})` },
            { id: 'settings', label: '⚙️ Settings & Risk' },
          ].map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id as Tab)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
        {/* TAB 1: RADAR */}
        {tab === 'radar' &&
          (live.snapshot ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <SpotPanel snap={live.snapshot} />
              <FusionPanel snap={live.snapshot} />
              <GatesPanel snap={live.snapshot} />
              <ZoneLadderPanel snap={live.snapshot} />
              <SixGateCriteriaPanel snap={live.snapshot} />
              <div style={{ gridColumn: 'span 2' }}>
                <SetupsPanel snap={live.snapshot} />
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--text-dim)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📡</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Starting Headless Chromium & Scraping Feed…</div>
              <div style={{ fontSize: '0.85rem', marginTop: 8 }}>
                Connecting to https://xauusdlivechart.com/007 every 3–5 seconds. This takes 10–25s on startup.
              </div>
            </div>
          ))}

        {/* TAB 2: ACCOUNTS */}
        {tab === 'accounts' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.25rem' }}>
            {live.accounts.length === 0 ? (
              <div className="card" style={{ gridColumn: 'span 2', textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                No trading accounts configured. Set DEMO_ACCOUNT_ID and/or LIVE_ACCOUNT_ID in .env.
              </div>
            ) : (
              live.accounts.map((acc) => <AccountCard key={acc.key} acc={acc} token={token} />)
            )}
          </div>
        )}

        {/* TAB 3: TRADES & ANALYTICS */}
        {tab === 'trades' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Stats Summary Row */}
            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.75rem' }}>
                <div className="card-sm">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Win Rate</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: stats.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>
                    {stats.winRate}%
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
                    {stats.wins}W / {stats.losses}L / {stats.breakEven}BE
                  </div>
                </div>

                <div className="card-sm">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Total Net Realized</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: `var(--${pnlColor(stats.totalPnl)})` }}>
                    {pnlStr(stats.totalPnl)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{stats.total} total trades</div>
                </div>

                <div className="card-sm">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Profit Factor</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: stats.profitFactor >= 1.5 ? 'var(--green)' : 'var(--amber)' }}>
                    {stats.profitFactor}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>Gross Win / Gross Loss</div>
                </div>

                <div className="card-sm">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Today's Realized</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: `var(--${pnlColor(stats.todayPnl)})` }}>
                    {pnlStr(stats.todayPnl)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{stats.todayTrades} trades today</div>
                </div>

                <div className="card-sm">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Best Trade</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--green)' }}>
                    {pnlStr(stats.bestTrade)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>Avg Win: {pnlStr(stats.avgWin)}</div>
                </div>

                <div className="card-sm">
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Worst Trade</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--red)' }}>
                    {pnlStr(stats.worstTrade)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>Avg Loss: {pnlStr(stats.avgLoss)}</div>
                </div>
              </div>
            )}

            {/* Trade Search & Account Filter Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ flex: '1 1 260px', maxWidth: 380, position: 'relative' }}>
                <input
                  type="text"
                  placeholder="🔍 Search trades by ticket, direction, symbol..."
                  value={tradeSearch}
                  onChange={(e) => setTradeSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-card2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    fontSize: '0.82rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                {(['ALL', 'demo', 'live'] as const).map((acct) => (
                  <button
                    key={acct}
                    onClick={() => setTradeAccountFilter(acct)}
                    className={`pill ${tradeAccountFilter === acct ? 'pill-gold' : 'pill-dim'}`}
                    style={{ border: 'none', cursor: 'pointer', fontSize: '0.72rem', padding: '4px 10px' }}
                  >
                    {acct === 'ALL' ? 'All Accounts' : acct === 'demo' ? 'Demo Only' : 'Live Only'}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Trades */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div className="section-title" style={{ marginBottom: 0 }}>
                  ACTIVE TRADE GROUPS ({activeGroups.length})
                </div>
                <button
                  onClick={fetchTradeData}
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  🔄 Refresh
                </button>
              </div>

              {activeGroups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                  No active trade groups currently open or pending.
                </div>
              ) : (
                activeGroups.map((g) => <TradeGroupCard key={g.id} g={g} token={token} onRefresh={fetchTradeData} />)
              )}
            </div>

            {/* Closed Trade History */}
            <div className="card">
              <div className="section-title">CLOSED TRADE HISTORY ({closedGroups.length})</div>
              {closedGroups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                  No closed trades recorded yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {closedGroups.slice(0, 30).map((g) => (
                    <TradeGroupCard key={g.id} g={g} token={token} onRefresh={fetchTradeData} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ALERT LOG */}
        {tab === 'events' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <div className="section-title" style={{ marginBottom: 2 }}>REAL-TIME TRADE & ALERT LOG TABLE</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Searchable history of signals, auto-trades, and multi-channel alerts (Roman Urdu + English)
                </div>
              </div>
            </div>
            <SearchableLogTable events={live.events} />
          </div>
        )}

        {/* TAB 5: SETTINGS */}
        {tab === 'settings' && live.settings && (
          <SettingsPanel settings={live.settings} token={token} onUpdate={() => {}} />
        )}
      </main>

      {/* Credentials & Settings Modal */}
      {live.settings && (
        <CredentialsModal
          isOpen={credModalOpen}
          onClose={() => setCredModalOpen(false)}
          settings={live.settings}
          token={token}
          onUpdate={() => {}}
        />
      )}
    </div>
  );
}
