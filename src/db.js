// mhd-manager · Schema v3: Produkte mit Frisch-MHD-Regeln, TK-Haltbarkeit,
// Verkaufstempo, Kategorien-Tabelle und Benutzerkonten.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 3;

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  const version = db.prepare('PRAGMA user_version').get().user_version ?? 0;

  if (version < 2) migrateV1toV2(db);
  createV3(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** Stellt sicher, dass das v3-Schema existiert (auf jeder DB, idempotent). */
function createV3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      active   INTEGER NOT NULL DEFAULT 1,
      sort     INTEGER NOT NULL DEFAULT 100,
      created_at TEXT  NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'user',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login    TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // v2 → v3: Produkt um TK-Haltbarkeit und Verkaufstempo erweitern
  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE products ADD COLUMN ${name} ${ddl}`);
  };
  add('tk_days', 'INTEGER');
  add('pace', "TEXT NOT NULL DEFAULT 'mittel'");

  // v3.5: Bestandsprüfung — eigenes Prüf-Intervall je Produkt und Zeitpunkt der
  // letzten Zählung je Charge. NULL heißt "noch nie geprüft".
  add('check_days', 'INTEGER');

  // v3.6: Hersteller je Produkt (z. B. eigener Hof, Fremdbetrieb). Freitext,
  // damit niemand erst eine Herstellerverwaltung anlegen muss.
  add('manufacturer', "TEXT NOT NULL DEFAULT ''");
  const batchCols = db.prepare('PRAGMA table_info(batches)').all().map((c) => c.name);
  if (!batchCols.includes('checked_at')) {
    db.exec('ALTER TABLE batches ADD COLUMN checked_at TEXT');
  }

  // v3 → v3.1: Rollen. Der erste Benutzer (id 1) wird Admin, bestehende bleiben Nutzer.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
    console.log('[mhd] Rollen-Spalte ergänzt, erster Benutzer ist Admin.');
  }

  // v3 → v3.2: Protokoll braucht Handelnden, Entität und IP für ein brauchbares Audit-Log.
  const evCols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  const evAdds = [
    ['user_id', 'INTEGER'],
    ['username', "TEXT NOT NULL DEFAULT ''"],
    ['entity', "TEXT NOT NULL DEFAULT ''"],
    ['entity_name', "TEXT NOT NULL DEFAULT ''"],
    ['ip', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, type] of evAdds) {
    if (!evCols.includes(col)) db.exec(`ALTER TABLE events ADD COLUMN ${col} ${type}`);
  }

  // v3 → v3.3: Anwesenheit. last_seen wird bei jeder Anfrage aktualisiert (max. 1×/Minute),
  // online bis 5 Minuten ohne Aktivität.
  if (!userCols.includes('last_seen')) {
    db.exec('ALTER TABLE users ADD COLUMN last_seen TEXT');
    db.exec("UPDATE users SET last_seen = last_login WHERE last_login IS NOT NULL");
  }

  // v3 → v3.4: Geräteverwaltung. last_seen am Sitzungsobjekt und IP für die Anzeige.
  const sessCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!sessCols.includes('last_seen')) {
    // SQLite erlaubt bei ALTER TABLE keinen nicht-konstanten DEFAULT.
    // Zwei Schritte: Spalte ohne DEFAULT, dann rückwirkend setzen.
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen TEXT NOT NULL DEFAULT ''");
    db.exec('UPDATE sessions SET last_seen = COALESCE(created_at, datetime(\'now\'))');
  }
  if (!sessCols.includes('ip')) {
    db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT ''");
  }

  // Produkte tragen den Kategorienamen redundant? Nein — category bleibt Text,
  // die Tabelle ist die Auswahlliste. So bleiben Altdaten gültig.
}

/** Altbestand v1 (flache products mit best_before) nach v2 überführen. */
function migrateV1toV2(db) {
  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  const isV1 = cols.includes('best_before') && !cols.includes('warn_days');
  if (!isV1) {
    // Kein v1-Bestand: Tabellen nur anlegen, falls sie fehlen
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'kg',
        location TEXT NOT NULL DEFAULT '',
        warn_days INTEGER,
        freeze_days INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 0,
        best_before TEXT NOT NULL,
        frozen_on TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
      CREATE INDEX IF NOT EXISTS idx_batches_mhd ON batches(best_before);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER,
        product_id INTEGER,
        type TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    return;
  }

  const legacy = db.prepare('SELECT * FROM products').all();
  const insertProduct = db.prepare(`INSERT INTO products
    (name, category, unit, location, notes) VALUES (?, ?, ?, ?, ?)`);

  // ALTER TABLE ... RENAME schreibt Fremdschlüssel anderer Tabellen mit um.
  // Deshalb batches erst NACH der Umbenennung anlegen (sonst FK auf products_old).
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec('DROP TABLE IF EXISTS products_old');
    db.exec('ALTER TABLE products RENAME TO products_old');
    db.exec('DROP TABLE IF EXISTS batches');
    db.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'kg',
        location TEXT NOT NULL DEFAULT '',
        warn_days INTEGER,
        freeze_days INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 0,
        best_before TEXT NOT NULL,
        frozen_on TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
      CREATE INDEX IF NOT EXISTS idx_batches_mhd ON batches(best_before);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER,
        product_id INTEGER,
        type TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
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
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  console.log(`[mhd] Migration v1→v2: ${legacy.length} Produkt(e) übernommen.`);
}
