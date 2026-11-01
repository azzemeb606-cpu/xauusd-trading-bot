import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RadarSnapshot, AccountSnapshot, RuntimeSettings, StoredEvent, TradeGroup } from '../types';

const WS_URL = import.meta.env['VITE_WS_URL'] ?? '';
const TOKEN = import.meta.env['VITE_ADMIN_TOKEN'] ?? localStorage.getItem('xau_token') ?? '';

export interface LiveState {
  connected: boolean;
  snapshot: RadarSnapshot | null;
  accounts: AccountSnapshot[];
  settings: RuntimeSettings | null;
  events: StoredEvent[];
  trades: TradeGroup[];
}

export function useLive(): LiveState {
  const [state, setState] = useState<LiveState>({
    connected: false,
    snapshot: null,
    accounts: [],
    settings: null,
    events: [],
    trades: [],
  });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket: Socket = io(WS_URL, {
      path: '/ws',
      auth: { token: TOKEN },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });

    socket.on('connect', () => setState((s) => ({ ...s, connected: true })));
    socket.on('disconnect', () => setState((s) => ({ ...s, connected: false })));

    socket.on('snapshot', (snap: RadarSnapshot) =>
      setState((s) => ({ ...s, snapshot: snap })));

    socket.on('accounts', (accs: AccountSnapshot[]) =>
      setState((s) => ({ ...s, accounts: accs })));

    socket.on('settings', (cfg: RuntimeSettings) =>
      setState((s) => ({ ...s, settings: cfg })));

    socket.on('trades', (list: TradeGroup[]) =>
      setState((s) => ({ ...s, trades: list })));

    socket.on('tradeUpdate', (updated: TradeGroup) =>
      setState((s) => {
        const idx = s.trades.findIndex((t) => t.id === updated.id);
        const newTrades = idx >= 0
          ? s.trades.map((t) => (t.id === updated.id ? updated : t))
          : [updated, ...s.trades];
        return { ...s, trades: newTrades };
      }));

    socket.on('event', (ev: StoredEvent) =>
      setState((s) => ({ ...s, events: [ev, ...s.events].slice(0, 200) })));

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, []);

  return state;
}
