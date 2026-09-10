import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema.js';

export type Row = Record<string, unknown>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const applied = new Set(
      (this.raw.prepare('SELECT version FROM _migrations').all() as Row[]).map((r) => Number(r['version'])),
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(migration.sql);
        this.raw
          .prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
        this.raw.exec('COMMIT');
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${String(err)}`);
      }
    }
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): void {
    this.raw.prepare(sql).run(...(params as never[]));
  }

  /** Runs fn inside a transaction, rolling back on any throw. */
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export const id = (): string => randomUUID();
export const now = (): string => new Date().toISOString();
export const today = (): string => new Date().toISOString().slice(0, 10);

/** SQLite has no boolean. Everything crossing the boundary goes through these. */
export const toInt = (b: boolean): number => (b ? 1 : 0);
export const toBool = (n: unknown): boolean => Number(n) === 1;

export const jsonIn = (v: unknown): string => JSON.stringify(v ?? null);
export function jsonOut<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    const parsed = JSON.parse(v);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function audit(
  db: Db,
  userId: string | null,
  entity: string,
  entityId: string,
  action: string,
  detail: unknown = {},
): void {
  db.run(
    'INSERT INTO audit_log (id, user_id, entity, entity_id, action, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    id(),
    userId,
    entity,
    entityId,
    action,
    jsonIn(detail),
    now(),
  );
}

/** Sequential, human-readable references. UKN-D-0007 reads better than a UUID on a phone call. */
export function nextReference(db: Db, table: 'deals' | 'orders', prefix: string): string {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table}`,
  );
  const n = (row?.n ?? 0) + 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
