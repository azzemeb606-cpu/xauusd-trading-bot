/**
 * scraper.ts  —  Module 1: 24/7 Live Chart & Bond 007 Radar Scraper Engine
 *
 * Architecture:
 *  • One shared headless Chromium instance (Playwright) with two persistent pages
 *    (radar page + main chart page) — pages are kept alive so the target site's
 *    own WebSocket / EventSource feed keeps pushing live data without reloading.
 *  • Each page is read every POLL_MIN_MS–POLL_MAX_MS (default 3–5 s) via
 *    innerText so we capture dynamically updated DOM content.
 *  • Stealth headers (real UA, Accept-Language, etc.) + resource blocking
 *    (images / fonts / media) reduce bandwidth and fingerprinting.
 *  • Auto-reconnect: page errors → close & reopen; browser crash → full relaunch.
 *  • Periodic forced reload (PAGE_RELOAD_MINUTES, default 15 min) keeps the
 *    session token fresh.
 *  • Feed-health events are emitted so the Notifier can alert the trader when
 *    data has been stale for > FEED_STALE_SECONDS.
 *  • A WebSocket price bridge intercepts xauusdlivechart.com's own live price
 *    feed (if detectable) and publishes the ticks directly on the 'tick' event.
 */

import { EventEmitter } from 'node:events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { errMsg, randInt, sleep, withTimeout } from '../lib/utils';
import {
  parseRadarSnapshot,
  radarChanged,
  type RadarSnapshot,
  type SpotPrice,
} from './radar-parser';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawSnapshot {
  source: 'radar' | 'main';
  text: string;
  at: number;
}

export interface FeedStatus {
  source: 'radar' | 'main';
  url: string;
  lastOkAt: number | null;
  lastError: string | null;
  consecutiveErrors: number;
  polls: number;
  staleSec: number;
}

interface ScraperTarget {
  source: 'radar' | 'main';
  url: string;
  rootSelector: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stealth helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extra HTTP headers that make the headless browser look like a real desktop Chrome. */
const STEALTH_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-CH-UA': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'DNT': '1',
};

const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Resources to block — only text/JS needed; skipping these saves 60-70% of bandwidth. */
const BLOCK_RESOURCES = new Set(['image', 'media', 'font', 'stylesheet']);

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket price interceptor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intercepts the page's own WebSocket messages looking for JSON that contains
 * a live XAU/USD price.  Emitted on the 'tick' event as a SpotPrice.
 *
 * Pattern: many financial data widgets push JSON like:
 *   {"bid": 3248.50, "ask": 3249.10, "symbol": "XAUUSD"}
 * or TradingView-style compact arrays. We try both.
 */
async function attachPriceBridge(page: Page, emit: (spot: SpotPrice) => void) {
  await page.exposeFunction('__xau_tick__', (raw: string) => {
    try {
      const obj = JSON.parse(raw);
      // Flat object style
      const bid =
        parseFloat(obj.bid ?? obj.Bid ?? obj.bid_price ?? obj.b ?? '');
      const ask =
        parseFloat(obj.ask ?? obj.Ask ?? obj.ask_price ?? obj.a ?? '');
      if (Number.isFinite(bid) && bid > 1000 && bid < 10_000) {
        const spread = Number.isFinite(ask) && ask > bid ? Math.round((ask - bid) * 100) / 100 : null;
        emit({
          bid,
          ask: Number.isFinite(ask) ? ask : null,
          spread,
          mid: Number.isFinite(ask) ? Math.round(((bid + ask) / 2) * 100) / 100 : bid,
          at: Date.now(),
        });
      }
    } catch {
      /* ignore non-JSON messages */
    }
  });

  // Hook into the native WebSocket to intercept messages
  await page.addInitScript(() => {
    const OWS = window.WebSocket;
    class InterceptedWS extends OWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (ev) => {
          try {
            if (typeof ev.data === 'string') (window as any).__xau_tick__(ev.data);
          } catch {
            /* noop */
          }
        });
      }
    }
    (window as any).WebSocket = InterceptedWS;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Scraper class
// ─────────────────────────────────────────────────────────────────────────────

export class Scraper extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private stopped = false;
  private browserLaunching: Promise<void> | null = null;

  readonly feedStatus = new Map<'radar' | 'main', FeedStatus>();
  private radarText = '';
  private mainText = '';
  private lastSnapshot: RadarSnapshot | null = null;
  private wsTick: SpotPrice | null = null;
  private wsTickAt = 0;

  private readonly targets: ScraperTarget[];

  constructor(targets: ScraperTarget[]) {
    super();
    this.targets = targets;
    for (const t of targets) {
      this.feedStatus.set(t.source, {
        source: t.source,
        url: t.url,
        lastOkAt: null,
        lastError: null,
        consecutiveErrors: 0,
        polls: 0,
        staleSec: 0,
      });
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    for (const t of this.targets) void this.runTarget(t);
    void this.parseLoop();
    void this.healthLoop();
    logger.info({ targets: this.targets.map((t) => t.url) }, 'Scraper started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.browser?.close().catch(() => undefined);
    logger.info('Scraper stopped');
  }

  // ── current state (called by API routes & SignalEngine) ───────────────────

  latestSnapshot(): RadarSnapshot | null {
    return this.lastSnapshot;
  }

  currentPrice(): number | null {
    // Prefer the intercepted WebSocket tick (< 10 s old)
    if (this.wsTick && Date.now() - this.wsTickAt < 10_000) {
      return this.wsTick.mid;
    }
    return this.lastSnapshot?.spot.mid ?? null;
  }

  feedHealthy(): boolean {
    const stale = env.FEED_STALE_SECONDS * 1000;
    return [...this.feedStatus.values()].every(
      (s) => s.lastOkAt !== null && Date.now() - s.lastOkAt < stale,
    );
  }

  statusList(): FeedStatus[] {
    return [...this.feedStatus.values()];
  }

  // ── browser management ────────────────────────────────────────────────────

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context && this.browser?.isConnected()) return this.context;

    if (!this.browserLaunching) {
      this.browserLaunching = (async () => {
        logger.info('Launching headless Chromium');
        await this.browser?.close().catch(() => undefined);
        this.context = null;

        this.browser = await chromium.launch({
          headless: env.SCRAPER_HEADLESS,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--renderer-process-limit=2',
          ],
        });

        this.browser.on('disconnected', () => {
          logger.warn('Chromium disconnected — will relaunch on next poll');
          this.context = null;
        });

        this.context = await this.browser.newContext({
          userAgent: REAL_UA,
          viewport: { width: 1366, height: 900 },
          locale: 'en-US',
          timezoneId: 'UTC',
          extraHTTPHeaders: STEALTH_HEADERS,
          // Persist cookies/localStorage between reloads so the site doesn't
          // see us as a new visitor every few minutes.
          storageState: undefined,
        });

        // Block heavy resources to cut bandwidth
        await this.context.route('**/*', (route) => {
          const type = route.request().resourceType();
          return BLOCK_RESOURCES.has(type) ? route.abort() : route.continue();
        });

        logger.info('Browser context ready');
      })().finally(() => { this.browserLaunching = null; });
    }

    await this.browserLaunching;
    return this.context!;
  }

  // ── page text extraction ──────────────────────────────────────────────────

  private async readPageText(page: Page, rootSelector: string): Promise<string> {
    const parts: string[] = [];

    if (rootSelector !== 'body') {
      // Targeted selector — fast path
      return withTimeout(
        page.locator(rootSelector).first().innerText({ timeout: 10_000 }),
        12_000,
        'innerText',
      );
    }

    // Collect from every frame (main + iframes) — chart widgets often live in iframes
    for (const frame of page.frames()) {
      try {
        const text = await withTimeout(
          frame.locator('body').innerText({ timeout: 5_000 }),
          6_000,
          'frame innerText',
        );
        if (text.trim()) parts.push(text);
      } catch {
        /* cross-origin / detached frame — skip */
      }
    }

    // Also attempt to read specific rich-text containers (common in React/Vue sites)
    for (const sel of ['[class*="signal"]', '[class*="radar"]', '[class*="verdict"]',
      '[class*="fusion"]', '[class*="gate"]', '[class*="setup"]', '[class*="whale"]']) {
      try {
        const el = page.locator(sel).first();
        if (await el.count()) {
          parts.push(await el.innerText({ timeout: 2_000 }));
        }
      } catch {
        /* selector not present */
      }
    }

    return parts.join('\n\n---\n\n');
  }

  // ── per-target polling loop ───────────────────────────────────────────────

  private async runTarget(t: ScraperTarget): Promise<void> {
    const st = this.feedStatus.get(t.source)!;
    const log = logger.child({ source: t.source });
    let page: Page | null = null;
    let loadedAt = 0;
    let bridgeAttached = false;

    while (!this.stopped) {
      try {
        // Open or re-open page
        if (!page || page.isClosed()) {
          const ctx = await this.ensureContext();
          page = await ctx.newPage();
          bridgeAttached = false;

          // Attach WS price bridge BEFORE navigation so the init script is injected
          if (t.source === 'main' || t.source === 'radar') {
            await attachPriceBridge(page, (spot) => {
              this.wsTick = spot;
              this.wsTickAt = Date.now();
              this.emit('tick', spot);
            }).catch((e) => log.debug({ err: errMsg(e) }, 'Bridge attach failed (non-fatal)'));
            bridgeAttached = true;
          }

          log.info({ url: t.url }, 'Navigating to page');
          await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

          // Wait for any dynamic content to settle (up to 10 s)
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

          // Give JS-rendered widgets a moment to populate
          await sleep(2_500);
          loadedAt = Date.now();
          log.info('Page ready');
        } else if (Date.now() - loadedAt > env.PAGE_RELOAD_MINUTES * 60_000) {
          // Periodic hard reload to refresh session / auth tokens
          log.info('Periodic page reload');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
          await sleep(2_000);
          loadedAt = Date.now();
          if (!bridgeAttached) {
            await attachPriceBridge(page, (spot) => {
              this.wsTick = spot;
              this.wsTickAt = Date.now();
              this.emit('tick', spot);
            }).catch(() => undefined);
          }
        }

        // Read text
        const text = await this.readPageText(page, t.rootSelector);
        if (!text.trim()) throw new Error('Empty page text (page may still be loading)');

        // Store and update status
        if (t.source === 'radar') this.radarText = text;
        if (t.source === 'main') this.mainText = text;

        st.polls++;
        st.lastOkAt = Date.now();
        st.lastError = null;
        st.consecutiveErrors = 0;

        // Emit raw snapshot (for debug / logging)
        this.emit('raw', { source: t.source, text, at: Date.now() } satisfies RawSnapshot);

      } catch (e) {
        st.consecutiveErrors++;
        st.lastError = errMsg(e);
        log.warn({ err: st.lastError, n: st.consecutiveErrors }, 'Scrape error');

        // Dispose broken page
        if (st.consecutiveErrors >= 3 && page) {
          await page.close().catch(() => undefined);
          page = null;
          bridgeAttached = false;
        }

        // Exponential back-off after repeated failures
        if (st.consecutiveErrors >= 10) {
          await sleep(Math.min(120_000, 5_000 * (st.consecutiveErrors - 9)));
        }
      }

      await sleep(randInt(env.POLL_MIN_MS, env.POLL_MAX_MS));
    }

    await page?.close().catch(() => undefined);
  }

  // ── parse loop — convert raw text → RadarSnapshot every cycle ────────────

  private async parseLoop(): Promise<void> {
    const { env: envCfg } = await import('../config/env');
    while (!this.stopped) {
      if (this.radarText || this.mainText) {
        try {
          const next = parseRadarSnapshot(this.radarText, this.mainText, {
            priceMin: envCfg.PRICE_MIN,
            priceMax: envCfg.PRICE_MAX,
            now: Date.now(),
          });

          // Merge a WebSocket tick if fresher
          if (this.wsTick && Date.now() - this.wsTickAt < 10_000) {
            next.spot.bid = this.wsTick.bid ?? next.spot.bid;
            next.spot.ask = this.wsTick.ask ?? next.spot.ask;
            next.spot.spread = this.wsTick.spread ?? next.spot.spread;
            next.spot.mid = this.wsTick.mid ?? next.spot.mid;
          }

          if (radarChanged(this.lastSnapshot, next)) {
            this.lastSnapshot = next;
            this.emit('snapshot', next);
            logger.debug(
              {
                bias: next.fusion.bias,
                conf: next.fusion.confidence,
                gates: next.execution.overall,
                buy: !!next.buySetup,
                sell: !!next.sellSetup,
                session: next.zoneLadder.currentSession,
                whale: next.zoneLadder.whaleFlow,
                bid: next.spot.bid,
                ask: next.spot.ask,
              },
              'Radar snapshot updated',
            );
          } else {
            // Always update spot price even when nothing else changed
            if (this.lastSnapshot) {
              this.lastSnapshot.spot = next.spot;
              this.lastSnapshot.at = next.at;
            }
          }
        } catch (e) {
          logger.error({ err: errMsg(e) }, 'Radar parse failed');
        }
      }
      await sleep(env.POLL_MIN_MS);
    }
  }

  // ── health loop — emit feed-down / restored events ────────────────────────

  private async parseLoopStarted = false;
  private previouslyHealthy: boolean | null = null;

  private async healthLoop(): Promise<void> {
    while (!this.stopped) {
      const now = Date.now();
      const staleMs = env.FEED_STALE_SECONDS * 1000;

      for (const st of this.feedStatus.values()) {
        st.staleSec = st.lastOkAt ? Math.floor((now - st.lastOkAt) / 1000) : -1;
      }

      const healthy = this.feedHealthy();
      if (this.previouslyHealthy !== null && this.previouslyHealthy !== healthy) {
        this.emit('healthChange', { healthy, statuses: this.statusList() });
        logger.warn({ healthy }, 'Feed health changed');
      }
      this.previouslyHealthy = healthy;

      await sleep(10_000);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — wires targets from env config
// ─────────────────────────────────────────────────────────────────────────────

export function createScraper(): Scraper {
  const targets: ScraperTarget[] = [
    { source: 'radar', url: env.RADAR_URL, rootSelector: 'body' },
    { source: 'main', url: env.MAIN_URL, rootSelector: 'body' },
  ];
  return new Scraper(targets);
}
