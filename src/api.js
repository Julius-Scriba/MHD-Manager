// mhd-manager · HTTP-API + statisches Frontend
import express from 'express';
import { openDb } from './db.js';
import { validateProduct, daysUntil, statusOf, todayUTC, isValidDate } from './validation.js';

export function createApp({ dbFile, publicDir }) {
  const app = express();
  const db = openDb(dbFile);

  const statements = {
    all: db.prepare('SELECT * FROM products ORDER BY best_before ASC, name ASC'),
    byId: db.prepare('SELECT * FROM products WHERE id = ?'),
    insert: db.prepare(`INSERT INTO products
      (name, category, location, quantity, unit, best_before, opened_on, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`UPDATE products SET
      name=?, category=?, location=?, quantity=?, unit=?, best_before=?, opened_on=?, notes=?,
      updated_at=datetime('now') WHERE id=?`),
    remove: db.prepare('DELETE FROM products WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM products'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
  };

  function warnDays() {
    const row = statements.getSetting.get('warn_days');
    const n = row ? Number(row.value) : 7;
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : 7;
  }

  const decorate = (row, today) => {
    const days = daysUntil(row.best_before, today);
    return { ...row, days_left: days, status: statusOf(days, warnDays()) };
  };

  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, products: statements.count.get().n, today: todayUTC() });
  });

  app.get('/api/products', (req, res) => {
    const today = isValidDate(req.query.today) ? req.query.today : todayUTC();
    res.json({
      today,
      warn_days: warnDays(),
      products: statements.all.all().map((r) => decorate(r, today)),
    });
  });

  app.get('/api/products/:id', (req, res) => {
    const row = statements.byId.get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    res.json(decorate(row, todayUTC()));
  });

  app.post('/api/products', (req, res) => {
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    const info = statements.insert.run(
      value.name, value.category, value.location, value.quantity,
      value.unit, value.best_before, value.opened_on, value.notes
    );
    res.status(201).json(decorate(statements.byId.get(Number(info.lastInsertRowid)), todayUTC()));
  });

  app.put('/api/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!statements.byId.get(id)) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    statements.update.run(
      value.name, value.category, value.location, value.quantity,
      value.unit, value.best_before, value.opened_on, value.notes, id
    );
    res.json(decorate(statements.byId.get(id), todayUTC()));
  });

  app.delete('/api/products/:id', (req, res) => {
    const info = statements.remove.run(Number(req.params.id));
    if (info.changes === 0) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    res.status(204).end();
  });

  app.get('/api/settings', (_req, res) => {
    res.json({ warn_days: warnDays() });
  });

  app.put('/api/settings', (req, res) => {
    const n = Number(req.body?.warn_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      return res.status(400).json({ errors: ['warn_days muss eine ganze Zahl zwischen 0 und 365 sein.'] });
    }
    statements.setSetting.run('warn_days', String(n));
    res.json({ warn_days: n });
  });

  app.get('/api/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="mhd-export-${todayUTC()}.json"`);
    res.json({ exported_at: new Date().toISOString(), warn_days: warnDays(), products: statements.all.all() });
  });

  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    console.error('[mhd] Fehler:', err.message);
    res.status(500).json({ error: 'Interner Fehler.' });
  });

  return { app, db };
}
