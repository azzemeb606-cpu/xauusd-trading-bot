import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { AccountKey, GateResult, Severity, Signal, SignalStatus, TradeGroup } from '../types';

export interface StoredEvent {
  id: number;
  type: string;
  severity: Severity;
  title: string;
  message: string;
  data: Record<string, unknown>;
  at: number;
}

export interface StoredSignal {
  signal: Signal;
  status: SignalStatus;
  lastGates: GateResult[] | null;
  note: string | null;
  updatedAt: number;
}

export class Store {
  readonly db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'xau-bot.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL,
        last_gates TEXT, note TEXT, detected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_signals_detected ON signals(detected_at DESC);
      CREATE TABLE IF NOT EXISTS trade_groups (
        id TEXT PRIMARY KEY, signal_id TEXT NOT NULL, account TEXT NOT NULL, status TEXT NOT NULL,
        data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_groups_status ON trade_groups(status);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, severity TEXT NOT NULL,
        title TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, balance REAL, equity REAL,
        margin REAL, floating REAL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_snap ON snapshots(account, at);
      CREATE TABLE IF NOT EXISTS day_start (
        account TEXT NOT NULL, day TEXT NOT NULL, equity REAL NOT NULL, PRIMARY KEY (account, day));
    `);
  }

  // ---------- kv ----------
  getKv<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }
  setKv(key: string, value: unknown) {
    this.db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  // ---------- signals ----------
  getSignal(id: string): StoredSignal | null {
    const r = this.db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as any;
    return r ? this.mapSignal(r) : null;
  }
  insertSignal(s: Signal) {
    this.db
      .prepare('INSERT OR IGNORE INTO signals(id, data, status, detected_at, updated_at) VALUES(?, ?, ?, ?, ?)')
      .run(s.id, JSON.stringify(s), 'NEW', s.detectedAt, Date.now());
  }
  updateSignal(id: string, status: SignalStatus, gates?: GateResult[] | null, note?: string | null) {
    this.db
      .prepare('UPDATE signals SET status = ?, last_gates = COALESCE(?, last_gates), note = COALESCE(?, note), updated_at = ? WHERE id = ?')
      .run(status, gates ? JSON.stringify(gates) : null, note ?? null, Date.now(), id);
  }
  listSignals(limit = 50): StoredSignal[] {
    return (this.db.prepare('SELECT * FROM signals ORDER BY detected_at DESC LIMIT ?').all(limit) as any[]).map((r) => this.mapSignal(r));
  }
  private mapSignal(r: any): StoredSignal {
    return {
      signal: JSON.parse(r.data),
      status: r.status,
      lastGates: r.last_gates ? JSON.parse(r.last_gates) : null,
      note: r.note,
      updatedAt: r.updated_at,
    };
  }

  // ---------- trade groups ----------
  saveGroup(g: TradeGroup) {
    this.db
      .prepare(
        `INSERT INTO trade_groups(id, signal_id, account, status, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(g.id, g.signalId, g.account, g.status, JSON.stringify(g), g.createdAt, Date.now());
  }
  activeGroups(): TradeGroup[] {
    return (this.db.prepare("SELECT data FROM trade_groups WHERE status IN ('PENDING','OPEN') ORDER BY created_at").all() as any[]).map((r) =>
      JSON.parse(r.data),
    );
  }
  getGroup(id: string): TradeGroup | null {
    const r = this.db.prepare('SELECT data FROM trade_groups WHERE id = ?').get(id) as any;
    return r ? JSON.parse(r.data) : null;
  }
  listGroups(limit = 100, status?: string): TradeGroup[] {
    const rows = status
      ? this.db.prepare('SELECT data FROM trade_groups WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
      : this.db.prepare('SELECT data FROM trade_groups ORDER BY created_at DESC LIMIT ?').all(limit);
    return (rows as any[]).map((r) => JSON.parse(r.data));
  }

  // ---------- events ----------
  insertEvent(e: Omit<StoredEvent, 'id'>): StoredEvent {
    const info = this.db
      .prepare('INSERT INTO events(type, severity, title, message, data, at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(e.type, e.severity, e.title, e.message, JSON.stringify(e.data), e.at);
    return { ...e, id: Number(info.lastInsertRowid) };
  }
  listEvents(limit = 100): StoredEvent[] {
    return (this.db.prepare('SELECT * FROM events ORDER BY at DESC LIMIT ?').all(limit) as any[]).map((r) => ({
      ...r,
      data: JSON.parse(r.data),
    }));
  }

  // ---------- account snapshots ----------
  insertSnapshot(account: AccountKey, s: { balance: number; equity: number; margin: number; floating: number }) {
    this.db
      .prepare('INSERT INTO snapshots(account, balance, equity, margin, floating, at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(account, s.balance, s.equity, s.margin, s.floating, Date.now());
  }
  equityCurve(account: AccountKey, sinceMs: number) {
    return this.db
      .prepare('SELECT balance, equity, floating, at FROM snapshots WHERE account = ? AND at >= ? ORDER BY at')
      .all(account, sinceMs) as Array<{ balance: number; equity: number; floating: number; at: number }>;
  }
  pruneSnapshots(olderThanMs: number) {
    this.db.prepare('DELETE FROM snapshots WHERE at < ?').run(olderThanMs);
    this.db.prepare('DELETE FROM events WHERE at < ?').run(olderThanMs);
  }
  getDayStart(account: AccountKey, day: string): number | null {
    const r = this.db.prepare('SELECT equity FROM day_start WHERE account = ? AND day = ?').get(account, day) as { equity: number } | undefined;
    return r ? r.equity : null;
  }
  setDayStart(account: AccountKey, day: string, equity: number) {
    this.db.prepare('INSERT OR IGNORE INTO day_start(account, day, equity) VALUES(?, ?, ?)').run(account, day, equity);
  }

  close() {
    this.db.close();
  }
}
