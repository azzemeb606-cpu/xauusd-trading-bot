import type { TradeBias, WhaleFlow, GateStatus, OverallGateStatus, Direction, GroupStatus } from '../types';

export const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : v.toFixed(d);

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const pnlColor = (v: number) => (v > 0 ? 'green' : v < 0 ? 'red' : 'dim');

export const pnlStr = (v: number) => `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`;

export function biasColor(bias: TradeBias): string {
  switch (bias) {
    case 'BULLISH': return 'green';
    case 'BEARISH': return 'red';
    case 'NEUTRAL': return 'amber';
    default: return 'dim';
  }
}

export function biasPill(bias: TradeBias): string {
  switch (bias) {
    case 'BULLISH': return 'pill-green';
    case 'BEARISH': return 'pill-red';
    case 'NEUTRAL': return 'pill-amber';
    default: return 'pill-dim';
  }
}

export function dirColor(dir: Direction): string {
  return dir === 'BUY' ? 'green' : 'red';
}

export function whaleColor(flow: WhaleFlow): string {
  switch (flow) {
    case 'BUYING': return 'green';
    case 'SELLING': return 'red';
    case 'NEUTRAL': return 'amber';
    default: return 'dim';
  }
}

export function gateStatusBadge(status: GateStatus): string {
  switch (status) {
    case 'PASS': return 'pill-green';
    case 'FAIL': return 'pill-red';
    case 'WARN': return 'pill-amber';
    default: return 'pill-dim';
  }
}

export function overallGateBadge(status: OverallGateStatus): string {
  switch (status) {
    case 'PASS': return 'pill-green';
    case 'TRADE_BLOCKED': return 'pill-red';
    default: return 'pill-dim';
  }
}

export function groupStatusColor(s: GroupStatus): string {
  switch (s) {
    case 'OPEN': return 'green';
    case 'PENDING': return 'amber';
    case 'CLOSED': return 'dim';
    case 'CANCELLED': return 'dim';
    case 'FAILED': return 'red';
    default: return 'dim';
  }
}

export const sessionLabel = (s: string) =>
  s === 'NEW_YORK' ? 'NEW YORK' : s === 'UNKNOWN' ? '—' : s;

export const timeAgo = (ms: number) => {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
