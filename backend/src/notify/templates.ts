import { env } from '../config/env';
import type { AlertEvent, AlertType } from '../types';

export interface TelegramButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface RenderedAlert {
  title: string;
  text: string;
  html: string;
  waShareUrl: string;
  telegramButtons?: TelegramButton[][];
}

const n = (v: unknown, d = 2) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toFixed(d)
    : v === undefined || v === null
      ? '-'
      : String(v);

const money = (v: unknown) =>
  typeof v === 'number' ? `${v >= 0 ? '+' : ''}$${v.toFixed(2)}` : '-';

const acct = (d: Record<string, unknown>) =>
  d.accountLabel ? ` [${String(d.accountLabel).toUpperCase()}]` : '';

const ICON: Record<AlertType, string> = {
  SYSTEM_STARTED: '🟢',
  SETUP_FORMED: '🚨',
  GATES_BLOCKED: '⛔',
  ORDER_PLACED: '📝',
  TRADE_OPENED: '✅',
  TP_HIT: '🎯',
  BE_MOVED: '🛡️',
  SL_TRAILED: '🔒',
  TRADE_CLOSED: '🏁',
  ORDER_CANCELLED: '🚫',
  TRADE_FAILED: '❌',
  DRAWDOWN_WARNING: '⚠️',
  DRAWDOWN_LIMIT: '🛑',
  FEED_DOWN: '📡',
  FEED_RESTORED: '📶',
  ACCOUNT_DISCONNECTED: '🔌',
  ACCOUNT_RECONNECTED: '🔗',
  KILL_SWITCH: '🛑',
  TEST: '🧪',
};

function formatLevelsText(d: Record<string, unknown>) {
  return `Entry: ${n(d.entry ?? d.openPrice)} | SL: ${n(d.sl ?? d.currentSl)}\nTP1: ${n(d.tp1)} | TP2: ${n(d.tp2)} | TP3: ${n(d.tp3)}`;
}

export function renderAlert(e: AlertEvent): RenderedAlert {
  const d = e.data;
  const sym = (d.symbol as string) ?? 'XAUUSD';
  const dir = (d.direction as string) ?? '';
  const acctType = (d.accountType as string) ?? (d.accountLabel as string) ?? 'DEMO';
  const groupId = (d.groupId as string) ?? (d.id as string) ?? '';
  const dashboardUrl = env.DASHBOARD_URL || 'http://localhost:8080';

  let eventTag = 'XAUUSD ALERT';
  let title = '';
  let en = '';
  let ur = '';
  let badgeColor = '#F59E0B'; // Gold default
  let tableRows: Array<{ label: string; value: string; color?: string }> = [];
  let telegramButtons: TelegramButton[][] | undefined;

  switch (e.type) {
    // ─────────────────────────────────────────────────────────────────────────
    // Event A: Signal Detected / Pending Setup Ready
    // ─────────────────────────────────────────────────────────────────────────
    case 'SETUP_FORMED':
      eventTag = 'EVENT A: SIGNAL DETECTED';
      badgeColor = dir === 'BUY' ? '#10B981' : '#EF4444';
      title = `Signal Detected: ${sym} ${dir}`;
      en =
        `New Bond 007 swing setup detected on ${sym}.\n` +
        `Action: ${dir} | Zone: ${n(d.entryZoneLow)} - ${n(d.entryZoneHigh)} | Anchor: ${n(d.anchorPrice)}\n` +
        `Target Levels:\n${formatLevelsText(d)}\n` +
        `Fusion Confidence: ${n(d.fusionConf, 1)}% (${d.alignedBrains ?? 7}/9 brains) | Whale: ${d.whaleFlow ?? 'NEUTRAL'} | Session: ${d.session ?? 'LONDON'}\n` +
        `R:R Ratio: 1:${n(d.rr, 2)} | Suggested Kind: ${d.hintedKind ?? 'MARKET'}`;
      ur =
        `🚨 *SIGNAL DETECT HO GAYA HAI*: Gold (${sym}) mein naya ${dir === 'BUY' ? 'BUY (KHAREEDNA)' : 'SELL (BECHNA)'} setup ban chuka hai.\n` +
        `Entry Zone: ${n(d.entryZoneLow)} se ${n(d.entryZoneHigh)} | Stop Loss: ${n(d.sl)}\n` +
        `Targets: TP1: ${n(d.tp1)} | TP2: ${n(d.tp2)} | TP3: ${n(d.tp3)}\n` +
        `Confidence: ${n(d.fusionConf, 1)}% — Multi-gate verification pass hote hi auto-trade trigger ho jayegi.`;

      tableRows = [
        { label: 'Signal Type', value: `${dir} SETUP`, color: dir === 'BUY' ? '#10B981' : '#EF4444' },
        { label: 'Entry Zone', value: `${n(d.entryZoneLow)} – ${n(d.entryZoneHigh)}` },
        { label: 'Anchor Price', value: `$${n(d.anchorPrice)}` },
        { label: 'Stop Loss (SL)', value: `$${n(d.sl)}`, color: '#EF4444' },
        { label: 'TP1 / TP2 / TP3', value: `$${n(d.tp1)} / $${n(d.tp2)} / $${n(d.tp3)}`, color: '#10B981' },
        { label: 'Risk-to-Reward', value: `1:${n(d.rr, 2)}` },
        { label: 'Fusion Confidence', value: `${n(d.fusionConf, 1)}% (${d.alignedBrains ?? '—'}/9 Engines)` },
        { label: 'Institutional Flow', value: `${d.whaleFlow ?? 'NEUTRAL'} (${d.session ?? 'ACTIVE'})` },
      ];

      telegramButtons = [
        [
          { text: '📊 Open Web Dashboard', url: dashboardUrl },
          { text: '⏸️ Pause Bot', callback_data: 'action:pause' },
        ],
      ];
      break;

    // ─────────────────────────────────────────────────────────────────────────
    // Event B: Auto-Trade Executed (Buy/Sell Opened)
    // ─────────────────────────────────────────────────────────────────────────
    case 'TRADE_OPENED':
    case 'ORDER_PLACED': {
      const isMarket = e.type === 'TRADE_OPENED';
      eventTag = 'EVENT B: AUTO-TRADE EXECUTED';
      badgeColor = dir === 'BUY' ? '#10B981' : '#3B82F6';
      title = `${isMarket ? 'Auto-Trade Executed' : 'Pending Order Placed'}: ${sym} ${dir}${acct(d)}`;
      const ticket = d.orderTicket ?? d.orderId ?? d.positionId ?? 'AUTO';
      const riskVal = d.riskUsd !== undefined ? `$${n(d.riskUsd)}` : '-';

      en =
        `Auto-Trade executed successfully on [${acctType}] account.\n` +
        `Order Ticket: #${ticket}\n` +
        `Action: ${dir} | Lots: ${n(d.volume)} lot(s) in ${d.legs ?? 3} micro-orders\n` +
        `Entry Price: $${n(d.openPrice ?? d.entry)}\n` +
        `Stop Loss: $${n(d.sl)}\n` +
        `Targets: TP1: $${n(d.tp1)} | TP2: $${n(d.tp2)} | TP3: $${n(d.tp3)}\n` +
        `Risk Allocation: ${riskVal} (${n(d.riskPercent ?? 1.0)}% of equity)\n` +
        `Account Balance: $${n(d.balance)}`;
      ur =
        `✅ *AUTO-TRADE KHUL GAYI HAI*: [${acctType}] Account par Gold (${sym}) ka ${dir} order kamyabi se lag gaya hai.\n` +
        `Ticket: #${ticket} | Volume: ${n(d.volume)} lots\n` +
        `Entry Price: $${n(d.openPrice ?? d.entry)} | Stop Loss: $${n(d.sl)}\n` +
        `Take Profits: TP1: $${n(d.tp1)} | TP2: $${n(d.tp2)} | TP3: $${n(d.tp3)}\n` +
        `Risk: ${riskVal} (${n(d.riskPercent ?? 1.0)}%). TP1 hit hote hi SL Break-Even par shift ho jayega.`;

      tableRows = [
        { label: 'Account', value: acctType, color: acctType.includes('LIVE') ? '#EF4444' : '#3B82F6' },
        { label: 'Order Ticket', value: `#${ticket}` },
        { label: 'Action', value: `${dir} (${isMarket ? 'MARKET' : 'LIMIT'})`, color: dir === 'BUY' ? '#10B981' : '#EF4444' },
        { label: 'Lot Size', value: `${n(d.volume)} Lots (${d.legs ?? 3} legs)` },
        { label: 'Entry Price', value: `$${n(d.openPrice ?? d.entry)}` },
        { label: 'Stop Loss', value: `$${n(d.sl)}`, color: '#EF4444' },
        { label: 'TP1 / TP2 / TP3', value: `$${n(d.tp1)} / $${n(d.tp2)} / $${n(d.tp3)}`, color: '#10B981' },
        { label: 'Risk Amount', value: `${riskVal} (${n(d.riskPercent ?? 1.0)}%)`, color: '#F59E0B' },
        { label: 'Current Balance', value: `$${n(d.balance)}` },
      ];

      telegramButtons = [
        [
          { text: '🛡️ Move SL to BE', callback_data: `action:be:${groupId}` },
          { text: '❌ Close Trade', callback_data: `action:close:${groupId}` },
        ],
        [
          { text: '📊 Dashboard', url: dashboardUrl },
          { text: '⏸️ Pause Bot', callback_data: 'action:pause' },
        ],
      ];
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event C: TP1 Hit & SL Moved to Break-Even
    // ─────────────────────────────────────────────────────────────────────────
    case 'TP_HIT':
    case 'BE_MOVED': {
      eventTag = 'EVENT C: TP1 HIT & SL TO BREAK-EVEN';
      badgeColor = '#10B981';
      const profitStr = money(d.profit);
      title = `TP1 Hit & SL Moved to Break-Even: ${sym} ${dir}${acct(d)}`;

      en =
        `Target 1 reached at $${n(d.price ?? d.newSl)}!\n` +
        `Partial Profit Secured: ${profitStr}\n` +
        `Stop Loss Protection: Moved to Break-Even at $${n(d.newSl ?? d.entry)}.\n` +
        `Remaining Legs: ${d.remaining ?? 2} leg(s) running 100% risk-free towards TP2 ($${n(d.tp2)}) & TP3 ($${n(d.tp3)})!`;
      ur =
        `🎯 *MUBARAK HO! TP1 TARGET HIT HO GAYA*: Gold ${dir} ka pehla target $${n(d.price ?? d.newSl)} par hit ho gaya hai.\n` +
        `Munafa: ${profitStr} account mein jama ho gaya.\n` +
        `🛡️ *STOP LOSS BREAK-EVEN*: Stop Loss ko entry price ($${n(d.newSl ?? d.entry)}) par shift kar diya gaya hai.\n` +
        `Ab yeh trade mukammal RISK-FREE hai! Baqi hissay TP2 aur TP3 ke liye chal rahe hain.`;

      tableRows = [
        { label: 'Milestone', value: 'TP1 REACHED + SL TO BREAK-EVEN', color: '#10B981' },
        { label: 'Account', value: acctType },
        { label: 'Hit Price', value: `$${n(d.price ?? d.newSl)}` },
        { label: 'Secured Profit', value: profitStr, color: '#10B981' },
        { label: 'New Protected SL', value: `$${n(d.newSl ?? d.entry)} (Break-Even)`, color: '#3B82F6' },
        { label: 'Remaining Targets', value: `TP2: $${n(d.tp2)} | TP3: $${n(d.tp3)}` },
        { label: 'Risk Status', value: '100% RISK-FREE (Protected)', color: '#10B981' },
      ];

      telegramButtons = [
        [
          { text: '❌ Close Remaining Legs', callback_data: `action:close:${groupId}` },
          { text: '📊 Dashboard', url: dashboardUrl },
        ],
      ];
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event D: Trade Closed (TP2/TP3 Hit or SL Hit)
    // ─────────────────────────────────────────────────────────────────────────
    case 'TRADE_CLOSED': {
      eventTag = 'EVENT D: TRADE COMPLETED & CLOSED';
      const pnlNum = typeof d.pnl === 'number' ? d.pnl : 0;
      const isWin = pnlNum >= 0;
      badgeColor = isWin ? '#10B981' : '#EF4444';
      title = `Trade Closed: ${sym} ${dir} ${money(pnlNum)}${acct(d)}`;

      en =
        `All legs of ${sym} ${dir} trade are closed.\n` +
        `Net Realized P&L: ${money(pnlNum)} ${isWin ? '✅ (PROFIT)' : '❌ (LOSS)'}\n` +
        `Exit Reasons: ${d.reasons ?? 'TP/SL Hit'}\n` +
        `Trade Duration: ${d.duration ?? '-'}\n` +
        `Updated Account Balance: $${n(d.balance)} | Equity: $${n(d.equity ?? d.balance)}`;
      ur =
        `🏁 *TRADE MUKAMMAL BAND HO GAYI*: Gold ${dir} trade close ho gayi hai.\n` +
        `Kul Nateeja: ${money(pnlNum)} ${isWin ? 'MUNAFA (Profit ✅)' : 'NUQSAN (Loss ❌)'}\n` +
        `Wajah: ${d.reasons ?? 'Target/SL hit'}\n` +
        `Updated Balance: $${n(d.balance)} | Equity: $${n(d.equity ?? d.balance)}\n` +
        `Trade ka waqt: ${d.duration ?? '-'}`;

      tableRows = [
        { label: 'Final Net P&L', value: money(pnlNum), color: isWin ? '#10B981' : '#EF4444' },
        { label: 'Account', value: acctType },
        { label: 'Exit Reasons', value: String(d.reasons ?? 'Completed') },
        { label: 'Trade Duration', value: String(d.duration ?? '-') },
        { label: 'Updated Balance', value: `$${n(d.balance)}` },
        { label: 'Current Equity', value: `$${n(d.equity ?? d.balance)}` },
        { label: 'Break-Even Triggered', value: d.beMoved ? 'YES' : 'NO' },
      ];

      telegramButtons = [
        [
          { text: '📊 Open Web Dashboard', url: dashboardUrl },
        ],
      ];
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event E: Safety Gate / Drawdown Warning
    // ─────────────────────────────────────────────────────────────────────────
    case 'GATES_BLOCKED':
    case 'DRAWDOWN_WARNING':
    case 'DRAWDOWN_LIMIT':
    case 'KILL_SWITCH': {
      eventTag = 'EVENT E: SAFETY GATE / DRAWDOWN ALERT';
      badgeColor = '#EF4444';
      const isLimit = e.type === 'DRAWDOWN_LIMIT';
      const isKill = e.type === 'KILL_SWITCH';

      if (e.type === 'GATES_BLOCKED') {
        title = `Trade Blocked by Safety Gates: ${sym} ${dir}`;
        const failedList = (d.failed as string[] | undefined)?.map((f) => `• ${f}`).join('\n') ?? 'Safety criteria unfulfilled';
        en = `Automated trade blocked. Pre-execution safety gate checks failed:\n${failedList}`;
        ur = `⛔ *TRADE BLOCK HO GAYI*: Gold ${dir} trade ko safety gates ne rok diya hai taake capital mehfooz rahe.\nKhatray ke asbaab:\n${failedList}`;
        tableRows = [
          { label: 'Status', value: 'TRADE BLOCKED (Safety)', color: '#EF4444' },
          { label: 'Blocked Reason', value: String(d.failed?.[0] ?? 'Gates Fail') },
          { label: 'Action Taken', value: 'No order sent to broker' },
        ];
      } else if (isKill) {
        title = `Kill Switch ${d.enabled ? 'ACTIVATED' : 'RELEASED'}`;
        en = d.enabled ? 'Emergency Kill-Switch engaged: All new trading is immediately halted.' : 'Kill-Switch released: Normal operations restored.';
        ur = d.enabled ? '🛑 *KILL-SWITCH ON HO GAYA*: Saari nayi trading foran rok di gayi hai.' : '✅ *KILL-SWITCH OFF*: Normal trading dobara shuru ho sakti hai.';
        tableRows = [
          { label: 'Kill-Switch State', value: d.enabled ? 'HALTED (Active)' : 'RELEASED', color: d.enabled ? '#EF4444' : '#10B981' },
          { label: 'Action Taken', value: d.enabled ? 'New trades suspended' : 'Ready' },
        ];
      } else {
        title = `${isLimit ? 'Daily Drawdown LIMIT Hit' : 'Drawdown Warning'}${acct(d)}`;
        en =
          `Daily Drawdown reached ${n(d.ddPct)}% (Threshold: ${n(isLimit ? d.maxPct : d.warnPct)}%).\n` +
          `Account Equity: $${n(d.equity)}\n` +
          `${isLimit ? '🛑 KILL-SWITCH ACTIVATED: Auto-trading paused for the rest of today.' : '⚠️ Caution advised.'}`;
        ur =
          `${isLimit ? '🛑 *DAILY DRAWDOWN LIMIT HIT*' : '⚠️ *DRAWDOWN WARNING*'}: Aaj ka nuqsan ${n(d.ddPct)}% par pohnch gaya hai (Hadd: ${n(isLimit ? d.maxPct : d.warnPct)}%).\n` +
          `${isLimit ? 'Auto-trading ko foran band kar diya gaya hai taake mazeed nuqsan na ho.' : 'Drawdown warning hadd par hai. Ehtiyat karein.'}`;
        tableRows = [
          { label: 'Current Drawdown', value: `${n(d.ddPct)}%`, color: '#EF4444' },
          { label: 'Configured Limit', value: `${n(isLimit ? d.maxPct : d.warnPct)}%` },
          { label: 'Account', value: acctType },
          { label: 'Action Taken', value: isLimit ? 'Auto-Trading PAUSED' : 'Warning Notified', color: isLimit ? '#EF4444' : '#F59E0B' },
        ];
      }

      telegramButtons = [
        [
          { text: '📊 Open Web Dashboard', url: dashboardUrl },
          { text: '🛑 Toggle Kill-Switch', callback_data: 'action:pause' },
        ],
      ];
      break;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Other System Events
    // ─────────────────────────────────────────────────────────────────────────
    case 'SYSTEM_STARTED':
      title = 'Gold Trading Bot Online';
      en = `System online. Mode: ${d.mode} | Auto-Trading: ${d.autoTrading ? 'ENABLED' : 'DISABLED'} | Engine: ${d.engine}`;
      ur = `XAUUSD Bot chal pada hai. Mode: ${d.mode}. Auto-trading: ${d.autoTrading ? 'ON' : 'OFF (Sirf Monitoring)'}.`;
      break;

    case 'TEST':
      title = 'Test Notification (All Channels)';
      en = 'If you received this message, WhatsApp, Telegram, and Email dispatchers are fully active and verified!';
      ur = 'Yeh test notification hai. Agar aapko yeh mila hai to WhatsApp, Telegram aur Email channels bilkul theek chal rahe hain!';
      break;

    default:
      title = `${sym} Event: ${e.type}${acct(d)}`;
      en = JSON.stringify(d, null, 2);
      ur = `System notification: ${e.type}`;
      break;
  }

  const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // ── 1. Plain Text (WhatsApp & Telegram formatted) ─────────────────────────
  const text =
    `${ICON[e.type]} *${title.toUpperCase()}*\n` +
    `_${eventTag}_\n\n` +
    `🇵🇰 *Roman Urdu:*\n${ur}\n\n` +
    `🇬🇧 *English Details:*\n${en}\n\n` +
    `🕒 Time: ${time}\n` +
    `🌐 Dashboard: ${dashboardUrl}`;

  // ── 2. WhatsApp 1-Click Share URL ─────────────────────────────────────────
  const waShareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  // ── 3. Rich HTML Email (Gold & Dark Luxury Trading Theme) ──────────────────
  const rowsHtml = tableRows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #1E293B;color:#94A3B8;font-size:13px;">${r.label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1E293B;color:${r.color ?? '#F8FAFC'};font-size:13px;font-weight:700;text-align:right;">${r.value}</td>
      </tr>`,
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0B0E14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#E2E8F0;">
  <div style="max-width:600px;margin:20px auto;background:#111827;border:1px solid #374151;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
    
    <!-- Header banner -->
    <div style="background:linear-gradient(135deg, #1E1B4B 0%, #0F172A 100%);padding:20px 24px;border-bottom:2px solid #F59E0B;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#F59E0B;text-transform:uppercase;">BOND 007 SWING RADAR</div>
        <div style="font-size:18px;font-weight:800;color:#F8FAFC;margin-top:4px;">${title}</div>
      </div>
      <div style="background:${badgeColor};color:#000;font-size:11px;font-weight:900;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px;">
        ${eventTag.split(':')[0]}
      </div>
    </div>

    <!-- Roman Urdu Commentary Card -->
    <div style="padding:16px 24px;background:rgba(245,158,11,0.06);border-bottom:1px solid rgba(245,158,11,0.2);">
      <div style="font-size:12px;font-weight:700;color:#F59E0B;margin-bottom:6px;display:flex;align-items:center;">
        🇵🇰 ROMAN URDU WAJAHAT & GUIDANCE
      </div>
      <div style="font-size:13.5px;line-height:1.6;color:#F1F5F9;white-space:pre-wrap;">${ur}</div>
    </div>

    <!-- Data Details Table -->
    ${
      tableRows.length > 0
        ? `
    <div style="padding:16px 24px;">
      <div style="font-size:12px;font-weight:700;color:#94A3B8;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">EXECUTION & TELEMETRY DATA</div>
      <table style="width:100%;border-collapse:collapse;background:#0F172A;border-radius:8px;overflow:hidden;">
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>`
        : ''
    }

    <!-- English Details -->
    <div style="padding:12px 24px 20px;font-size:13px;line-height:1.5;color:#94A3B8;white-space:pre-wrap;">
      <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">ENGLISH DISPATCH</div>
      ${en}
    </div>

    <!-- Action Buttons -->
    <div style="padding:16px 24px;background:#0F172A;border-top:1px solid #1E293B;text-align:center;">
      <a href="${waShareUrl}" style="display:inline-block;padding:10px 18px;background:#25D366;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:13px;border-radius:6px;margin-right:10px;">
        📱 Share on WhatsApp
      </a>
      <a href="${dashboardUrl}" style="display:inline-block;padding:10px 18px;background:#F59E0B;color:#000000;text-decoration:none;font-weight:800;font-size:13px;border-radius:6px;">
        📊 Open Web Dashboard
      </a>
    </div>

    <!-- Footer -->
    <div style="padding:12px 24px;background:#080B10;font-size:11px;color:#475569;text-align:center;">
      XAUUSD 24/7 Automated Trading Engine • Dispatched at ${time}
    </div>
  </div>
</body>
</html>
  `.trim();

  return {
    title: `${ICON[e.type]} ${title}`,
    text,
    html,
    waShareUrl,
    telegramButtons,
  };
}
