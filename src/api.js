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

/** ISO-Datum (YYYY-MM-DD) als DD.MM.YYYY für lesbare Protokolltexte. */
const fmtDate = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
  : String(iso ?? '–'));

export function createApp({ dbFile, publicDir, sessionSecret, secureCookies = true }) {
  const app = express();
  const db = openDb(dbFile);
  const limiter = new LoginLimiter();
  setInterval(() => limiter.sweep(), 10 * 60_000).unref();
  /** Zwischenspeicher, damit last_seen nicht bei jedem Request geschrieben wird. */
  const lastSeenCache = new Map();

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    user: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setLastLogin: db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?"),
    setLastSeen: db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?"),
    updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    users: db.prepare(`SELECT id, username, role, created_at, last_login, last_seen FROM users
      ORDER BY role = 'admin' DESC, username COLLATE NOCASE`),
    insertUser: db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    countSessionsOfUser: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'),
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
    logEvent: db.prepare(`INSERT INTO events
      (batch_id, product_id, type, detail, user_id, username, entity, entity_name, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    events: db.prepare(`SELECT * FROM events
      WHERE (? = '' OR type LIKE ?)
        AND (? = '' OR username = ?)
        AND (? = '' OR at >= ?)
      ORDER BY id DESC LIMIT ?`),
    eventTypes: db.prepare('SELECT type, COUNT(*) AS n FROM events GROUP BY type ORDER BY type'),
    eventUsers: db.prepare(`SELECT username, COUNT(*) AS n FROM events
      WHERE username <> '' GROUP BY username ORDER BY username COLLATE NOCASE`),
    eventCount: db.prepare('SELECT COUNT(*) AS n FROM events'),
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
    if (!user) return null;
    touchLastSeen(user.id);
    return { user, token };
  }

  /**
   * Anwesenheit erfassen, aber nicht bei jedem Request schreiben:
   * höchstens einmal pro Minute pro Benutzer.
   */
  const touchLastSeen = (userId) => {
    const now = Date.now();
    const last = lastSeenCache.get(userId) || 0;
    if (now - last < 60_000) return;
    lastSeenCache.set(userId, now);
    try {
      q.setLastSeen.run(userId);
    } catch (err) {
      console.error('[mhd] last_seen konnte nicht gesetzt werden:', err.message);
    }
  };

  const requireAuth = (req, res, next) => {
    const ctx = currentUser(req);
    if (!ctx) return res.status(401).json({ error: 'Nicht angemeldet.' });
    req.auth = ctx;
    next();
  };

  /** Nur Admins: Benutzerverwaltung und globale Einstellungen. */
  const requireAdmin = (req, res, next) => {
    if ((req.auth?.user?.role || 'user') !== 'admin') {
      return res.status(403).json({ error: 'Nur für Administratoren.' });
    }
    next();
  };

  /* ---------- Protokoll ---------- */
  /** Client-IP hinter Nginx, ohne sich auf einen einzelnen Header zu verlassen. */
  const clientIp = (req) => {
    const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return (fwd || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 60);
  };

  /**
   * Einheitlicher Protokolleintrag.
   * actor: req (aus der Sitzung) oder user (bei Login, wo es noch keine Sitzung gibt).
   */
  const ql = (type, opts = {}) => {
    const actor = opts.user || opts.req?.auth?.user || null;
    try {
      q.logEvent.run(
        opts.batchId ?? null,
        opts.productId ?? null,
        type,
        String(opts.detail || '').slice(0, 300),
        actor?.id ?? null,
        String(opts.username ?? actor?.username ?? '').slice(0, 64),
        String(opts.entity || '').slice(0, 24),
        String(opts.entityName ?? '').slice(0, 120),
        clientIp(opts.req)
      );
    } catch (err) {
      // Protokollieren darf nie eine fachliche Aktion zum Scheitern bringen.
      console.error('[mhd] Protokolleintrag fehlgeschlagen:', err.message);
    }
  };

  const productName = (id) => q.product.get(id)?.name || `Produkt #${id}`;

  /** Änderungen am Produkt lesbar machen — nur die Felder, die sich wirklich geändert haben. */
  const describeProductChange = (before, after) => {
    if (!before) return '';
    const labels = {
      name: 'Name', category: 'Kategorie', unit: 'Einheit', location: 'Ort',
      warn_days: 'Warnzeit', freeze_days: 'Einfrieren', tk_days: 'TK-Tage',
      pace: 'Tempo', notes: 'Notiz',
    };
    const changed = [];
    for (const [key, label] of Object.entries(labels)) {
      const a = before[key] ?? null;
      const b = after[key] ?? null;
      if (a !== b) changed.push(`${label}: ${a === null ? '–' : a} → ${b === null ? '–' : b}`);
    }
    return changed.length ? changed.join(', ').slice(0, 300) : 'ohne Feldänderung';
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
      ql('login_failed', { detail: `Benutzername "${username}"`, username: username });
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
    ql('login_ok', { user, detail: 'Anmeldung erfolgreich' });

    res.setHeader('Set-Cookie', cookieFor(token, Math.floor(SESSION_TTL_MS / 1000)));
    res.json({
      user: { id: user.id, username: user.username, role: user.role || 'user' },
      expires_in: Math.floor(SESSION_TTL_MS / 1000),
    });
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
    res.json({
      user: { id: ctx.user.id, username: ctx.user.username, role: ctx.user.role || 'user' },
      last_login: ctx.user.last_login,
    });
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
    ql('product_created', { req, productId: id, entityName: value.name, detail: `${value.category || 'ohne Kategorie'} · ${value.unit}` });
    res.status(201).json(loadProduct(id, todayUTC()));
  });

  api.put('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    const before = q.product.get(id);
    if (!before) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    q.updateProduct.run(
      value.name, value.category, value.unit, value.location,
      value.warn_days, value.freeze_days, value.tk_days, value.pace, value.notes, id
    );
    ql('product_updated', { req, productId: id, entityName: value.name, detail: describeProductChange(before, value) });
    res.json(loadProduct(id, todayUTC()));
  });

  api.delete('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    const product = q.product.get(id);
    if (!product) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const batches = q.batchesOf.all(id).length;
    q.deleteProduct.run(id);
    ql('product_deleted', {
      req, productId: id, entityName: product.name,
      detail: `${product.category || 'ohne Kategorie'} · ${batches} Charge(n) mitgelöscht`,
    });
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
    ql('batch_created', {
      req, productId: id, batchId, entityName: product.name,
      detail: `${value.quantity} ${product.unit || ''} · MHD ${fmtDate(value.best_before)}${value.frozen_on ? ` · TK seit ${fmtDate(value.frozen_on)}` : ''}`.trim(),
    });
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
      ql('batch_frozen', { req, productId: existing.product_id, batchId: id, entityName: productName(existing.product_id), detail: `eingefroren am ${fmtDate(value.frozen_on)}` });
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
    ql('batch_frozen', { req, productId: existing.product_id, batchId: id, entityName: product?.name, detail: `eingefroren am ${fmtDate(on)}` });
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
    ql('quantity_changed', { req, productId: existing.product_id, batchId: id, entityName: productName(existing.product_id), detail: `${existing.quantity} → ${n}` });
    res.json(decorateBatch(q.batch.get(id), q.product.get(existing.product_id), todayUTC()));
  });

  api.delete('/batches/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    q.deleteBatch.run(id);
    ql('batch_deleted', { req, productId: existing.product_id, batchId: id, entityName: productName(existing.product_id), detail: `MHD ${fmtDate(existing.best_before)} · ${existing.quantity}` });
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
    ql('category_created', { req, entity: 'category', entityName: check.value });
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
      ql('category_deleted', { req, entity: 'category', entityName: cat.name, detail: `deaktiviert (noch ${used} Produkt(e))` });
      return res.json({ id, active: 0, in_use: used, note: `Kategorie bleibt für ${used} Produkt(e) erhalten.` });
    }
    q.deleteCategory.run(id);
    ql('category_deleted', { req, entity: 'category', entityName: cat.name, detail: 'gelöscht' });
    res.status(204).end();
  });

  /* Einstellungen & Export */
  api.get('/settings', (_req, res) => {
    res.json({ warn_days: defaultWarn(), paces: PACES });
  });

  /* ---------- Benutzerverwaltung (nur Admins) ---------- */
  /** Anwesenheit: online = Aktivität in den letzten 5 Minuten. */
  const ONLINE_WINDOW_MS = 5 * 60_000;
  const presenceOf = (u) => {
    if (!u.last_seen) return { online: false, last_seen: null, last_seen_min: null };
    const t = Date.parse(u.last_seen.replace(' ', 'T') + 'Z');
    if (Number.isNaN(t)) return { online: false, last_seen: u.last_seen, last_seen_min: null };
    const minutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
    return { online: Date.now() - t < ONLINE_WINDOW_MS, last_seen: u.last_seen, last_seen_min: minutes };
  };

  const safeUser = (u) => ({
    id: u.id,
    username: u.username,
    role: u.role || 'user',
    created_at: u.created_at,
    last_login: u.last_login,
    ...presenceOf(u),
  });

  api.get('/users', requireAdmin, (_req, res) => {
    res.json({ users: q.users.all().map(safeUser) });
  });

  api.post('/users', requireAdmin, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const role = req.body?.role === 'admin' ? 'admin' : 'user';

    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ errors: ['Benutzername braucht 3 bis 32 Zeichen.'] });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(username)) {
      return res.status(400).json({ errors: ['Benutzername darf nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich enthalten.'] });
    }
    if (password.length < 10) {
      return res.status(400).json({ errors: ['Das Passwort braucht mindestens 10 Zeichen.'] });
    }
    if (q.user.get(username)) {
      return res.status(409).json({ errors: ['Diesen Benutzernamen gibt es schon.'] });
    }

    const hash = await hashPassword(password);
    const info = q.insertUser.run(username, hash, role);
    const id = Number(info.lastInsertRowid);
    ql('user_created', { req, entity: 'user', entityName: username, detail: role === 'admin' ? 'als Administrator' : 'als Mitarbeiter' });
    res.status(201).json(safeUser(q.userById.get(id)));
  });

  api.post('/users/:id/password', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const target = q.userById.get(id);
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    const password = String(req.body?.password || '');
    if (password.length < 10) {
      return res.status(400).json({ errors: ['Das Passwort braucht mindestens 10 Zeichen.'] });
    }
    q.updatePassword.run(await hashPassword(password), id);
    // Fremde Sitzungen sofort beenden
    if (id !== req.auth.user.id) q.sessionDeleteUser.run(id);
    ql('user_password_reset', { req, entity: 'user', entityName: target.username, detail: id !== req.auth.user.id ? 'Sitzungen beendet' : 'eigenes Konto' });
    res.json({ ok: true, sessions_ended: id !== req.auth.user.id });
  });

  api.delete('/users/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const target = q.userById.get(id);
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    if (id === req.auth.user.id) {
      return res.status(409).json({ errors: ['Das eigene Konto kann nicht gelöscht werden.'] });
    }
    if ((target.role || 'user') === 'admin' && q.countAdmins.get().n <= 1) {
      return res.status(409).json({ errors: ['Der letzte Administrator kann nicht gelöscht werden.'] });
    }
    q.deleteUser.run(id); // Sessions hängen per ON DELETE CASCADE dran
    ql('user_deleted', { req, entity: 'user', entityName: target.username, detail: `Rolle ${target.role || 'user'}` });
    res.status(204).end();
  });

  api.put('/users/:id/role', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const target = q.userById.get(id);
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    const role = req.body?.role === 'admin' ? 'admin' : 'user';
    if (id === req.auth.user.id && role !== 'admin') {
      return res.status(409).json({ errors: ['Die eigene Admin-Rolle kann nicht entfernt werden.'] });
    }
    if ((target.role || 'user') === 'admin' && role !== 'admin' && q.countAdmins.get().n <= 1) {
      return res.status(409).json({ errors: ['Der letzte Administrator behält seine Rolle.'] });
    }
    q.setRole.run(role, id);
    ql('user_role_changed', { req, entity: 'user', entityName: target.username, detail: `${target.role || 'user'} → ${role}` });
    res.json(safeUser(q.userById.get(id)));
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
      ql('password_change_failed', { req, entity: 'user', entityName: req.auth.user.username, detail: 'falsches aktuelles Passwort' });
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
    ql('password_changed', { req, entity: 'user', entityName: req.auth.user.username, detail: 'alle anderen Sitzungen beendet' });

    res.setHeader('Set-Cookie', cookieFor(token, Math.floor(SESSION_TTL_MS / 1000)));
    res.json({ ok: true, other_sessions_ended: true });
  });

  api.put('/settings', requireAdmin, (req, res) => {
    const n = Number(req.body?.warn_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      return res.status(400).json({ errors: ['warn_days muss eine ganze Zahl zwischen 0 und 365 sein.'] });
    }
    const previous = defaultWarn();
    q.setSetting.run('warn_days', String(n));
    if (previous !== n) {
      ql('settings_changed', { req, entity: 'setting', entityName: 'Standard-Warnzeit', detail: `${previous} → ${n} Tage` });
    }
    res.json({ warn_days: n });
  });

  /* ---------- Protokoll (nur Admins) ---------- */
  api.get('/events', requireAdmin, (req, res) => {
    const type = String(req.query.type || '').trim().slice(0, 64);
    const user = String(req.query.user || '').trim().slice(0, 64);
    const since = String(req.query.since || '').trim();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 200;
    const sinceValue = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : '';

    const rows = q.events.all(type, type ? `${type}%` : '', user, user, sinceValue, sinceValue, limit);
    res.json({
      events: rows,
      total: q.eventCount.get().n,
      limit,
      filters: {
        types: q.eventTypes.all(),
        users: q.eventUsers.all(),
      },
    });
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
