import React, { useState, useMemo } from 'react';
import type { StoredEvent } from '../types';
import { timeAgo } from '../lib/format';

interface Props {
  events: StoredEvent[];
}

const SEV_BADGE: Record<string, string> = {
  success: 'pill-green',
  warning: 'pill-amber',
  critical: 'pill-red',
  info: 'pill-blue',
};

const CATEGORIES = [
  { id: 'ALL', label: 'All Logs' },
  { id: 'EVENT_A', label: 'Event A: Signals' },
  { id: 'EVENT_B', label: 'Event B: Executions' },
  { id: 'EVENT_C', label: 'Event C: TP1 & BE' },
  { id: 'EVENT_D', label: 'Event D: Closed' },
  { id: 'EVENT_E', label: 'Event E: Safety & DD' },
];

export function SearchableLogTable({ events }: Props) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      // 1. Category Filter
      if (filterCat === 'EVENT_A' && ev.type !== 'SETUP_FORMED') return false;
      if (filterCat === 'EVENT_B' && !['TRADE_OPENED', 'ORDER_PLACED'].includes(ev.type)) return false;
      if (filterCat === 'EVENT_C' && !['TP_HIT', 'BE_MOVED', 'SL_TRAILED'].includes(ev.type)) return false;
      if (filterCat === 'EVENT_D' && ev.type !== 'TRADE_CLOSED') return false;
      if (
        filterCat === 'EVENT_E' &&
        !['GATES_BLOCKED', 'DRAWDOWN_WARNING', 'DRAWDOWN_LIMIT', 'KILL_SWITCH', 'FEED_DOWN'].includes(ev.type)
      ) {
        return false;
      }

      // 2. Keyword Search (title, message, type)
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchTitle = ev.title.toLowerCase().includes(query);
        const matchMsg = ev.message.toLowerCase().includes(query);
        const matchType = ev.type.toLowerCase().includes(query);
        return matchTitle || matchMsg || matchType;
      }

      return true;
    });
  }, [events, search, filterCat]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Search & Filter Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {/* Search Bar */}
        <div style={{ flex: '1 1 280px', maxWidth: 450, position: 'relative' }}>
          <input
            type="text"
            placeholder="🔍 Search signals, tickets, Roman Urdu text, P&L..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--bg-card2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: '0.85rem',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCat(cat.id)}
              className={`pill ${filterCat === cat.id ? 'pill-gold' : 'pill-dim'}`}
              style={{ cursor: 'pointer', border: 'none', fontSize: '0.72rem', padding: '4px 10px' }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count */}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
        Showing {filtered.length} of {events.length} logged events
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '10px 14px' }}>Time</th>
              <th style={{ padding: '10px 14px' }}>Event</th>
              <th style={{ padding: '10px 14px' }}>Severity</th>
              <th style={{ padding: '10px 14px' }}>Description / Roman Urdu Guidance</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ev) => (
              <tr key={ev.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                  {new Date(ev.at).toLocaleTimeString()} ({timeAgo(ev.at)})
                </td>
                <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {ev.title}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <span className={`pill ${SEV_BADGE[ev.severity] ?? 'pill-dim'}`} style={{ fontSize: '0.65rem' }}>
                    {ev.severity.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontSize: '0.76rem', lineHeight: 1.4, color: 'var(--text-dim)', maxWidth: 420 }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {ev.message.split('🕒 Time:')[0].trim()}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(ev.message || ev.title)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(37,211,102,0.15)',
                      border: '1px solid rgba(37,211,102,0.4)',
                      borderRadius: 4,
                      color: '#25D366',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    📱 Share
                  </a>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                  No log entries matched your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
