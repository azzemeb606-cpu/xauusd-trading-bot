import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { errMsg, sleep } from '../lib/utils';
import type { RenderedAlert } from './templates';

export interface Channel {
  name: string;
  enabled: boolean;
  send(msg: RenderedAlert): Promise<void>;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json().catch(() => ({}));
}

export interface TelegramActionsHandler {
  onMoveBe?: (groupId: string) => Promise<boolean>;
  onCloseTrade?: (groupId: string) => Promise<boolean>;
  onPauseBot?: () => Promise<boolean>;
  onResumeBot?: () => Promise<boolean>;
}

export class TelegramChannel implements Channel {
  name = 'telegram';
  enabled = !!env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_IDS.length > 0;
  private polling = false;
  private lastUpdateId = 0;
  private actionsHandler?: TelegramActionsHandler;

  setActionsHandler(handler: TelegramActionsHandler) {
    this.actionsHandler = handler;
  }

  async send(msg: RenderedAlert) {
    if (!this.enabled) return;
    for (const chatId of env.TELEGRAM_CHAT_IDS) {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: msg.text.slice(0, 4000),
        disable_web_page_preview: true,
      };

      if (msg.telegramButtons && msg.telegramButtons.length > 0) {
        payload['reply_markup'] = {
          inline_keyboard: msg.telegramButtons,
        };
      }

      await postJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, payload);
    }
  }

  /**
   * Starts a background polling loop to process interactive Telegram inline buttons:
   * [🛡️ Move SL to BE], [❌ Close Trade], [⏸️ Pause Bot]
   */
  startInteractivePolling() {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    logger.info('Telegram interactive callback listener started');
    void this.pollLoop();
  }

  stopInteractivePolling() {
    this.polling = false;
  }

  private async pollLoop() {
    while (this.polling) {
      try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (res.ok) {
          const data: any = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const upd of data.result) {
              this.lastUpdateId = upd.update_id;
              if (upd.callback_query) {
                await this.handleCallbackQuery(upd.callback_query);
              }
            }
          }
        }
      } catch {
        // Network timeout / backoff
      }
      await sleep(1500);
    }
  }

  private async handleCallbackQuery(cq: any) {
    const data = String(cq.data ?? '');
    const cqId = cq.id;
    let replyText = 'Action processed';

    try {
      if (data.startsWith('action:be:') && this.actionsHandler?.onMoveBe) {
        const groupId = data.replace('action:be:', '');
        const ok = await this.actionsHandler.onMoveBe(groupId);
        replyText = ok ? '🛡️ SL moved to Break-Even!' : 'Failed to move SL to BE';
      } else if (data.startsWith('action:close:') && this.actionsHandler?.onCloseTrade) {
        const groupId = data.replace('action:close:', '');
        const ok = await this.actionsHandler.onCloseTrade(groupId);
        replyText = ok ? '❌ Trade closed successfully!' : 'Failed to close trade';
      } else if (data === 'action:pause' && this.actionsHandler?.onPauseBot) {
        await this.actionsHandler.onPauseBot();
        replyText = '⏸️ Bot Auto-Trading PAUSED';
      } else if (data === 'action:resume' && this.actionsHandler?.onResumeBot) {
        await this.actionsHandler.onResumeBot();
        replyText = '▶️ Bot Auto-Trading RESUMED';
      }

      await postJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: cqId,
        text: replyText,
        show_alert: true,
      });
    } catch (e) {
      logger.warn({ err: errMsg(e) }, 'Telegram callback query handle failed');
    }
  }
}

export class EmailChannel implements Channel {
  name = 'email';
  enabled = !!env.SMTP_HOST && env.EMAIL_TO.length > 0;
  private transport = this.enabled
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      })
    : null;

  async send(msg: RenderedAlert) {
    if (!this.transport) return;
    await this.transport.sendMail({
      from: env.EMAIL_FROM || env.SMTP_USER || 'XAUUSD Bot <noreply@xauusdbot.local>',
      to: env.EMAIL_TO.join(','),
      subject: `[XAUUSD Bot] ${msg.title}`,
      text: msg.text,
      html: msg.html,
    });
  }
}

/**
 * WhatsApp via one of:
 *  - callmebot : Free personal-use gateway (https://api.callmebot.com/whatsapp.php)
 *  - ultramsg  : UltraMsg WhatsApp API (https://api.ultramsg.com)
 *  - twilio    : Twilio WhatsApp API
 *  - meta      : Meta WhatsApp Cloud API
 */
export class WhatsAppChannel implements Channel {
  name = 'whatsapp';
  enabled =
    (env.WHATSAPP_PROVIDER === 'callmebot' && env.CALLMEBOT_RECIPIENTS.length > 0) ||
    (env.WHATSAPP_PROVIDER === 'ultramsg' && !!env.ULTRAMSG_INSTANCE_ID && !!env.ULTRAMSG_TOKEN && env.WHATSAPP_TO.length > 0) ||
    (env.WHATSAPP_PROVIDER === 'twilio' && !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && !!env.TWILIO_WHATSAPP_FROM && env.WHATSAPP_TO.length > 0) ||
    (env.WHATSAPP_PROVIDER === 'meta' && !!env.META_WA_TOKEN && !!env.META_WA_PHONE_NUMBER_ID && env.WHATSAPP_TO.length > 0);

  async send(msg: RenderedAlert) {
    // Append 1-click share link
    const textWithShare = `${msg.text.slice(0, 1400)}\n\n🔗 Quick Share: ${msg.waShareUrl}`;

    if (env.WHATSAPP_PROVIDER === 'callmebot') {
      for (const pair of env.CALLMEBOT_RECIPIENTS) {
        const [phone, apikey] = pair.split(':');
        const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(textWithShare)}&apikey=${encodeURIComponent(apikey ?? '')}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`CallMeBot HTTP ${res.status}`);
        await sleep(1500); // CallMeBot rate limit
      }
    } else if (env.WHATSAPP_PROVIDER === 'ultramsg') {
      const url = `https://api.ultramsg.com/${env.ULTRAMSG_INSTANCE_ID}/messages/chat`;
      for (const to of env.WHATSAPP_TO) {
        await postJson(url, {
          token: env.ULTRAMSG_TOKEN,
          to: to.replace(/[^\d+]/g, ''),
          body: textWithShare,
        });
        await sleep(500);
      }
    } else if (env.WHATSAPP_PROVIDER === 'twilio') {
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
      for (const to of env.WHATSAPP_TO) {
        const body = new URLSearchParams({
          From: env.TWILIO_WHATSAPP_FROM!.startsWith('whatsapp:') ? env.TWILIO_WHATSAPP_FROM! : `whatsapp:${env.TWILIO_WHATSAPP_FROM}`,
          To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
          Body: textWithShare,
        });
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Twilio HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
    } else if (env.WHATSAPP_PROVIDER === 'meta') {
      for (const to of env.WHATSAPP_TO) {
        await postJson(
          `https://graph.facebook.com/v20.0/${env.META_WA_PHONE_NUMBER_ID}/messages`,
          { messaging_product: 'whatsapp', to: to.replace(/[^\d]/g, ''), type: 'text', text: { body: textWithShare } },
          { authorization: `Bearer ${env.META_WA_TOKEN}` },
        );
      }
    }
  }
}

export async function sendWithRetry(ch: Channel, msg: RenderedAlert, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await ch.send(msg);
      return true;
    } catch (e) {
      logger.warn({ channel: ch.name, attempt: i, err: errMsg(e) }, 'Notification send failed');
      if (i < attempts) await sleep(1000 * 2 ** i);
    }
  }
  return false;
}
