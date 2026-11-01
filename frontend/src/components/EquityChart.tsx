import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface EquityPoint {
  balance: number;
  equity: number;
  floating: number;
  at: number;
}

interface Props {
  accountKey: string;
  token: string;
}

export function EquityChart({ accountKey, token }: Props) {
  const [data, setData] = useState<EquityPoint[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch(`/api/accounts/${accountKey}/equity-curve?hours=${hours}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((points: EquityPoint[]) => {
        if (!cancel) {
          setData(points);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [accountKey, hours, token]);

  const formattedData = data.map((d) => ({
    ...d,
    time: new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  const minEquity = data.length > 0 ? Math.min(...data.map((d) => Math.min(d.balance, d.equity))) : 0;
  const maxEquity = data.length > 0 ? Math.max(...data.map((d) => Math.max(d.balance, d.equity))) : 10000;
  const yDomain = [Math.floor(minEquity * 0.99), Math.ceil(maxEquity * 1.01)];

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          EQUITY & BALANCE CURVE ({accountKey.toUpperCase()})
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[24, 72, 168].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: 4,
                background: hours === h ? 'var(--gold)' : 'rgba(255,255,255,0.06)',
                color: hours === h ? '#000' : 'var(--text-dim)',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {h === 24 ? '24H' : h === 72 ? '3D' : '7D'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
          Loading curve...
        </div>
      ) : formattedData.length === 0 ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
          No historical equity snapshots recorded yet. (Recorded every 60s)
        </div>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedData}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f5c842" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f5c842" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,79,0.5)" />
              <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
              <YAxis domain={yDomain} stroke="var(--text-dim)" fontSize={11} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.8rem' }}
                labelStyle={{ color: 'var(--text-dim)' }}
                formatter={(val: any) => [`$${Number(val).toFixed(2)}`, '']}
              />
              <Area type="monotone" dataKey="equity" stroke="#22c55e" fillOpacity={1} fill="url(#equityGrad)" name="Equity" />
              <Area type="monotone" dataKey="balance" stroke="#f5c842" strokeDasharray="4 4" fillOpacity={1} fill="url(#balanceGrad)" name="Balance" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
