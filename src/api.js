// mhd-manager · HTTP-API + statisches Frontend (v0.3: Auth, Frisch/TK, Kategorien)
import express from 'express';
import { openDb } from './db.js';
import {
  validateProduct, validateBatch, validateCategoryName, daysUntil, statusOf, todayUTC,
  isValidDate, freezeDeadline, freezeStatus, frozenBestBefore, effectiveWarnDays, PACES,
} from './validation.js';
import { verifyPassword, newSessionToken, isValidSessionToken, LoginLimiter } from './auth.js';
import { hashPassword } from './auth.js';

const DEFAULT_WARN_DAYS = 7;
const SESSION_COOKIE = 'mhd_session';
const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function createApp({ dbFile, publicDir, sessionSecret, secureCookies = true }) {
  const app = express();
  const db = openDb(dbFile);
  const limiter = new LoginLimiter();
  setInterval(() => limiter.sweep(), 10 * 60_000).unref();

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    user: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setLastLogin: db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?"),
    updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    sessionInsert: db.prepare('INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)'),
    sessionGet: db.prepare('SELECT * FROM sessions WHERE token = ?'),
    sessionDelete: db.prepare('DELETE FROM sessions WHERE token = ?'),
    sessionDeleteUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    sessionSweep: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    products: db.prepare('SELECT * FROM products WHERE archived = 0 ORDER BY name COLLATE NOCASE'),
    product: db.prepare('SELECT * FROM products WHERE id = ?'),
    insertProduct: db.prepare(`INSERT INTO products
      (name, category, unit, location, warn_days, freeze_days, tk_days, pace, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateProduct: db.prepare(`UPDATE products SET name=?, category=?, unit=?, location=?,
      warn_days=?, freeze_days=?, tk_days=?, pace=?, notes=?, updated_at=datetime('now') WHERE id=?`),
    deleteProduct: db.prepare('DELETE FROM products WHERE id = ?'),
    batchesOf: db.prepare('SELECT * FROM batches WHERE product_id = ? ORDER BY best_before ASC, id ASC'),
    allBatches: db.prepare('SELECT * FROM batches ORDER BY best_before ASC, id ASC'),
    batch: db.prepare('SELECT * FROM batches WHERE id = ?'),
    insertBatch: db.prepare(`INSERT INTO batches (product_id, quantity, best_before, frozen_on, note)
      VALUES (?, ?, ?, ?, ?)`),
    updateBatch: db.prepare(`UPDATE batches SET quantity=?, best_before=?, frozen_on=?, note=?,
      updated_at=datetime('now') WHERE id=?`),
    deleteBatch: db.prepare('DELETE FROM batches WHERE id = ?'),
    logEvent: db.prepare('INSERT INTO events (batch_id, product_id, type, detail) VALUES (?, ?, ?, ?)'),
    categories: db.prepare('SELECT * FROM categories ORDER BY active DESC, sort ASC, name COLLATE NOCASE ASC'),
    categoryByName: db.prepare('SELECT * FROM categories WHERE name = ? COLLATE NOCASE'),
    insertCategory: db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)'),
    reactivateCategory: db.prepare("UPDATE categories SET active = 1 WHERE id = ?"),
    deleteCategory: db.prepare('DELETE FROM categories WHERE id = ?'),
    deactivateCategory: db.prepare('UPDATE categories SET active = 0 WHERE id = ?'),
    countByCategory: db.prepare('SELECT COUNT(*) AS n FROM products WHERE category = ? COLLATE NOCASE AND archived = 0'),
  };

  const defaultWarn = () => {
    const row = q.getSetting.get('warn_days');
    const n = row ? Number(row.value) : DEFAULT_WARN_DAYS;
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : DEFAULT_WARN_DAYS;
  };

  /* ---------- Statusberechnung ---------- */
  function decorateBatch(batch, product, today) {
    const warn = effectiveWarnDays(product, defaultWarn());
    const days = daysUntil(batch.best_before, today);
    const deadline = freezeDeadline(batch.best_before, product.freeze_days);
    const tkMhd = frozenBestBefore(batch.frozen_on, product.tk_days);
    const fStatus = freezeStatus(
      { bestBefore: batch.best_before, freezeDays: product.freeze_days, frozenOn: batch.frozen_on },
      today
    );

    // Maßgeblich für den Ablauf-Status ist das MHD, das gerade gilt:
    // eingefroren → TK-MHD, sonst Frisch-MHD.
    const relevantDate = tkMhd || batch.best_before;
    const relevantDays = daysUntil(relevantDate, today);

    return {
      ...batch,
      days_left: days,
      status: statusOf(days, warn),
      post_freeze_status: tkMhd ? statusOf(relevantDays, warn) : null,
      warn_days: warn,
      freeze_deadline: deadline,
      freeze_days_left: deadline ? daysUntil(deadline, today) : null,
      freeze_status: fStatus,
      tk_best_before: tkMhd,
      tk_days_left: tkMhd ? relevantDays : null,
    };
  }

  function decorateProduct(product, batches, today) {
    const decorated = batches.map((b) => decorateBatch(b, product, today));
    const active = decorated.filter((b) => b.quantity > 0);
    const rank = { expired: 0, urgent: 1, due: 2, soon: 3, ok: 4, unknown: 5 };
    const statusKey = (b) => {
      if (b.freeze_status === 'due' || b.freeze_status === 'missed') return 'due';
      return b.post_freeze_status || b.status;
    };
    const worst = active.reduce((acc, b) => {
      const key = statusKey(b);
      return (rank[key] ?? 9) < (rank[acc] ?? 9) ? key : acc;
    }, 'ok');

    return {
      ...product,
      warn_days_effective: effectiveWarnDays(product, defaultWarn()),
      batches: decorated,
      active_batches: active.length,
      total_quantity: active.reduce((s, b) => s + b.quantity, 0),
      worst_status: active.length ? worst : 'ok',
      next_best_before: active.length ? active[0].best_before : null,
      freeze_due_count: active.filter((b) => b.freeze_status === 'due' || b.freeze_status === 'missed').length,
    };
  }

  const loadProduct = (id, today) => {
    const p = q.product.get(id);
    if (!p) return null;
    return decorateProduct(p, q.batchesOf.all(id), today);
  };

  const todayOf = (req) => (isValidDate(req.query.today) ? req.query.today : todayUTC());

  /* ---------- Sicherheit: Header ---------- */
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
      "form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  /* ---------- Auth-Helfer ---------- */
  const parseCookies = (header = '') =>
    Object.fromEntries(header.split(';').map((p) => p.trim()).filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      }));

  const cookieFor = (token, maxAgeSec) => [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secureCookies ? 'Secure' : '',
    `Max-Age=${maxAgeSec}`,
  ].filter(Boolean).join('; ');

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!isValidSessionToken(token, sessionSecret)) return null;
    const row = q.sessionGet.get(token);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      q.sessionDelete.run(token);
      return null;
    }
    const user = q.userById.get(row.user_id);
    return user ? { user, token } : null;
  }

  const requireAuth = (req, res, next) => {
    const ctx = currentUser(req);
    if (!ctx) return res.status(401).json({ error: 'Nicht angemeldet.' });
    req.auth = ctx;
    next();
  };

  /* ---------- Login / Logout ---------- */
  app.post('/api/login', async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unbekannt';
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const keys = [`ip:${ip}`, `user:${username.toLowerCase()}`];

    const lockedFor = limiter.lockedFor(keys);
    if (lockedFor > 0) {
      res.setHeader('Retry-After', String(lockedFor));
      return res.status(429).json({
        error: `Zu viele Fehlversuche. Bitte in ${Math.ceil(lockedFor / 60)} Minute(n) erneut versuchen.`,
        retry_after: lockedFor,
      });
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort erforderlich.' });
    }

    const user = q.user.get(username);
    const ok = user ? await verifyPassword(password, user.password_hash) : await fakeVerify(password);

    if (!ok) {
      const lock = limiter.fail(keys);
      q.logEvent.run(null, null, 'login_failed', `${username} von ${ip}`);
      if (lock > 0) {
        res.setHeader('Retry-After', String(lock));
        return res.status(429).json({
          error: `Zu viele Fehlversuche. Gesperrt für ${Math.ceil(lock / 60)} Minute(n).`,
          retry_after: lock,
        });
      }
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch.' });
    }

    limiter.reset(keys);
    q.sessionSweep.run(Date.now());
    const token = newSessionToken(sessionSecret);
    q.sessionInsert.run(token, user.id, Date.now() + SESSION_TTL_MS, String(req.headers['user-agent'] || '').slice(0, 200));
    q.setLastLogin.run(user.id);
    q.logEvent.run(null, null, 'login_ok', `${user.username} von ${ip}`);

    res.setHeader('Set-Cookie', cookieFor(token, Math.floor(SESSION_TTL_MS / 1000)));
    res.json({ user: { id: user.id, username: user.username }, expires_in: Math.floor(SESSION_TTL_MS / 1000) });
  });

  app.post('/api/logout', (req, res) => {
    const ctx = currentUser(req);
    if (ctx) q.sessionDelete.run(ctx.token);
    res.setHeader('Set-Cookie', cookieFor('', 0));
    res.status(204).end();
  });

  app.get('/api/me', (req, res) => {
    const ctx = currentUser(req);
    if (!ctx) return res.status(401).json({ error: 'Nicht angemeldet.' });
    res.json({ user: { id: ctx.user.id, username: ctx.user.username }, last_login: ctx.user.last_login });
  });

  /* ---------- Health (öffentlich, ohne Daten) ---------- */
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: 3, today: todayUTC() });
  });

  /* ---------- Ab hier alles geschützt ---------- */
  const api = express.Router();
  api.use(requireAuth);

  api.get('/overview', (req, res) => {
    const today = todayOf(req);
    const products = q.products.all();
    const batches = q.allBatches.all();
    const byProduct = new Map();
    for (const b of batches) {
      if (!byProduct.has(b.product_id)) byProduct.set(b.product_id, []);
      byProduct.get(b.product_id).push(b);
    }
    const list = products.map((p) => decorateProduct(p, byProduct.get(p.id) || [], today));

    const counts = { expired: 0, urgent: 0, soon: 0, ok: 0, freeze_due: 0 };
    for (const p of list) {
      for (const b of p.batches) {
        if (b.quantity <= 0) continue;
        const key = b.post_freeze_status || b.status;
        if (key in counts) counts[key]++;
        if (b.freeze_status === 'due' || b.freeze_status === 'missed') counts.freeze_due++;
      }
    }
    res.json({ today, warn_days: defaultWarn(), counts, products: list });
  });

  /* Produkte */
  api.get('/products', (req, res) => {
    const today = todayOf(req);
    res.json({
      today,
      products: q.products.all().map((p) => decorateProduct(p, q.batchesOf.all(p.id), today)),
    });
  });

  api.get('/products/:id', (req, res) => {
    const p = loadProduct(Number(req.params.id), todayOf(req));
    if (!p) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    res.json(p);
  });

  api.post('/products', (req, res) => {
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    const info = q.insertProduct.run(
      value.name, value.category, value.unit, value.location,
      value.warn_days, value.freeze_days, value.tk_days, value.pace, value.notes
    );
    const id = Number(info.lastInsertRowid);
    q.logEvent.run(null, id, 'product_created', value.name);
    res.status(201).json(loadProduct(id, todayUTC()));
  });

  api.put('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!q.product.get(id)) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    q.updateProduct.run(
      value.name, value.category, value.unit, value.location,
      value.warn_days, value.freeze_days, value.tk_days, value.pace, value.notes, id
    );
    q.logEvent.run(null, id, 'product_updated', value.name);
    res.json(loadProduct(id, todayUTC()));
  });

  api.delete('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!q.product.get(id)) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    q.deleteProduct.run(id);
    res.status(204).end();
  });

  /* Chargen */
  api.post('/products/:id/batches', (req, res) => {
    const id = Number(req.params.id);
    const product = q.product.get(id);
    if (!product) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const { ok, errors, value } = validateBatch(req.body);
    if (!ok) return res.status(400).json({ errors });
    const info = q.insertBatch.run(id, value.quantity, value.best_before, value.frozen_on, value.note);
    const batchId = Number(info.lastInsertRowid);
    q.logEvent.run(batchId, id, 'batch_created',
      `${value.quantity} · MHD ${value.best_before}${value.frozen_on ? ` · TK seit ${value.frozen_on}` : ''}`);
    res.status(201).json(decorateBatch(q.batch.get(batchId), product, todayUTC()));
  });

  api.put('/batches/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    const { ok, errors, value } = validateBatch(req.body);
    if (!ok) return res.status(400).json({ errors });
    q.updateBatch.run(value.quantity, value.best_before, value.frozen_on, value.note, id);
    if (!existing.frozen_on && value.frozen_on) {
      q.logEvent.run(id, existing.product_id, 'batch_frozen', `eingefroren am ${value.frozen_on}`);
    }
    res.json(decorateBatch(q.batch.get(id), q.product.get(existing.product_id), todayUTC()));
  });

  api.post('/batches/:id/freeze', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    if (existing.frozen_on) return res.status(409).json({ error: 'Charge ist bereits eingefroren.' });
    const product = q.product.get(existing.product_id);
    if (!product || !Number.isFinite(product.tk_days) || product.tk_days <= 0) {
      return res.status(409).json({ error: 'Für dieses Produkt ist keine TK-Haltbarkeit hinterlegt.' });
    }
    const on = isValidDate(req.body?.frozen_on) ? req.body.frozen_on : todayUTC();
    if (daysUntil(on) > 0) return res.status(400).json({ errors: ['Einfrierdatum darf nicht in der Zukunft liegen.'] });
    q.updateBatch.run(existing.quantity, existing.best_before, on, existing.note, id);
    q.logEvent.run(id, existing.product_id, 'batch_frozen', `eingefroren am ${on}`);
    res.json(decorateBatch(q.batch.get(id), product, todayUTC()));
  });

  api.put('/batches/:id/quantity', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    const n = Number(req.body?.quantity);
    if (!Number.isFinite(n) || n < 0 || n > 999999) {
      return res.status(400).json({ errors: ['Menge muss eine Zahl zwischen 0 und 999999 sein.'] });
    }
    q.updateBatch.run(n, existing.best_before, existing.frozen_on, existing.note, id);
    q.logEvent.run(id, existing.product_id, 'quantity_changed', `${existing.quantity} → ${n}`);
    res.json(decorateBatch(q.batch.get(id), q.product.get(existing.product_id), todayUTC()));
  });

  api.delete('/batches/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    q.deleteBatch.run(id);
    q.logEvent.run(null, existing.product_id, 'batch_deleted', `MHD ${existing.best_before}`);
    res.status(204).end();
  });

  /* Kategorien */
  api.get('/categories', (_req, res) => {
    res.json({ categories: q.categories.all() });
  });

  api.post('/categories', (req, res) => {
    const check = validateCategoryName(req.body?.name);
    if (!check.ok) return res.status(400).json({ errors: [check.error] });
    const existing = q.categoryByName.get(check.value);
    if (existing) {
      if (!existing.active) {
        q.reactivateCategory.run(existing.id);
        return res.status(201).json({ ...existing, active: 1 });
      }
      return res.status(409).json({ errors: ['Diese Kategorie gibt es schon.'] });
    }
    const maxSort = q.categories.all().reduce((m, c) => Math.max(m, c.sort), 0);
    const info = q.insertCategory.run(check.value, maxSort + 10);
    q.logEvent.run(null, null, 'category_created', check.value);
    res.status(201).json({ id: Number(info.lastInsertRowid), name: check.value, active: 1 });
  });

  api.delete('/categories/:id', (req, res) => {
    const id = Number(req.params.id);
    const cat = q.categories.all().find((c) => c.id === id);
    if (!cat) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    const used = q.countByCategory.get(cat.name).n;
    if (used > 0) {
      // Nicht hart löschen: bestehende Produkte würden ihren Kategorienamen verlieren
      q.deactivateCategory.run(id);
      return res.json({ id, active: 0, in_use: used, note: `Kategorie bleibt für ${used} Produkt(e) erhalten.` });
    }
    q.deleteCategory.run(id);
    q.logEvent.run(null, null, 'category_deleted', cat.name);
    res.status(204).end();
  });

  /* Einstellungen & Export */
  api.get('/settings', (_req, res) => {
    res.json({ warn_days: defaultWarn(), paces: PACES });
  });

  /* Passwort ändern: verlangt das aktuelle Passwort, beendet alle anderen Sitzungen. */
  api.post('/password', async (req, res) => {
    const current = String(req.body?.current || '');
    const next = String(req.body?.next || '');

    if (!current || !next) {
      return res.status(400).json({ errors: ['Aktuelles und neues Passwort erforderlich.'] });
    }
    if (next.length < 10) {
      return res.status(400).json({ errors: ['Das neue Passwort braucht mindestens 10 Zeichen.'] });
    }
    if (next.length > 200) {
      return res.status(400).json({ errors: ['Das neue Passwort ist zu lang (max. 200 Zeichen).'] });
    }
    if (next === current) {
      return res.status(400).json({ errors: ['Das neue Passwort muss sich vom alten unterscheiden.'] });
    }
    if (!(await verifyPassword(current, req.auth.user.password_hash))) {
      q.logEvent.run(null, null, 'password_change_failed', req.auth.user.username);
      return res.status(403).json({ errors: ['Das aktuelle Passwort ist falsch.'] });
    }

    const hash = await hashPassword(next);
    q.updatePassword.run(hash, req.auth.user.id);
    // Alle Sitzungen des Benutzers beenden, dann die aktuelle neu ausstellen —
    // so fliegt niemand mitten in der Arbeit raus, fremde Geräte aber schon.
    q.sessionDeleteUser.run(req.auth.user.id);
    const token = newSessionToken(sessionSecret);
    q.sessionInsert.run(
      token, req.auth.user.id, Date.now() + SESSION_TTL_MS,
      String(req.headers['user-agent'] || '').slice(0, 200)
    );
    q.logEvent.run(null, null, 'password_changed', req.auth.user.username);

    res.setHeader('Set-Cookie', cookieFor(token, Math.floor(SESSION_TTL_MS / 1000)));
    res.json({ ok: true, other_sessions_ended: true });
  });

  api.put('/settings', (req, res) => {
    const n = Number(req.body?.warn_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      return res.status(400).json({ errors: ['warn_days muss eine ganze Zahl zwischen 0 und 365 sein.'] });
    }
    q.setSetting.run('warn_days', String(n));
    res.json({ warn_days: n });
  });

  api.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="mhd-export-${todayUTC()}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      version: 3,
      warn_days: defaultWarn(),
      categories: q.categories.all(),
      products: q.products.all().map((p) => ({ ...p, batches: q.batchesOf.all(p.id) })),
    });
  });

  app.use('/api', api);

  /* ---------- Statisches Frontend ---------- */
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    console.error('[mhd] Fehler:', err.message);
    res.status(500).json({ error: 'Interner Fehler.' });
  });

  return { app, db };
}

/** Vergleichs-Hash für unbekannte Benutzer: gleiche Rechenzeit, kein User-Enumeration. */
const DUMMY_HASH = 'scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

async function fakeVerify(password) {
  try {
    await verifyPassword(password, DUMMY_HASH);
  } catch {
    // bewusst ignoriert
  }
  return false;
}
