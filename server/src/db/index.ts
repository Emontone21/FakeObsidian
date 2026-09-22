import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDataDir, type Config } from '../config.js';

export type Db = Database.Database;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Abre la base en modo WAL: el proceso MCP por stdio y el servidor web
 * escriben sobre el mismo archivo al mismo tiempo.
 */
export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATION_FILE = /^(\d+)[_-](.+)\.sql$/;

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match) return null;
      return {
        version: Number(match[1]),
        name: match[2]!,
        sql: readFileSync(path.join(dir, file), 'utf8')
      } satisfies Migration;
    })
    .filter((m): m is Migration => m !== null)
    .sort((a, b) => a.version - b.version);
}

function appliedVersions(db: Db): Set<number> {
  const exists = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { c: number };
  if (exists.c === 0) return new Set();
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

/** Aplica las migraciones pendientes en orden. Devuelve las versiones aplicadas. */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): number[] {
  const applied = appliedVersions(db);
  const pending = loadMigrations(dir).filter((m) => !applied.has(m.version));
  const done: number[] = [];

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    });
    try {
      apply();
    } catch (error) {
      throw new Error(
        `Fallo la migracion ${migration.version}_${migration.name}: ${(error as Error).message}`
      );
    }
    done.push(migration.version);
  }

  return done;
}

/** Crea las carpetas de la taxonomia inicial que todavia no existan. */
export function ensureDefaultFolders(db: Db, folders: readonly string[], now: string): void {
  const insert = db.prepare(
    'INSERT INTO folders (name, position, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING'
  );
  db.transaction(() => {
    folders.forEach((name, index) => insert.run(name, index, now));
  })();
}

export interface InitResult {
  db: Db;
  applied: number[];
}

/** Abre la base, corre migraciones y asegura la taxonomia inicial. */
export function initDatabase(config: Config, now: string): InitResult {
  ensureDataDir(config);
  const db = openDatabase(config.dbPath);
  const applied = migrate(db);
  ensureDefaultFolders(db, config.defaultFolders, now);
  return { db, applied };
}
