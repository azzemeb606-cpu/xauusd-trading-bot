import React, { useState } from 'react';
import type { RuntimeSettings } from '../types';

interface Props {
  settings: RuntimeSettings;
  token: string;
  onUpdate: () => void;
}

export function SettingsPanel({ settings, token, onUpdate }: Props) {
  const [form, setForm] = useState<RuntimeSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [testingNotify, setTestingNotify] = useState(false);
  const [notifyChannels, setNotifyChannels] = useState<Array<{ name: string; enabled: boolean }>>([]);
  const [credEngine, setCredEngine] = useState('paper');
  const [credToken, setCredToken] = useState('');
  const [credDemoId, setCredDemoId] = useState('');
  const [credLiveId, setCredLiveId] = useState('');
  const [credLocalUrl, setCredLocalUrl] = useState('http://127.0.0.1:8000');
  const [credSaving, setCredSaving] = useState(false);
  const [credMsg, setCredMsg] = useState<{ text: string; ok: boolean } | null>(null);

  React.useEffect(() => {
    fetch('/api/accounts/credentials', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.engine) setCredEngine(d.engine);
        if (d.demoId) setCredDemoId(d.demoId);
        if (d.liveId) setCredLiveId(d.liveId);
        if (d.localUrl) setCredLocalUrl(d.localUrl);
      })
      .catch(() => {});

    fetch('/api/notify-status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setNotifyChannels(data);
      })
      .catch(() => {});
  }, [token]);

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredSaving(true);
    setCredMsg(null);
    try {
      const res = await fetch('/api/accounts/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          engine: credEngine,
          metaToken: credToken || undefined,
          demoId: credDemoId,
          liveId: credLiveId,
          localUrl: credLocalUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Account update failed');
      setCredMsg({ text: 'Account bridge credentials reconnected successfully!', ok: true });
      onUpdate();
    } catch (err: any) {
      setCredMsg({ text: err.message, ok: false });
    } finally {
      setCredSaving(false);
    }
  };

  const handleChange = (key: keyof RuntimeSettings, val: any) => {
    setForm((f) => ({ ...f, [key]: val }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setMsg({ text: 'Settings updated successfully!', ok: true });
      onUpdate();
    } catch (err: any) {
      setMsg({ text: err.message, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async () => {
    setTestingNotify(true);
    try {
      await fetch('/api/test-notify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Test alert dispatched to all configured channels (Telegram, WhatsApp, Email)!');
    } catch {
      alert('Failed to send test alert');
    } finally {
      setTestingNotify(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>⚙️ Bot Trading & Risk Settings</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: 4 }}>
            Real-time parameters for risk management, multi-gate evaluation, and trade execution
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {notifyChannels.map((c) => (
              <span
                key={c.name}
                className={`pill ${c.enabled ? 'pill-green' : 'pill-dim'}`}
                style={{ fontSize: '0.68rem', padding: '2px 8px' }}
              >
                {c.name === 'whatsapp' ? '📱 WhatsApp' : c.name === 'email' ? '📧 Email' : '✈️ Telegram'}: {c.enabled ? 'Active' : 'Standby'}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={handleTestAlert}
          disabled={testingNotify}
          style={{
            fontSize: '0.75rem',
            padding: '8px 14px',
            background: 'rgba(59,130,246,0.2)',
            border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: 6,
            color: 'var(--blue)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {testingNotify ? 'Sending...' : '🧪 Test Alerts (WA/TG/Email)'}
        </button>
      </div>

      {msg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: '1rem',
            fontSize: '0.8rem',
            background: msg.ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: msg.ok ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${msg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}
        >
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Execution & Mode Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-title">Execution Mode & Switches</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div className="card-sm">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                Trading Mode
              </label>
              <select
                value={form.tradingMode}
                onChange={(e) => handleChange('tradingMode', e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              >
                <option value="DEMO_ONLY">DEMO ONLY (Safe)</option>
                <option value="LIVE_ONLY">LIVE ONLY (Real Capital)</option>
                <option value="DUAL_MIRROR">DUAL MIRROR (Demo + Live)</option>
              </select>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                Multi-TP Execution Style
              </label>
              <select
                value={form.tpExecutionStyle ?? 'SPLIT_ORDERS'}
                onChange={(e) => handleChange('tpExecutionStyle', e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              >
                <option value="SPLIT_ORDERS">3 Micro-Orders (TP1/TP2/TP3)</option>
                <option value="SINGLE_ORDER_PARTIAL">1 Master Order + Partial Close</option>
              </select>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                Auto-Trading Master Switch
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="autoTrading"
                  checked={form.autoTrading}
                  onChange={(e) => handleChange('autoTrading', e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
                <label htmlFor="autoTrading" style={{ fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                  {form.autoTrading ? 'Enabled (Auto Orders)' : 'Disabled (Monitor)'}
                </label>
              </div>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                Order Type Preference
              </label>
              <select
                value={form.orderTypePreference}
                onChange={(e) => handleChange('orderTypePreference', e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              >
                <option value="AUTO">AUTO (Market inside dev, else Limit)</option>
                <option value="MARKET">MARKET ONLY</option>
                <option value="LIMIT">LIMIT ONLY</option>
              </select>
            </div>
          </div>
        </div>

        {/* Risk Management Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-title">Risk & Sizing Parameters</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Risk Per Trade (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={form.riskPercent}
                onChange={(e) => handleChange('riskPercent', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Fixed Lot (0 = Dynamic Risk)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="10"
                value={form.fixedLot}
                onChange={(e) => handleChange('fixedLot', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Max Lot Ceiling
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="50"
                value={form.maxLot}
                onChange={(e) => handleChange('maxLot', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Max Daily Drawdown (%)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="20"
                value={form.maxDailyDrawdownPct}
                onChange={(e) => handleChange('maxDailyDrawdownPct', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>
          </div>
        </div>

        {/* Trade Execution Gates Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-title">Strict 6-Gate Criteria Validator</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Min Fusion Confidence (%)
              </label>
              <input
                type="number"
                step="1"
                min="50"
                max="95"
                value={form.minFusionConfidence ?? 65}
                onChange={(e) => handleChange('minFusionConfidence', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 2 }}>Gate 2: Default >= 65%</div>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Min Brains Agreement
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="9"
                value={form.minBrainsAgreement ?? 5}
                onChange={(e) => handleChange('minBrainsAgreement', parseInt(e.target.value, 10))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 2 }}>Gate 2: Aligned engines</div>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Limit Proximity to Zone ($)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="50"
                value={form.maxLimitProximity ?? 15}
                onChange={(e) => handleChange('maxLimitProximity', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 2 }}>Gate 4: Default within $15</div>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                USD News Blackout Buffer (min)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="60"
                value={form.newsBlackoutMin ?? 15}
                onChange={(e) => handleChange('newsBlackoutMin', parseInt(e.target.value, 10))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 2 }}>Gate 1: Default 15 min buffer</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Max Spread Allowed ($)
              </label>
              <input
                type="number"
                step="0.05"
                value={form.maxSpread}
                onChange={(e) => handleChange('maxSpread', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Max Entry Deviation ($)
              </label>
              <input
                type="number"
                step="0.1"
                value={form.maxEntryDeviation}
                onChange={(e) => handleChange('maxEntryDeviation', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Min SL Distance ($)
              </label>
              <input
                type="number"
                step="0.5"
                value={form.minSlDistance}
                onChange={(e) => handleChange('minSlDistance', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Main Chart Confluence
              </label>
              <select
                value={form.confluenceMode}
                onChange={(e) => handleChange('confluenceMode', e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              >
                <option value="NO_CONFLICT">NO CONFLICT (Recommended)</option>
                <option value="STRICT">STRICT MATCH</option>
                <option value="OFF">OFF (Ignore)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Automation & Trailing Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-title">Break-Even & Trailing Stop Rules</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <div className="card-sm">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="moveBe"
                  checked={form.moveBeOnTp1}
                  onChange={(e) => handleChange('moveBeOnTp1', e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <label htmlFor="moveBe" style={{ fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                  Move SL to Break-Even on TP1
                </label>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 4 }}>
                Secures risk-free trade on remaining TP2/TP3 lots
              </div>
            </div>

            <div className="card-sm">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="trailTp2"
                  checked={form.trailToTp1OnTp2}
                  onChange={(e) => handleChange('trailToTp1OnTp2', e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <label htmlFor="trailTp2" style={{ fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                  Trail SL to TP1 on TP2
                </label>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 4 }}>
                Locks in substantial profit for the runner leg (TP3)
              </div>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Break-Even Buffer ($ above/below entry)
              </label>
              <input
                type="number"
                step="0.05"
                value={form.beBuffer}
                onChange={(e) => handleChange('beBuffer', parseFloat(e.target.value))}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1rem' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '10px 24px',
              background: 'var(--gold)',
              border: 'none',
              borderRadius: 8,
              fontWeight: 800,
              fontSize: '0.9rem',
              color: '#000',
              cursor: 'pointer',
            }}
          >
            {saving ? 'Saving...' : '💾 Save Settings'}
          </button>
        </div>
      </form>

      {/* Account Connections Bridge Configuration */}
      <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800 }}>🔌 MT4 / MT5 Broker Connections</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Configure MetaApi.cloud SDK credentials or Local Python MT5 Bridge endpoints
            </div>
          </div>
        </div>

        {credMsg && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: '1rem',
              fontSize: '0.8rem',
              background: credMsg.ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: credMsg.ok ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${credMsg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}
          >
            {credMsg.text}
          </div>
        )}

        <form onSubmit={handleSaveCredentials}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Execution Engine
              </label>
              <select
                value={credEngine}
                onChange={(e) => setCredEngine(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              >
                <option value="paper">Paper Trading (Safe Simulator)</option>
                <option value="metaapi">MetaApi.cloud (Cloud MT4/MT5)</option>
                <option value="local_mt5">Local MT5 Python Bridge (Local MT5)</option>
              </select>
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Demo Account ID
              </label>
              <input
                type="text"
                placeholder="e.g. metaapi-demo-id or MT5 login"
                value={credDemoId}
                onChange={(e) => setCredDemoId(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Live Account ID
              </label>
              <input
                type="text"
                placeholder="e.g. metaapi-live-id or MT5 login"
                value={credLiveId}
                onChange={(e) => setCredLiveId(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                MetaApi API Token (Leave blank to keep existing)
              </label>
              <input
                type="password"
                placeholder="Enter new MetaApi Token..."
                value={credToken}
                onChange={(e) => setCredToken(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>

            <div className="card-sm">
              <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                Local MT5 Bridge URL (Python mt5_bridge.py)
              </label>
              <input
                type="text"
                placeholder="http://127.0.0.1:8000"
                value={credLocalUrl}
                onChange={(e) => setCredLocalUrl(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={credSaving}
              style={{
                padding: '8px 20px',
                background: 'rgba(59,130,246,0.3)',
                border: '1px solid rgba(59,130,246,0.6)',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: '0.85rem',
                color: 'var(--blue)',
                cursor: 'pointer',
              }}
            >
              {credSaving ? 'Reconnecting...' : '🔗 Reconnect Broker Bridge'}
            </button>
          </div>
        </form>
      </div>
      </form>
    </div>
  );
}
