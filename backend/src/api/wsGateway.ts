/**
 * api/wsGateway.ts  —  Socket.IO WebSocket gateway
 *
 * Rooms & events pushed from server → client:
 *
 *   'snapshot'    RadarSnapshot     — every time data changes (3-5 s)
 *   'tick'        SpotPrice         — every WebSocket price tick from the site
 *   'accounts'    AccountSnapshot[] — every account poll cycle
 *   'event'       StoredEvent       — every alert / trade event as it fires
 *   'settings'    RuntimeSettings   — when settings change
 *
 * Client → server:
 *   'ping'  → 'pong' { at }
 */

import { Server as IOServer } from 'socket.io';
import type { Server as HTTPServer } from 'node:http';
import { logger } from '../lib/logger';
import type { Scraper } from '../scraper/scraper';
import type { AccountMonitor } from '../services/accountMonitor';
import type { Notifier } from '../notify/notifier';
import type { SettingsService } from '../services/settings';
import type { TradeManager } from '../services/tradeManager';
import { env } from '../config/env';

export function attachWebSocket(
  httpServer: HTTPServer,
  {
    scraper,
    accountMonitor,
    notifier,
    settings,
    tradeManager,
  }: {
    scraper: Scraper;
    accountMonitor: AccountMonitor;
    notifier: Notifier;
    settings: SettingsService;
    tradeManager: TradeManager;
  },
) {
  const io = new IOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    path: '/ws',
  });

  // ── Auth handshake ────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.['token'] ??
      socket.handshake.headers?.['authorization']?.replace('Bearer ', '') ??
      socket.handshake.query?.['token'];

    if (token !== env.ADMIN_TOKEN) {
      logger.warn({ ip: socket.handshake.address }, 'WS auth failed');
      next(new Error('Unauthorised'));
      return;
    }
    next();
  });

  // ── Connection ────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info({ id: socket.id }, 'WS client connected');

    // Immediately push current state so the dashboard shows data without waiting
    const snap = scraper.latestSnapshot();
    if (snap) socket.emit('snapshot', snap);
    socket.emit('accounts', accountMonitor.list());
    socket.emit('settings', settings.get());
    socket.emit('trades', tradeManager.activeGroups());

    socket.on('ping', () => socket.emit('pong', { at: Date.now() }));
    socket.on('disconnect', (reason) => logger.info({ id: socket.id, reason }, 'WS client disconnected'));
  });

  // ── Broadcast from service events ─────────────────────────────────────────
  scraper.on('snapshot', (snap) => io.emit('snapshot', snap));
  scraper.on('tick', (tick) => io.emit('tick', tick));
  accountMonitor.on('update', (snaps) => io.emit('accounts', snaps));
  notifier.on('event', (ev) => io.emit('event', ev));
  settings.on('change', (s) => io.emit('settings', s));
  tradeManager.on('groupUpdate', (group) => io.emit('tradeUpdate', group));

  logger.info({ path: '/ws' }, 'WebSocket gateway attached');
  return io;
}
