import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TradeManager, computeStats } from './tradeManager';
import type { Broker, SymbolSpec, AccountInfo, Quote, TradeResult } from '../broker/types';
import type { Signal, TradeGroup } from '../types';

describe('computeStats()', () => {
  const dummyGroup = (pnl: number, daysAgo = 0): TradeGroup => ({
    id: `g-${Math.random()}`,
    signalId: 'sig-1',
    account: 'demo',
    accountLabel: 'Demo Account',
    symbol: 'XAUUSD',
    direction: 'BUY',
    kind: 'MARKET',
    entry: 3240,
    sl: 3230,
    currentSl: 3230,
    tp1: 3260,
    legs: [],
    status: 'CLOSED',
    beMoved: false,
    trailedToTp1: false,
    createdAt: Date.now() - daysAgo * 86_400_000 - 3600_000,
    openedAt: Date.now() - daysAgo * 86_400_000 - 3500_000,
    closedAt: Date.now() - daysAgo * 86_400_000,
    realizedPnl: pnl,
  });

  it('calculates win rate, PnL, streaks accurately', () => {
    const groups = [
      dummyGroup(150, 0),
      dummyGroup(80, 0),
      dummyGroup(-50, 1),
      dummyGroup(200, 2),
    ];
    const stats = computeStats(groups, new Date(), 'UTC');
    expect(stats.total).toBe(4);
    expect(stats.wins).toBe(3);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(75);
    expect(stats.totalPnl).toBe(380);
    expect(stats.bestTrade).toBe(200);
    expect(stats.worstTrade).toBe(-50);
    expect(stats.profitFactor).toBeCloseTo(430 / 50, 1);
  });
});

describe('TradeManager Multi-Leg & Lifecycle', () => {
  let mockStore: any;
  let mockNotifier: any;
  let mockSettings: any;
  let mockBroker: any;
  let mockBrokers: any;
  let tradeManager: TradeManager;

  const sampleSignal: Signal = {
    id: 'sig-test-123',
    source: 'radar',
    direction: 'BUY',
    hintedKind: 'MARKET',
    entry: 3240,
    sl: 3230,
    tp1: 3250,
    tp2: 3260,
    tp3: 3270,
    detectedAt: Date.now(),
    rawExcerpt: '',
  };

  beforeEach(() => {
    const kvStore = new Map<string, any>();
    const groupsStore = new Map<string, TradeGroup>();

    mockStore = {
      getKv: vi.fn((k: string) => kvStore.get(k) ?? null),
      setKv: vi.fn((k: string, v: any) => kvStore.set(k, v)),
      saveGroup: vi.fn((g: TradeGroup) => groupsStore.set(g.id, g)),
      getGroup: vi.fn((id: string) => groupsStore.get(id) ?? null),
      activeGroups: vi.fn(() => [...groupsStore.values()].filter((g) => ['PENDING', 'OPEN'].includes(g.status))),
      listGroups: vi.fn(() => [...groupsStore.values()]),
    };

    mockNotifier = {
      notify: vi.fn(),
    };

    mockSettings = {
      get: vi.fn(() => ({
        autoTrading: true,
        killSwitch: false,
        tradingMode: 'DEMO_ONLY',
        riskPercent: 1,
        fixedLot: 0,
        maxLot: 1,
        tpSplit: [50, 30, 20],
        minRR: 1.2,
        minSlDistance: 2,
        maxSlDistance: 30,
        maxSpread: 0.8,
        maxEntryDeviation: 2,
        signalMaxAgeSec: 600,
        confluenceMode: 'NO_CONFLICT',
        sessionWindows: '00:00-23:59',
        blackoutWindows: '',
        maxOpenGroups: 1,
        maxDailyDrawdownPct: 5,
        dailyDdWarnPct: 3,
        cooldownAfterLossMin: 30,
        minMarginLevel: 300,
        orderTypePreference: 'AUTO',
        pendingExpiryMin: 60,
        beBuffer: 0.3,
        moveBeOnTp1: true,
        trailToTp1OnTp2: true,
        notifyGateBlocks: false,
        minFusionConfidence: 65,
        minBrainsAgreement: 5,
        maxLimitProximity: 15,
        allowPendingOrders: true,
        newsBlackoutMin: 15,
        tpExecutionStyle: 'SPLIT_ORDERS',
      })),
    };

    mockBroker = {
      key: 'demo',
      label: 'Demo Broker',
      symbol: 'XAUUSD',
      isConnected: vi.fn(() => true),
      getAccountInfo: vi.fn(async () => ({
        balance: 10000,
        equity: 10000,
        margin: 0,
        freeMargin: 10000,
        marginLevel: null,
        currency: 'USD',
      })),
      getSpec: vi.fn(async () => ({
        contractSize: 100,
        minVolume: 0.01,
        maxVolume: 50,
        volumeStep: 0.01,
        digits: 2,
      })),
      getQuote: vi.fn(async () => ({
        bid: 3239.8,
        ask: 3240.2,
        time: Date.now(),
      })),
      placeOrder: vi.fn(async (req: any) => ({
        ok: true,
        orderId: `ord-${Math.random().toString(36).slice(2, 7)}`,
        positionId: `pos-${Math.random().toString(36).slice(2, 7)}`,
        message: 'Order executed',
      })),
      modifyPosition: vi.fn(async () => ({ ok: true, message: 'Modified' })),
      cancelOrder: vi.fn(async () => ({ ok: true, message: 'Cancelled' })),
      closePosition: vi.fn(async () => ({ ok: true, message: 'Closed' })),
      getPositionClose: vi.fn(async () => null),
      getPositions: vi.fn(async () => []),
      getOrders: vi.fn(async () => []),
    };

    mockBrokers = {
      get: vi.fn((k: string) => (k === 'demo' ? mockBroker : undefined)),
      all: vi.fn(() => [mockBroker]),
      tradeTargets: vi.fn(() => [mockBroker]),
    };

    tradeManager = new TradeManager(mockBrokers, mockStore, mockNotifier, mockSettings);
  });

  it('executes a market trade into 3 distinct TP legs (50%, 30%, 20%)', async () => {
    const groups = await tradeManager.execute(sampleSignal, 'MARKET', [mockBroker]);
    expect(groups).toHaveLength(1);
    const g = groups[0];

    expect(g.status).toBe('OPEN');
    expect(g.legs).toHaveLength(3);
    expect(g.legs[0].tpLevel).toBe(1);
    expect(g.legs[0].tp).toBe(3250);
    expect(g.legs[1].tpLevel).toBe(2);
    expect(g.legs[1].tp).toBe(3260);
    expect(g.legs[2].tpLevel).toBe(3);
    expect(g.legs[2].tp).toBe(3270);

    // Sum of leg volumes
    const totalVol = g.legs.reduce((a, l) => a + l.volume, 0);
    expect(totalVol).toBeGreaterThanOrEqual(0.03);

    // Verify notification fired
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TRADE_OPENED',
        severity: 'success',
      }),
    );
  });

  it('rejects order if slippage exceeds guard limit', async () => {
    // Current price is 3245 (drift = $5, guard limit = $3)
    mockBroker.getQuote = vi.fn(async () => ({
      bid: 3244.8,
      ask: 3245.2,
      time: Date.now(),
    }));

    const groups = await tradeManager.execute(sampleSignal, 'MARKET', [mockBroker]);
    expect(groups[0].status).toBe('FAILED');
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TRADE_FAILED',
        severity: 'critical',
      }),
    );
  });

  it('moves Break-Even when TP1 is closed', async () => {
    const groups = await tradeManager.execute(sampleSignal, 'MARKET', [mockBroker]);
    const g = groups[0];

    // Mock broker returning leg 1 as closed at TP (3250) with $50 profit
    const leg1 = g.legs[0];
    const leg2 = g.legs[1];
    const leg3 = g.legs[2];

    mockBroker.getPositions = vi.fn(async () => [
      { id: leg2.positionId, symbol: 'XAUUSD', type: 'BUY', volume: leg2.volume, openPrice: 3240, profit: 30, swap: 0, commission: 0, time: '' },
      { id: leg3.positionId, symbol: 'XAUUSD', type: 'BUY', volume: leg3.volume, openPrice: 3240, profit: 30, swap: 0, commission: 0, time: '' },
    ]);

    mockBroker.getPositionClose = vi.fn(async (posId: string) => {
      if (posId === leg1.positionId) {
        return { positionId: posId, price: 3250, profit: 50, reason: 'TP', time: new Date().toISOString() };
      }
      return null;
    });

    // Run tick
    await (tradeManager as any).tick();

    // Verify modifyPosition was called for remaining legs with BE price: 3240 + 0.3 = 3240.3
    expect(mockBroker.modifyPosition).toHaveBeenCalledWith(leg2.positionId, 3240.3, leg2.tp);
    expect(mockBroker.modifyPosition).toHaveBeenCalledWith(leg3.positionId, 3240.3, leg3.tp);
    expect(g.beMoved).toBe(true);

    // Verify TP_HIT and BE_MOVED notifications
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TP_HIT',
        data: expect.objectContaining({ level: 1 }),
      }),
    );
    expect(mockNotifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BE_MOVED',
        data: expect.objectContaining({ newSl: 3240.3 }),
      }),
    );
  });

  it('manually closes a trade group via closeGroup()', async () => {
    const groups = await tradeManager.execute(sampleSignal, 'MARKET', [mockBroker]);
    const g = groups[0];

    await tradeManager.closeGroup(g.id);
    expect(mockBroker.closePosition).toHaveBeenCalled();
  });
});
