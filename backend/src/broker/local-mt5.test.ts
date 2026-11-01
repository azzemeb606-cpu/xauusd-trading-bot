import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalMT5Adapter } from './local-mt5';

describe('LocalMT5Adapter', () => {
  const cfg = {
    baseUrl: 'http://127.0.0.1:8000',
    key: 'demo' as const,
    label: 'Test MT5 Demo',
    symbol: 'XAUUSD',
  };

  let adapter: LocalMT5Adapter;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    adapter = new LocalMT5Adapter(cfg);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('connects successfully to local bridge', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: 'Connected' }),
    });

    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('handles connect failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Error',
    });

    await expect(adapter.connect()).rejects.toThrow('Local MT5 HTTP 500');
    expect(adapter.isConnected()).toBe(false);
  });

  it('fetches account info and formats telemetry', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        balance: 10500.25,
        equity: 10650.5,
        margin: 120.0,
        freeMargin: 10530.5,
        marginLevel: 8875.4,
        currency: 'USD',
        leverage: 100,
        company: 'Exness',
      }),
    });

    const info = await adapter.getAccountInfo();
    expect(info.balance).toBe(10500.25);
    expect(info.equity).toBe(10650.5);
    expect(info.margin).toBe(120.0);
    expect(info.freeMargin).toBe(10530.5);
    expect(info.broker).toBe('Exness');
  });

  it('fetches quote and symbol spec', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/quote')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ bid: 2740.1, ask: 2740.4, time: 1730000000 }),
        });
      }
      if (url.includes('/spec')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            trade_contract_size: 100,
            volume_min: 0.01,
            volume_max: 50.0,
            volume_step: 0.01,
            digits: 2,
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const quote = await adapter.getQuote();
    expect(quote.bid).toBe(2740.1);
    expect(quote.ask).toBe(2740.4);

    const spec = await adapter.getSpec();
    expect(spec.contractSize).toBe(100);
    expect(spec.minVolume).toBe(0.01);
  });

  it('places order and receives ticket id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        orderId: '987654',
        positionId: '987654',
        code: 'TRADE_RETCODE_DONE',
        message: 'Order executed',
      }),
    });

    const res = await adapter.placeOrder({
      direction: 'BUY',
      kind: 'MARKET',
      volume: 0.1,
      sl: 2720,
      tp: 2750,
      comment: 'Test Buy',
      clientId: 'T1',
    });

    expect(res.ok).toBe(true);
    expect(res.orderId).toBe('987654');
  });

  it('supports partial position close', async () => {
    let capturedBody: any = null;
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, message: 'Position closed' }),
      });
    });

    const res = await adapter.closePosition('123456', 0.05);
    expect(res.ok).toBe(true);
    expect(capturedBody).toEqual({ ticket: 123456, volume: 0.05 });
  });
});
