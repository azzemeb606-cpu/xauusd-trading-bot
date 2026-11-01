import { describe, it, expect } from 'vitest';
import { renderAlert } from './templates';
import type { AlertEvent } from '../types';

describe('Module 4: Instant Notification Dispatcher (Roman Urdu + English)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Event A: Signal Detected / Pending Setup Ready
  // ─────────────────────────────────────────────────────────────────────────
  it('renders Event A (Signal Detected / Pending Setup Ready)', () => {
    const ev: AlertEvent = {
      type: 'SETUP_FORMED',
      severity: 'info',
      data: {
        symbol: 'XAUUSD',
        direction: 'BUY',
        entryZoneLow: 3238.0,
        entryZoneHigh: 3242.0,
        anchorPrice: 3240.0,
        entry: 3240.0,
        sl: 3230.0,
        tp1: 3255.0,
        tp2: 3270.0,
        tp3: 3285.0,
        rr: 2.5,
        fusionConf: 72.5,
        alignedBrains: 7,
        whaleFlow: 'BUYING',
        session: 'LONDON',
        hintedKind: 'MARKET',
      },
    };
    const rendered = renderAlert(ev);
    expect(rendered.title).toContain('Signal Detected: XAUUSD BUY');
    expect(rendered.text).toContain('EVENT A: SIGNAL DETECTED');
    expect(rendered.text).toContain('SIGNAL DETECT HO GAYA HAI');
    expect(rendered.text).toContain('Entry Zone: 3238.00 se 3242.00');
    expect(rendered.text).toContain('TP1: 3255.00 | TP2: 3270.00 | TP3: 3285.00');
    expect(rendered.html).toContain('BOND 007 SWING RADAR');
    expect(rendered.html).toContain('ROMAN URDU WAJAHAT &amp; GUIDANCE'.replace('&amp;', '&'));
    expect(rendered.waShareUrl).toContain('https://wa.me/?text=');
    expect(rendered.telegramButtons).toBeDefined();
    expect(rendered.telegramButtons![0][0].text).toContain('Open Web Dashboard');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event B: Auto-Trade Executed (Buy/Sell Opened)
  // ─────────────────────────────────────────────────────────────────────────
  it('renders Event B (Auto-Trade Executed with Ticket, Risk $, Lots, and TPs)', () => {
    const ev: AlertEvent = {
      type: 'TRADE_OPENED',
      severity: 'success',
      data: {
        symbol: 'XAUUSD',
        direction: 'BUY',
        accountLabel: 'Live Account',
        accountType: 'LIVE',
        orderTicket: '987654',
        openPrice: 3240.5,
        volume: 0.3,
        legs: 3,
        entry: 3240.5,
        sl: 3230.0,
        tp1: 3255.0,
        tp2: 3270.0,
        tp3: 3285.0,
        riskUsd: 150.0,
        riskPercent: 1.0,
        balance: 15000.0,
        groupId: 'grp-1234',
      },
    };
    const rendered = renderAlert(ev);
    expect(rendered.title).toContain('Auto-Trade Executed: XAUUSD BUY [LIVE ACCOUNT]');
    expect(rendered.text).toContain('EVENT B: AUTO-TRADE EXECUTED');
    expect(rendered.text).toContain('AUTO-TRADE KHUL GAYI HAI');
    expect(rendered.text).toContain('Ticket: #987654');
    expect(rendered.text).toContain('Volume: 0.30 lots');
    expect(rendered.text).toContain('Risk: $150.00 (1.00%)');
    expect(rendered.telegramButtons).toBeDefined();
    // Has interactive inline buttons for Trade Management
    expect(rendered.telegramButtons![0][0].text).toContain('Move SL to BE');
    expect(rendered.telegramButtons![0][0].callback_data).toBe('action:be:grp-1234');
    expect(rendered.telegramButtons![0][1].text).toContain('Close Trade');
    expect(rendered.telegramButtons![0][1].callback_data).toBe('action:close:grp-1234');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event C: TP1 Hit & SL Moved to Break-Even
  // ─────────────────────────────────────────────────────────────────────────
  it('renders Event C (TP1 Hit & SL Moved to Break-Even)', () => {
    const ev: AlertEvent = {
      type: 'TP_HIT',
      severity: 'success',
      data: {
        symbol: 'XAUUSD',
        direction: 'BUY',
        accountLabel: 'Demo Account',
        level: 1,
        price: 3255.0,
        profit: 72.5,
        newSl: 3240.8,
        entry: 3240.5,
        tp2: 3270.0,
        tp3: 3285.0,
        remaining: 2,
        groupId: 'grp-5678',
      },
    };
    const rendered = renderAlert(ev);
    expect(rendered.title).toContain('TP1 Hit & SL Moved to Break-Even');
    expect(rendered.text).toContain('EVENT C: TP1 HIT & SL TO BREAK-EVEN');
    expect(rendered.text).toContain('MUBARAK HO! TP1 TARGET HIT HO GAYA');
    expect(rendered.text).toContain('+$72.50');
    expect(rendered.text).toContain('STOP LOSS BREAK-EVEN');
    expect(rendered.text).toContain('100% RISK-FREE');
    expect(rendered.html).toContain('TP1 REACHED + SL TO BREAK-EVEN');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event D: Trade Closed (TP2/TP3 Hit or SL Hit)
  // ─────────────────────────────────────────────────────────────────────────
  it('renders Event D (Trade Closed with final P&L USD and updated Balance/Equity)', () => {
    const ev: AlertEvent = {
      type: 'TRADE_CLOSED',
      severity: 'success',
      data: {
        symbol: 'XAUUSD',
        direction: 'BUY',
        accountLabel: 'Live Account',
        accountType: 'LIVE',
        pnl: 245.5,
        reasons: 'TP1:TP, TP2:TP, TP3:TP',
        duration: '1h 24m',
        balance: 15245.5,
        equity: 15245.5,
        beMoved: true,
      },
    };
    const rendered = renderAlert(ev);
    expect(rendered.title).toContain('Trade Closed: XAUUSD BUY +$245.50');
    expect(rendered.text).toContain('EVENT D: TRADE COMPLETED & CLOSED');
    expect(rendered.text).toContain('TRADE MUKAMMAL BAND HO GAYI');
    expect(rendered.text).toContain('+$245.50 MUNAFA (Profit ✅)');
    expect(rendered.text).toContain('Updated Balance: $15245.50');
    expect(rendered.html).toContain('+$245.50');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event E: Safety Gate / Drawdown Warning
  // ─────────────────────────────────────────────────────────────────────────
  it('renders Event E (Safety Gate Block or Drawdown Warning/Limit)', () => {
    const evGate: AlertEvent = {
      type: 'GATES_BLOCKED',
      severity: 'warning',
      data: {
        symbol: 'XAUUSD',
        direction: 'SELL',
        failed: ['MARKET_EXPANSION: Chop Market Detected', 'MAX_SPREAD: Spread 1.10 > 0.80'],
      },
    };
    const renderedGate = renderAlert(evGate);
    expect(renderedGate.title).toContain('Trade Blocked by Safety Gates');
    expect(renderedGate.text).toContain('EVENT E: SAFETY GATE / DRAWDOWN ALERT');
    expect(renderedGate.text).toContain('TRADE BLOCK HO GAYI');
    expect(renderedGate.text).toContain('Chop Market Detected');

    const evDd: AlertEvent = {
      type: 'DRAWDOWN_LIMIT',
      severity: 'critical',
      data: {
        accountLabel: 'Live',
        accountType: 'LIVE',
        ddPct: 3.4,
        maxPct: 3.0,
        equity: 9660.0,
      },
    };
    const renderedDd = renderAlert(evDd);
    expect(renderedDd.title).toContain('Daily Drawdown LIMIT Hit');
    expect(renderedDd.text).toContain('DAILY DRAWDOWN LIMIT HIT');
    expect(renderedDd.text).toContain('3.40%');
    expect(renderedDd.text).toContain('Auto-trading ko foran band kar diya gaya hai');
  });
});
