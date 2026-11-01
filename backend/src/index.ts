/**
 * index.ts  —  Application entry point.
 *
 * Boot sequence:
 *  1. Validate environment
 *  2. Open SQLite store
 *  3. Load persisted settings
 *  4. Build broker manager (MetaApi or Paper) + connect accounts
 *  5. Start account monitor
 *  6. Start scraper (Chromium)
 *  7. Start signal engine (scraper → gates → trade manager)
 *  8. Start trade monitor loop
 *  9. Start HTTP server + WebSocket gateway
 * 10. Send startup alert
 */

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { env } from './config/env';
import { logger } from './lib/logger';
import { Store } from './db/store';
import { SettingsService } from './services/settings';
import { Notifier } from './notify/notifier';
import { createScraper } from './scraper/scraper';
import { BrokerManager } from './broker/manager';
import { AccountMonitor } from './services/accountMonitor';
import { TradeManager } from './services/tradeManager';
import { SignalEngine } from './services/signal-engine';
import { buildRouter } from './api/routes';
import { attachWebSocket } from './api/wsGateway';
import { apiLimiter, errorHandler } from './api/middleware';

// ─────────────────────────────────────────────────────────────────────────────

async function bootstrap() {
  logger.info({ mode: env.TRADING_MODE, engine: env.EXECUTION_ENGINE }, '🚀 XAUUSD Bot starting');

  // 1. Store
  const store = new Store(env.DATA_DIR);

  // 2. Settings (persisted across restarts)
  const settings = new SettingsService(store);
  logger.info({ autoTrading: settings.get().autoTrading, mode: settings.get().tradingMode }, 'Settings loaded');

  // 3. Notifier
  const notifier = new Notifier(store);

  // 4. Scraper
  const scraper = createScraper();

  // 5. Brokers — price source is the scraper's mid price
  const priceSource = () => scraper.currentPrice();
  const brokers = new BrokerManager(store, notifier, priceSource);

  // 6. Account monitor
  const accountMonitor = new AccountMonitor(brokers, store, notifier, settings);

  // 7. Trade manager
  const tradeManager = new TradeManager(brokers, store, notifier, settings);

  // 8. Signal engine
  const signalEngine = new SignalEngine(scraper, brokers, store, notifier, settings, tradeManager, accountMonitor);

  // ── Express app ───────────────────────────────────────────────────────────
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: false,   // let React SPA manage CSP
  }));
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/api', apiLimiter);

  const startedAt = new Date();
  app.use('/api', buildRouter({ scraper, accountMonitor, settings, tradeManager, brokerManager: brokers, store, notifier, startedAt }));

  // Serve the pre-built React frontend (web/dist)
  const webDist = path.resolve(env.WEB_DIST_DIR);
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    logger.info({ dir: webDist }, 'Serving static frontend');
  } else {
    logger.warn({ dir: webDist }, 'Frontend build not found — API-only mode');
    app.get('/', (_req, res) => res.json({ ok: true, message: 'XAUUSD Bot API' }));
  }

  app.use(errorHandler);

  // ── HTTP + WebSocket ──────────────────────────────────────────────────────
  const httpServer = http.createServer(app);
  attachWebSocket(httpServer, { scraper, accountMonitor, notifier, settings, tradeManager });

  await new Promise<void>((resolve) => httpServer.listen(env.PORT, resolve));
  logger.info({ port: env.PORT }, `🌐 Server listening on :${env.PORT}`);

  // ── Start all services ────────────────────────────────────────────────────
  brokers.start();
  accountMonitor.start();
  tradeManager.start();
  await scraper.start();

  // Telegram interactive button listener (Move SL to BE, Close Trade, Pause Bot)
  const tg = notifier.getTelegramChannel();
  if (tg?.enabled) {
    tg.setActionsHandler({
      onMoveBe: async (groupId) => tradeManager.moveGroupSlToBe(groupId),
      onCloseTrade: async (groupId) => {
        await tradeManager.closeGroup(groupId);
        return true;
      },
      onPauseBot: async () => {
        settings.update({ autoTrading: false });
        return true;
      },
      onResumeBot: async () => {
        settings.update({ autoTrading: true });
        return true;
      },
    });
    tg.startInteractivePolling();
  }

  // ── Startup alert ─────────────────────────────────────────────────────────
  const s = settings.get();
  notifier.notify({
    type: 'SYSTEM_STARTED', severity: 'info',
    data: { mode: s.tradingMode, autoTrading: s.autoTrading, engine: env.EXECUTION_ENGINE },
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown received');
    tg?.stopInteractivePolling();
    signalEngine.stop();
    tradeManager.stop();
    accountMonitor.stop();
    await scraper.stop();
    await brokers.stop();
    store.close();
    httpServer.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (e) => { logger.fatal({ err: e }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (r) => { logger.error({ reason: r }, 'Unhandled rejection'); });
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', e);
  process.exit(1);
});
