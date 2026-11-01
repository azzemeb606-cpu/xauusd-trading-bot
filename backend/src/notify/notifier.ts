import { EventEmitter } from 'node:events';
import type { Store, StoredEvent } from '../db/store';
import { logger } from '../lib/logger';
import type { AlertEvent } from '../types';
import { Channel, EmailChannel, TelegramChannel, WhatsAppChannel, sendWithRetry } from './channels';
import { renderAlert } from './templates';

const DEDUPE_MS = 10 * 60_000;

/**
 * Central alert hub: persists every event, pushes it to the dashboard (via the
 * 'event' emitter) and fans out to WhatsApp / Telegram / Email without ever
 * blocking the trading loop.
 */
export class Notifier extends EventEmitter {
  readonly channels: Channel[] = [new WhatsAppChannel(), new TelegramChannel(), new EmailChannel()];
  private recent = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private store: Store) {
    super();
    logger.info({ channels: this.channels.map((c) => `${c.name}:${c.enabled ? 'on' : 'off'}`) }, 'Notifier ready');
  }

  status() {
    return this.channels.map((c) => ({ name: c.name, enabled: c.enabled }));
  }

  getTelegramChannel(): TelegramChannel | undefined {
    return this.channels.find((c): c is TelegramChannel => c.name === 'telegram');
  }

  notify(e: AlertEvent): StoredEvent | null {
    const now = Date.now();
    if (e.dedupeKey) {
      const last = this.recent.get(e.dedupeKey);
      if (last && now - last < DEDUPE_MS) return null;
      this.recent.set(e.dedupeKey, now);
      if (this.recent.size > 1000) for (const [k, t] of this.recent) if (now - t > DEDUPE_MS) this.recent.delete(k);
    }
    const msg = renderAlert(e);
    const stored = this.store.insertEvent({ type: e.type, severity: e.severity, title: msg.title, message: msg.text, data: e.data, at: now });
    this.emit('event', stored);
    logger.info({ type: e.type, title: msg.title }, 'ALERT');

    const targets = this.channels.filter((c) => c.enabled);
    // Serialise sends so bursts (e.g. TP1 + BE) arrive in order.
    this.queue = this.queue
      .then(() => Promise.all(targets.map((c) => sendWithRetry(c, msg))))
      .catch((err) => logger.error({ err }, 'Notification queue error'));
    return stored;
  }
}
