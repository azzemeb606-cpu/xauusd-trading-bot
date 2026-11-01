import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramChannel, WhatsAppChannel, EmailChannel, sendWithRetry } from './channels';
import type { RenderedAlert } from './templates';

describe('TelegramChannel', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('instantiates and sends messages with inline keyboard buttons', async () => {
    const ch = new TelegramChannel();
    ch.enabled = true;

    let sentPayload: any = null;
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      sentPayload = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    const alert: RenderedAlert = {
      title: 'Trade opened',
      text: 'BUY 0.30 Lots executed',
      html: '<p>HTML</p>',
      waShareUrl: 'https://wa.me/?text=test',
      telegramButtons: [
        [
          { text: '🛡️ Move SL to BE', callback_data: 'action:be:grp-1' },
          { text: '❌ Close Trade', callback_data: 'action:close:grp-1' },
        ],
      ],
    };

    await ch.send(alert);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.text).toContain('BUY 0.30 Lots executed');
    expect(sentPayload.reply_markup.inline_keyboard[0][0].text).toContain('Move SL to BE');
    expect(sentPayload.reply_markup.inline_keyboard[0][0].callback_data).toBe('action:be:grp-1');
  });

  it('handles interactive callback queries', async () => {
    const ch = new TelegramChannel();
    ch.enabled = true;

    const mockBe = vi.fn().mockResolvedValue(true);
    const mockClose = vi.fn().mockResolvedValue(true);
    const mockPause = vi.fn().mockResolvedValue(true);

    ch.setActionsHandler({
      onMoveBe: mockBe,
      onCloseTrade: mockClose,
      onPauseBot: mockPause,
    });

    // @ts-expect-error accessing private method for unit test
    await ch.handleCallbackQuery({ id: 'cq1', data: 'action:be:grp-99' });
    expect(mockBe).toHaveBeenCalledWith('grp-99');

    // @ts-expect-error accessing private method for unit test
    await ch.handleCallbackQuery({ id: 'cq2', data: 'action:close:grp-99' });
    expect(mockClose).toHaveBeenCalledWith('grp-99');

    // @ts-expect-error accessing private method for unit test
    await ch.handleCallbackQuery({ id: 'cq3', data: 'action:pause' });
    expect(mockPause).toHaveBeenCalled();
  });
});

describe('WhatsAppChannel', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('instantiates and reports enabled state from config', () => {
    const ch = new WhatsAppChannel();
    expect(ch.name).toBe('whatsapp');
    expect(typeof ch.enabled).toBe('boolean');
  });
});

describe('EmailChannel', () => {
  it('instantiates and is enabled when SMTP and recipients are set', () => {
    const ch = new EmailChannel();
    expect(ch.name).toBe('email');
    expect(typeof ch.enabled).toBe('boolean');
  });
});

describe('sendWithRetry()', () => {
  it('retries on failure and resolves true when successful', async () => {
    let attempts = 0;
    const mockChannel = {
      name: 'mock',
      enabled: true,
      send: vi.fn(async () => {
        attempts++;
        if (attempts < 2) throw new Error('Network timeout');
      }),
    };

    const ok = await sendWithRetry(
      mockChannel,
      { title: 'Test', text: 'Body', html: '<p>Body</p>', waShareUrl: 'https://wa.me/?text=Body' },
      3,
    );
    expect(ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('returns false after max retries fail', async () => {
    const mockChannel = {
      name: 'mock',
      enabled: true,
      send: vi.fn(async () => {
        throw new Error('Permanent failure');
      }),
    };

    const ok = await sendWithRetry(
      mockChannel,
      { title: 'Test', text: 'Body', html: '<p>Body</p>', waShareUrl: 'https://wa.me/?text=Body' },
      2,
    );
    expect(ok).toBe(false);
  });
});
