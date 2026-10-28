// mhd-manager · Datenbank-Schema + Zugriffslogik (node:sqlite, keine nativen Builds)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      category      TEXT    NOT NULL DEFAULT '',
      location      TEXT    NOT NULL DEFAULT '',
      quantity      REAL    NOT NULL DEFAULT 1,
      unit          TEXT    NOT NULL DEFAULT 'Stk',
      best_before   TEXT    NOT NULL,
      opened_on     TEXT,
      notes         TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_best_before ON products(best_before);
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}
