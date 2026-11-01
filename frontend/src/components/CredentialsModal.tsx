import React, { useState, useEffect } from 'react';
import type { RuntimeSettings } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: RuntimeSettings;
  token: string;
  onUpdate: () => void;
}

export function CredentialsModal({ isOpen, onClose, settings, token, onUpdate }: Props) {
  const [riskPercent, setRiskPercent] = useState(settings.riskPercent);
  const [maxSpread, setMaxSpread] = useState(settings.maxSpread);
  const [maxDailyDrawdownPct, setMaxDailyDrawdownPct] = useState(settings.maxDailyDrawdownPct);

  const [engine, setEngine] = useState('paper');
  const [metaToken, setMetaToken] = useState('');
  const [demoId, setDemoId] = useState('');
  const [liveId, setLiveId] = useState('');
  const [localUrl, setLocalUrl] = useState('http://127.0.0.1:8000');

  const [whatsappProvider, setWhatsappProvider] = useState('callmebot');
  const [callmebotRecipient, setCallmebotRecipient] = useState('');
  const [ultramsgInstance, setUltramsgInstance] = useState('');
  const [ultramsgToken, setUltramsgToken] = useState('');
  const [emailTo, setEmailTo] = useState('irfan7242@gmail.com');

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRiskPercent(settings.riskPercent);
      setMaxSpread(settings.maxSpread);
      setMaxDailyDrawdownPct(settings.maxDailyDrawdownPct);

      fetch('/api/accounts/credentials', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          if (d.engine) setEngine(d.engine);
          if (d.demoId) setDemoId(d.demoId);
          if (d.liveId) setLiveId(d.liveId);
          if (d.localUrl) setLocalUrl(d.localUrl);
        })
        .catch(() => {});
    }
  }, [isOpen, settings, token]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    try {
      // 1. Update Runtime Risk & Spread Settings
      const setRes = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          riskPercent: Number(riskPercent),
          maxSpread: Number(maxSpread),
          maxDailyDrawdownPct: Number(maxDailyDrawdownPct),
        }),
      });
      if (!setRes.ok) throw new Error('Failed to update risk parameters');

      // 2. Update Broker Bridge Credentials
      const credRes = await fetch('/api/accounts/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          engine,
          metaToken: metaToken || undefined,
          demoId,
          liveId,
          localUrl,
        }),
      });
      if (!credRes.ok) throw new Error('Failed to update broker bridge');

      setMsg({ text: 'All credentials and risk settings saved & synchronized!', ok: true });
      onUpdate();
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setMsg({ text: err.message, ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(5px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>⚙️ Settings & Credentials</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Configure Risk Management, MT4/MT5 Broker Bridge, and Alert Gateways
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.4rem',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Section 1: Risk & Trade Constraints */}
          <div>
            <div className="section-title">1. Risk & Spread Controls</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Risk Per Trade (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.85rem' }}
                />
              </div>

              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Max Spread ($)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  value={maxSpread}
                  onChange={(e) => setMaxSpread(parseFloat(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.85rem' }}
                />
              </div>

              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Max Daily Loss (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="20"
                  value={maxDailyDrawdownPct}
                  onChange={(e) => setMaxDailyDrawdownPct(parseFloat(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.85rem' }}
                />
              </div>
            </div>
          </div>

          {/* Section 2: MT4 / MT5 Broker Connections */}
          <div>
            <div className="section-title">2. MT4 / MT5 Broker Bridge (Demo & Live)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Execution Engine
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                >
                  <option value="paper">Paper Trading (Safe Simulator)</option>
                  <option value="metaapi">MetaApi.cloud (Cloud MT4/MT5)</option>
                  <option value="local_mt5">Local Python MT5 Bridge</option>
                </select>
              </div>

              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Demo Account ID
                </label>
                <input
                  type="text"
                  placeholder="MetaApi ID / Login"
                  value={demoId}
                  onChange={(e) => setDemoId(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                />
              </div>

              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Live Account ID
                </label>
                <input
                  type="text"
                  placeholder="MetaApi ID / Login"
                  value={liveId}
                  onChange={(e) => setLiveId(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  MetaApi Token (Leave blank to keep current)
                </label>
                <input
                  type="password"
                  placeholder="Enter MetaApi Token..."
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                />
              </div>

              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Local MT5 URL (mt5_bridge.py)
                </label>
                <input
                  type="text"
                  placeholder="http://127.0.0.1:8000"
                  value={localUrl}
                  onChange={(e) => setLocalUrl(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Notification Gateways */}
          <div>
            <div className="section-title">3. Instant Notification Gateways</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  Email Recipient (Gmail SMTP)
                </label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                />
              </div>

              <div className="card-sm">
                <label style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  WhatsApp Provider
                </label>
                <select
                  value={whatsappProvider}
                  onChange={(e) => setWhatsappProvider(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem' }}
                >
                  <option value="callmebot">CallMeBot Free API (phone:apikey)</option>
                  <option value="ultramsg">UltraMsg API (Instance + Token)</option>
                  <option value="twilio">Twilio WhatsApp</option>
                  <option value="none">Disabled</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontWeight: 600,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '8px 22px',
                background: 'var(--gold)',
                border: 'none',
                borderRadius: 6,
                fontWeight: 800,
                color: '#000',
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving...' : '💾 Save & Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
