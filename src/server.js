// mhd-manager · Einstiegspunkt + einmalige Einrichtung des ersten Benutzers
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createApp } from './api.js';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = Number(process.env.PORT || 8091);
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const dbFile = join(dataDir, 'mhd.db');

/* Session-Geheimnis: beim ersten Start erzeugen und mit 0600 ablegen.
   Liegt neben der DB, damit ein Neustart alle Sitzungen nicht ausloggt. */
function sessionSecret() {
  if (process.env.MHD_SESSION_SECRET) return process.env.MHD_SESSION_SECRET;
  const file = join(dataDir, 'session.secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* egal */ }
  console.log('[mhd] Neues Session-Geheimnis erzeugt.');
  return secret;
}

/* Erstbenutzer anlegen — nur wenn noch keiner existiert. */
async function ensureFirstUser(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const user = process.env.MHD_ADMIN_USER;
  const pass = process.env.MHD_ADMIN_PASS;
  if (!user || !pass) {
    console.warn('[mhd] Kein Benutzer vorhanden. Setze MHD_ADMIN_USER und MHD_ADMIN_PASS für die Ersteinrichtung.');
    return;
  }
  if (pass.length < 10) throw new Error('MHD_ADMIN_PASS muss mindestens 10 Zeichen haben.');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(user, await hashPassword(pass));
  console.log(`[mhd] Benutzer "${user}" angelegt.`);
}

const db = openDb(dbFile);
await ensureFirstUser(db);

const { app } = createApp({
  dbFile,
  publicDir: join(root, 'public'),
  sessionSecret: sessionSecret(),
  secureCookies: process.env.MHD_INSECURE_COOKIES !== '1',
});

const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`[mhd] läuft auf http://127.0.0.1:${port} · Daten: ${dataDir}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[mhd] ${sig} — beende.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
