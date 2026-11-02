/**
 * api/routes.ts  —  All REST endpoints.
 *
 * Every route is protected by the Bearer-token auth middleware.
 * The WebSocket push is handled in wsGateway.ts (same server, different protocol).
 *
 * Endpoint map:
 *  GET  /api/status          — system health, feed status, mode
 *  GET  /api/snapshot        — latest RadarSnapshot (spot + fusion + gates + setups)
 *  GET  /api/signals         — recent signals (last 50)
 *  GET  /api/trades          — trade groups (active by default; ?status=CLOSED)
 *  POST /api/trades/:id/close — close / cancel a trade group
 *  GET  /api/accounts        — live account snapshots (balance, equity, DD, positions)
 *  GET  /api/accounts/:key/equity-curve — equity time-series (last 24h by default)
 *  GET  /api/accounts/:key/history      — closed deals history
 *  GET  /api/settings        — current runtime settings
 *  PUT  /api/settings        — patch runtime settings (partial update)
 *  POST /api/test-notify     — send a test notification to all channels
 *  GET  /api/notify-status   — which notification channels are enabled
 *  POST /api/kill-switch     — { enabled: boolean } — emergency halt
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Scraper } from '../scraper/scraper';
import type { AccountMonitor } from '../services/accountMonitor';
import type { SettingsService } from '../services/settings';
import type { TradeManager } from '../services/tradeManager';
import type { Store } from '../db/store';
import type { Notifier } from '../notify/notifier';
import type { BrokerManager } from '../broker/manager';
import { asyncHandler, auth } from './middleware';
import { errMsg } from '../lib/utils';
import { env } from '../config/env';

export interface RouteCtx {
  scraper: Scraper;
  accountMonitor: AccountMonitor;
  settings: SettingsService;
  tradeManager: TradeManager;
  brokerManager: BrokerManager;
  store: Store;
  notifier: Notifier;
  startedAt: Date;
}

export function buildRouter(ctx: RouteCtx): Router {
  const r = Router();
  r.use(auth);

  // ── System status ─────────────────────────────────────────────────────────
  r.get('/status', asyncHandler(async (_req, res) => {
    const s = ctx.settings.get();
    res.json({
      ok: true,
      uptime: Math.floor((Date.now() - ctx.startedAt.getTime()) / 1000),
      startedAt: ctx.startedAt.toISOString(),
      mode: s.tradingMode,
      engine: env.EXECUTION_ENGINE,
      autoTrading: s.autoTrading,
      killSwitch: s.killSwitch,
      feeds: ctx.scraper.statusList(),
      feedHealthy: ctx.scraper.feedHealthy(),
      notifiers: ctx.notifier.status(),
    });
  }));

  // ── RadarSnapshot (live data) ─────────────────────────────────────────────
  r.get('/snapshot', asyncHandler(async (_req, res) => {
    const snap = ctx.scraper.latestSnapshot();
    if (!snap) {
      res.status(503).json({ error: 'No snapshot yet — scraper is still starting' });
      return;
    }
    res.json(snap);
  }));

  // ── Signals ───────────────────────────────────────────────────────────────
  r.get('/signals', asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
    res.json(ctx.store.listSignals(limit));
  }));

  // ── Trade groups ──────────────────────────────────────────────────────────
  r.get('/trades', asyncHandler(async (req, res) => {
    const status = req.query['status'] as string | undefined;
    const limit = Math.min(Number(req.query['limit'] ?? 100), 500);
    res.json(ctx.store.listGroups(limit, status));
  }));

  r.get('/trades/stats', asyncHandler(async (_req, res) => {
    res.json(ctx.tradeManager.getStats());
  }));

  r.post('/trades/:id/close', asyncHandler(async (req, res) => {
    try {
      const group = await ctx.tradeManager.closeGroup(req.params['id']!);
      res.json({ ok: true, group });
    } catch (e) {
      res.status(400).json({ error: errMsg(e) });
    }
  }));

  r.post('/trades/:id/legs/:tp/close', asyncHandler(async (req, res) => {
    try {
      const tp = parseInt(req.params['tp']!, 10);
      const group = await ctx.tradeManager.closeLeg(req.params['id']!, tp);
      res.json({ ok: true, group });
    } catch (e) {
      res.status(400).json({ error: errMsg(e) });
    }
  }));

  r.post('/trades/:id/modify-sl', asyncHandler(async (req, res) => {
    try {
      const schema = z.object({ sl: z.number() });
      const { sl } = schema.parse(req.body);
      const group = await ctx.tradeManager.modifyGroupSl(req.params['id']!, sl);
      res.json({ ok: true, group });
    } catch (e) {
      res.status(400).json({ error: errMsg(e) });
    }
  }));

  r.post('/trades/:id/move-be', asyncHandler(async (req, res) => {
    try {
      const ok = await ctx.tradeManager.moveGroupSlToBe(req.params['id']!);
      res.json({ ok });
    } catch (e) {
      res.status(400).json({ error: errMsg(e) });
    }
  }));

  r.post('/accounts/:key/positions/:posId/close', asyncHandler(async (req, res) => {
    const key = req.params['key'] as 'demo' | 'live';
    const broker = ctx.brokerManager.get(key);
    if (!broker) {
      res.status(404).json({ error: 'Broker not found' });
      return;
    }
    const r = await broker.closePosition(req.params['posId']!);
    res.json(r);
  }));

  r.post('/accounts/:key/positions/:posId/move-be', asyncHandler(async (req, res) => {
    const key = req.params['key'] as 'demo' | 'live';
    const broker = ctx.brokerManager.get(key);
    if (!broker) {
      res.status(404).json({ error: 'Broker not found' });
      return;
    }
    const positions = await broker.getPositions();
    const pos = positions.find((p) => p.id === req.params['posId']);
    if (!pos) {
      res.status(404).json({ error: 'Position not found' });
      return;
    }
    const s = ctx.settings.get();
    const beBuffer = s.beBuffer ?? 0.3;
    const newSl = pos.type === 'BUY' ? pos.openPrice + beBuffer : pos.openPrice - beBuffer;
    const r = await broker.modifyPosition(pos.id, newSl, pos.takeProfit ?? 0);
    res.json(r);
  }));

  // ── Accounts ──────────────────────────────────────────────────────────────
  r.get('/accounts', asyncHandler(async (_req, res) => {
    // Strip deal history from the list view (can be large)
    const snaps = ctx.accountMonitor.list().map(({ history: _, ...rest }) => rest);
    res.json(snaps);
  }));

  r.get('/accounts/:key/equity-curve', asyncHandler(async (req, res) => {
    const key = req.params['key'] as 'demo' | 'live';
    const hours = Math.min(Number(req.query['hours'] ?? 24), 720);
    const since = Date.now() - hours * 3_600_000;
    res.json(ctx.store.equityCurve(key, since));
  }));

  r.get('/accounts/:key/history', asyncHandler(async (req, res) => {
    const key = req.params['key'] as 'demo' | 'live';
    const snap = ctx.accountMonitor.snapshots.get(key);
    res.json(snap?.history ?? []);
  }));

  r.get('/accounts/credentials', asyncHandler(async (_req, res) => {
    const metaToken = ctx.store.getKv<string>('metaapi_token') ?? env.METAAPI_TOKEN ?? '';
    const demoId = ctx.store.getKv<string>('demo_account_id') ?? env.DEMO_ACCOUNT_ID ?? '';
    const liveId = ctx.store.getKv<string>('live_account_id') ?? env.LIVE_ACCOUNT_ID ?? '';
    const localUrl = ctx.store.getKv<string>('local_mt5_url') ?? env.LOCAL_MT5_URL ?? 'http://127.0.0.1:8000';
    const engine = ctx.store.getKv<string>('execution_engine') ?? env.EXECUTION_ENGINE;

    res.json({
      engine,
      metaTokenMasked: metaToken ? `${metaToken.slice(0, 4)}...${metaToken.slice(-4)}` : '',
      demoId,
      liveId,
      localUrl,
    });
  }));

  r.put('/accounts/credentials', asyncHandler(async (req, res) => {
    const schema = z.object({
      engine: z.enum(['paper', 'metaapi', 'local_mt5']).optional(),
      metaToken: z.string().optional(),
      demoId: z.string().optional(),
      liveId: z.string().optional(),
      localUrl: z.string().optional(),
    });
    const parsed = schema.parse(req.body);
    await ctx.brokerManager.reconfigure(parsed);
    res.json({ ok: true, message: 'Broker configuration updated' });
  }));

  // ── Settings ──────────────────────────────────────────────────────────────
  r.get('/settings', asyncHandler(async (_req, res) => {
    res.json(ctx.settings.get());
  }));

  r.put('/settings', asyncHandler(async (req, res) => {
    try {
      const updated = ctx.settings.update(req.body);
      res.json({ ok: true, settings: updated });
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: e.issues });
      } else {
        res.status(400).json({ error: errMsg(e) });
      }
    }
  }));

  // ── Kill switch ───────────────────────────────────────────────────────────
  r.post('/kill-switch', asyncHandler(async (req, res) => {
    const schema = z.object({ enabled: z.boolean() });
    const { enabled } = schema.parse(req.body);
    ctx.settings.update({ killSwitch: enabled });
    ctx.notifier.notify({
      type: 'KILL_SWITCH', severity: enabled ? 'critical' : 'warning',
      data: { enabled },
    });
    res.json({ ok: true, killSwitch: enabled });
  }));

  // ── Notifications ─────────────────────────────────────────────────────────
  r.get('/notify-status', asyncHandler(async (_req, res) => {
    res.json(ctx.notifier.status());
  }));

  r.post('/test-notify', asyncHandler(async (_req, res) => {
    ctx.notifier.notify({ type: 'TEST', severity: 'info', data: { sentAt: new Date().toISOString() } });
    res.json({ ok: true });
  }));

  // ── Events log ────────────────────────────────────────────────────────────
  r.get('/events', asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query['limit'] ?? 100), 500);
    res.json(ctx.store.listEvents(limit));
  }));

  return r;
}
