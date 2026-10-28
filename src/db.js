// mhd-manager · Schema v2: Produkte (Stamm) + Chargen
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 2;

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      category      TEXT    NOT NULL DEFAULT '',
      unit          TEXT    NOT NULL DEFAULT 'kg',
      location      TEXT    NOT NULL DEFAULT '',
      warn_days     INTEGER,
      freeze_days   INTEGER,
      notes         TEXT    NOT NULL DEFAULT '',
      archived      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS batches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity      REAL    NOT NULL DEFAULT 0,
      best_before   TEXT    NOT NULL,
      frozen_on     TEXT,
      note          TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
    CREATE INDEX IF NOT EXISTS idx_batches_mhd ON batches(best_before);
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id    INTEGER,
      product_id  INTEGER,
      type        TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '',
      at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrate(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** Altbestand (flache products-Tabelle v1) verlustfrei nach v2 überführen. */
function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  const isV1 = cols.includes('best_before') && !cols.includes('warn_days');
  if (!isV1) return; // frische DB, nichts zu tun

  const legacy = db.prepare('SELECT * FROM products').all();
  const insertProduct = db.prepare(`INSERT INTO products
    (name, category, unit, location, notes) VALUES (?, ?, ?, ?, ?)`);

  // Reihenfolge ist kritisch:
  // ALTER TABLE ... RENAME schreibt Fremdschlüssel anderer Tabellen mit um.
  // Wird `products` zu `products_old` umbenannt, während `batches` schon
  // existiert, zeigt danach `batches.product_id REFERENCES products_old` —
  // und jedes INSERT scheitert nach dem DROP mit "no such table".
  // Deshalb: batches erst NACH der Umbenennung anlegen.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec('DROP TABLE IF EXISTS products_old');
    db.exec('ALTER TABLE products RENAME TO products_old');
    db.exec('DROP TABLE IF EXISTS batches');
    db.exec(`
      CREATE TABLE products (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        category      TEXT    NOT NULL DEFAULT '',
        unit          TEXT    NOT NULL DEFAULT 'kg',
        location      TEXT    NOT NULL DEFAULT '',
        warn_days     INTEGER,
        freeze_days   INTEGER,
        notes         TEXT    NOT NULL DEFAULT '',
        archived      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE batches (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity      REAL    NOT NULL DEFAULT 0,
        best_before   TEXT    NOT NULL,
        frozen_on     TEXT,
        note          TEXT    NOT NULL DEFAULT '',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
      CREATE INDEX IF NOT EXISTS idx_batches_mhd ON batches(best_before);
    `);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const insertBatch = db.prepare(`INSERT INTO batches
    (product_id, quantity, best_before, note) VALUES (?, ?, ?, ?)`);

  for (const row of legacy) {
    const p = insertProduct.run(
      row.name, row.category || '', row.unit || 'kg', row.location || '', row.notes || ''
    );
    insertBatch.run(
      Number(p.lastInsertRowid),
      Number(row.quantity) || 0,
      row.best_before,
      row.opened_on ? `angebrochen: ${row.opened_on}` : ''
    );
  }

  try {
    db.exec('DROP TABLE products_old');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  console.log(`[mhd] Migration v1→v2: ${legacy.length} Produkt(e) übernommen.`);
}
