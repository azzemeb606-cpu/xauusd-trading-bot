import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration. Everything is validated at boot so the process
 * fails fast (and loudly) instead of trading with a half-broken config.
 *
 * Price-distance settings (spread, SL distance, deviation, BE buffer) are in
 * PRICE UNITS of XAUUSD (i.e. US dollars per ounce): 1.00 = $1 move in gold.
 */

// Treat empty strings as "not set" so `.default()` applies.
const rawEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && v.trim() !== '') rawEnv[k] = v.trim();
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const num = (def: number) => z.coerce.number().default(def);
const list = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: num(8080),
  LOG_LEVEL: z.string().default('info'),
  DATA_DIR: z.string().default('./data'),
  WEB_DIST_DIR: z.string().default('../web/dist'),
  CORS_ORIGIN: z.string().default('*'),
  ADMIN_TOKEN: z.string().default('xauusd-secure-admin-token-2026'),
  DAY_RESET_TZ: z.string().default('UTC'),

  // ---- Scraper ----
  RADAR_URL: z.string().url().default('https://xauusdlivechart.com/007'),
  MAIN_URL: z.string().url().default('https://xauusdlivechart.com/'),
  SOURCES_CONFIG: z.string().optional(),
  POLL_MIN_MS: num(3000),
  POLL_MAX_MS: num(5000),
  PAGE_RELOAD_MINUTES: num(15),
  FEED_STALE_SECONDS: num(60),
  SCRAPER_HEADLESS: bool(true),
  PRICE_MIN: num(1000),
  PRICE_MAX: num(10000),

  // ---- Execution ----
  EXECUTION_ENGINE: z.enum(['paper', 'metaapi', 'local_mt5']).default('paper'),
  LOCAL_MT5_URL: z.string().default('http://127.0.0.1:8000'),
  TP_EXECUTION_STYLE: z.enum(['SPLIT_ORDERS', 'SINGLE_ORDER_PARTIAL']).default('SPLIT_ORDERS'),
  TRADING_MODE: z.enum(['DEMO_ONLY', 'LIVE_ONLY', 'DUAL_MIRROR']).default('DEMO_ONLY'),
  AUTO_TRADING: bool(false),
  LIVE_TRADING_ENABLED: bool(false),
  LIVE_TRADING_CONFIRM: z.string().optional(),
  METAAPI_TOKEN: z.string().optional(),
  METAAPI_DOMAIN: z.string().optional(),
  DEMO_ACCOUNT_ID: z.string().optional(),
  LIVE_ACCOUNT_ID: z.string().optional(),
  DEMO_SYMBOL: z.string().default('XAUUSD'),
  LIVE_SYMBOL: z.string().default('XAUUSD'),
  MAGIC: num(7007),
  ACCOUNT_POLL_MS: num(5000),
  TRADE_MONITOR_MS: num(3000),
  PAPER_START_BALANCE: num(10000),
  PAPER_SPREAD: num(0.3),

  // ---- Risk & gate defaults (editable at runtime from the dashboard) ----
  RISK_PERCENT: num(1),
  FIXED_LOT: num(0),
  MAX_LOT: num(1),
  TP_SPLIT: list('50,30,20'),
  MIN_RR: num(1.5),
  MIN_SL_DISTANCE: num(2),
  MAX_SL_DISTANCE: num(30),
  MAX_SPREAD: num(0.8),
  MAX_ENTRY_DEVIATION: num(2),
  SIGNAL_MAX_AGE_SECONDS: num(600),
  CONFLUENCE_MODE: z.enum(['STRICT', 'NO_CONFLICT', 'OFF']).default('NO_CONFLICT'),
  SESSION_WINDOWS: z.string().default('00:00-23:59'),
  BLACKOUT_WINDOWS: z.string().default(''),
  MAX_OPEN_GROUPS: num(1),
  MAX_DAILY_DRAWDOWN_PCT: num(5),
  DAILY_DD_WARN_PCT: num(3),
  COOLDOWN_AFTER_LOSS_MIN: num(30),
  MIN_MARGIN_LEVEL: num(300),
  ORDER_TYPE_PREFERENCE: z.enum(['AUTO', 'MARKET', 'LIMIT']).default('AUTO'),
  PENDING_EXPIRY_MINUTES: num(60),
  BE_BUFFER: num(0.3),
  MOVE_BE_ON_TP1: bool(true),
  TRAIL_TO_TP1_ON_TP2: bool(true),
  NOTIFY_GATE_BLOCKS: bool(false),
  MIN_FUSION_CONFIDENCE: num(65),
  MIN_BRAINS_AGREEMENT: num(5),
  MAX_LIMIT_PROXIMITY: num(15),
  ALLOW_PENDING_ORDERS: bool(true),
  NEWS_BLACKOUT_MIN: num(15),

  // ---- Notifications ----
  DASHBOARD_URL: z.string().default('http://localhost:8080'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_IDS: list(''),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: num(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_TO: list('irfan7242@gmail.com'),
  WHATSAPP_PROVIDER: z.enum(['none', 'twilio', 'meta', 'callmebot', 'ultramsg']).default('callmebot'),
  WHATSAPP_TO: list(''),
  WHATSAPP_DEFAULT_PHONE: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  META_WA_TOKEN: z.string().optional(),
  META_WA_PHONE_NUMBER_ID: z.string().optional(),
  CALLMEBOT_RECIPIENTS: list(''),
  ULTRAMSG_INSTANCE_ID: z.string().optional(),
  ULTRAMSG_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(rawEnv);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;

/** Live trading requires BOTH an explicit flag and a typed confirmation phrase. */
export const LIVE_CONFIRM_PHRASE = 'I_UNDERSTAND_THE_RISK';
export const liveTradingAllowed = env.LIVE_TRADING_ENABLED && env.LIVE_TRADING_CONFIRM === LIVE_CONFIRM_PHRASE;

if (env.EXECUTION_ENGINE === 'metaapi' && !env.METAAPI_TOKEN) {
  console.error('❌ EXECUTION_ENGINE=metaapi requires METAAPI_TOKEN');
  process.exit(1);
}

export type Env = typeof env;
