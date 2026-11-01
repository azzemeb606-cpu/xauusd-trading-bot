import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountMonitor } from './accountMonitor';
import type { Broker, BrokerPosition, AccountInfo } from '../broker/types';
import type { BrokerManager } from '../broker/manager';
import type { Store } from '../db/store';
import type { Notifier } from '../notify/notifier';
import type { SettingsService } from './settings';

describe('AccountMonitor & Drawdown Kill-Switch', () => {
  let monitor: AccountMonitor;
  let mockBroker: any;
  let mockBrokers: any;
  let mockStore: any;
  let mockNotifier: any;
  let mockSettings: any;
  let settingsState: any;

  beforeEach(() => {
    settingsState = {
      tradingMode: 'DEMO_ONLY',
      autoTrading: true,
      dailyDdWarnPct: 2.0,
      maxDailyDrawdownPct: 3.0,
      tpExecutionStyle: 'SPLIT_ORDERS',
    };

    mockBroker = {
      key: 'demo',
      label: 'Demo Account',
      symbol: 'XAUUSD',
      isConnected: vi.fn().mockReturnValue(true),
      getAccountInfo: vi.fn().mockResolvedValue({
        balance: 10000,
        equity: 10000,
        margin: 0,
        freeMargin: 10000,
        marginLevel: null,
        currency: 'USD',
      } as AccountInfo),
      getPositions: vi.fn().mockResolvedValue([] as BrokerPosition[]),
      getOrders: vi.fn().mockResolvedValue([]),
      getClosedDealsSince: vi.fn().mockResolvedValue([]),
    };

    mockBrokers = {
      all: vi.fn().mockReturnValue([mockBroker]),
      tradeTargets: vi.fn().mockReturnValue([mockBroker]),
    } as unknown as BrokerManager;

    mockStore = {
      getDayStart: vi.fn().mockReturnValue(10000),
      setDayStart: vi.fn(),
      insertSnapshot: vi.fn(),
      pruneSnapshots: vi.fn(),
    } as unknown as Store;

    mockNotifier = {
      notify: vi.fn(),
    } as unknown as Notifier;

    mockSettings = {
      get: vi.fn().mockImplementation(() => settingsState),
      update: vi.fn().mockImplementation((patch) => {
        Object.assign(settingsState, patch);
        return settingsState;
      }),
    } as unknown as SettingsService;

    monitor = new AccountMonitor(mockBrokers, mockStore, mockNotifier, mockSettings);
  });

  it('computes daily drawdown and realized P&L percentage', async () => {
    // Starting equity was $10,000, current equity is $9,850 (1.5% drawdown)
    mockBroker.getAccountInfo.mockResolvedValueOnce({
      balance: 9900,
      equity: 9850,
      margin: 100,
      freeMargin: 9750,
      marginLevel: 9850,
      currency: 'USD',
    });

    // @ts-expect-error accessing private method for test
    await monitor.poll(mockBroker);

    const snap = monitor.snapshots.get('demo');
    expect(snap).toBeDefined();
    expect(snap?.dailyDdPct).toBe(1.5);
    expect(mockNotifier.notify).not.toHaveBeenCalled();
    expect(settingsState.autoTrading).toBe(true);
  });

  it('triggers warning alert when drawdown reaches dailyDdWarnPct (2.0%)', async () => {
    // Current equity $9,780 (2.2% drawdown >= 2.0%)
    mockBroker.getAccountInfo.mockResolvedValueOnce({
      balance: 9800,
      equity: 9780,
      margin: 50,
      freeMargin: 9730,
      marginLevel: 19560,
      currency: 'USD',
    });

    // @ts-expect-error accessing private method for test
    await monitor.poll(mockBroker);

    const snap = monitor.snapshots.get('demo');
    expect(snap?.dailyDdPct).toBe(2.2);
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DRAWDOWN_WARNING',
        severity: 'warning',
      }),
    );
    // Trading still active on warning
    expect(settingsState.autoTrading).toBe(true);
  });

  it('triggers KILL-SWITCH and pauses autoTrading when daily loss reaches maxDailyDrawdownPct (3.0%)', async () => {
    // Current equity $9,650 (3.5% drawdown >= 3.0%)
    mockBroker.getAccountInfo.mockResolvedValueOnce({
      balance: 9700,
      equity: 9650,
      margin: 100,
      freeMargin: 9550,
      marginLevel: 9650,
      currency: 'USD',
    });

    // @ts-expect-error accessing private method for test
    await monitor.poll(mockBroker);

    const snap = monitor.snapshots.get('demo');
    expect(snap?.dailyDdPct).toBe(3.5);
    // Critical notification dispatched
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DRAWDOWN_LIMIT',
        severity: 'critical',
      }),
    );
    // KILL SWITCH MUST PAUSE AUTO TRADING
    expect(settingsState.autoTrading).toBe(false);
  });
});
