// mhd-manager · HTTP-API + statisches Frontend
import express from 'express';
import { openDb } from './db.js';
import {
  validateProduct, validateBatch, daysUntil, statusOf, todayUTC, isValidDate,
  freezeDeadline, freezeStatus,
} from './validation.js';

const DEFAULT_WARN_DAYS = 7;

export function createApp({ dbFile, publicDir }) {
  const app = express();
  const db = openDb(dbFile);

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    products: db.prepare('SELECT * FROM products WHERE archived = 0 ORDER BY name COLLATE NOCASE'),
    product: db.prepare('SELECT * FROM products WHERE id = ?'),
    insertProduct: db.prepare(`INSERT INTO products (name, category, unit, location, warn_days, freeze_days, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    updateProduct: db.prepare(`UPDATE products SET name=?, category=?, unit=?, location=?,
      warn_days=?, freeze_days=?, notes=?, updated_at=datetime('now') WHERE id=?`),
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
  };

  const defaultWarn = () => {
    const row = q.getSetting.get('warn_days');
    const n = row ? Number(row.value) : DEFAULT_WARN_DAYS;
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : DEFAULT_WARN_DAYS;
  };

  function decorateBatch(batch, product, today) {
    const warn = product.warn_days ?? defaultWarn();
    const days = daysUntil(batch.best_before, today);
    const deadline = freezeDeadline(batch.best_before, product.freeze_days);
    return {
      ...batch,
      days_left: days,
      status: statusOf(days, warn),
      warn_days: warn,
      freeze_deadline: deadline,
      freeze_days_left: deadline ? daysUntil(deadline, today) : null,
      freeze_status: freezeStatus(
        { bestBefore: batch.best_before, freezeDays: product.freeze_days, frozenOn: batch.frozen_on },
        today
      ),
    };
  }

  function decorateProduct(product, batches, today) {
    const decorated = batches.map((b) => decorateBatch(b, product, today));
    const active = decorated.filter((b) => b.quantity > 0);
    const rank = { expired: 0, urgent: 1, due: 2, soon: 3, ok: 4, unknown: 5 };
    const worst = active.reduce((acc, b) => {
      const key = b.status === 'ok' && b.freeze_status === 'due' ? 'due' : b.status;
      return (rank[key] ?? 9) < (rank[acc] ?? 9) ? key : acc;
    }, 'ok');
    return {
      ...product,
      warn_days_effective: product.warn_days ?? defaultWarn(),
      batches: decorated,
      active_batches: active.length,
      total_quantity: active.reduce((s, b) => s + b.quantity, 0),
      worst_status: active.length ? worst : 'ok',
      next_best_before: active.length ? active[0].best_before : null,
    };
  }

  const loadProduct = (id, today) => {
    const p = q.product.get(id);
    if (!p) return null;
    return decorateProduct(p, q.batchesOf.all(id), today);
  };

  const todayOf = (req) => (isValidDate(req.query.today) ? req.query.today : todayUTC());

  app.use(express.json({ limit: '256kb' }));

  /* ---------- Health & Übersicht ---------- */
  app.get('/api/health', (_req, res) => {
    const products = q.products.all().length;
    const batches = q.allBatches.all().length;
    res.json({ ok: true, version: 2, products, batches, today: todayUTC() });
  });

  app.get('/api/overview', (req, res) => {
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
        if (b.status in counts) counts[b.status]++;
        if (b.freeze_status === 'due' || b.freeze_status === 'missed') counts.freeze_due++;
      }
    }
    res.json({ today, warn_days: defaultWarn(), counts, products: list });
  });

  /* ---------- Produkte ---------- */
  app.get('/api/products', (req, res) => {
    const today = todayOf(req);
    res.json({ today, products: q.products.all().map((p) => decorateProduct(p, q.batchesOf.all(p.id), today)) });
  });

  app.get('/api/products/:id', (req, res) => {
    const p = loadProduct(Number(req.params.id), todayOf(req));
    if (!p) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    res.json(p);
  });

  app.post('/api/products', (req, res) => {
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    const info = q.insertProduct.run(
      value.name, value.category, value.unit, value.location,
      value.warn_days, value.freeze_days, value.notes
    );
    const id = Number(info.lastInsertRowid);
    q.logEvent.run(null, id, 'product_created', value.name);
    res.status(201).json(loadProduct(id, todayUTC()));
  });

  app.put('/api/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!q.product.get(id)) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const { ok, errors, value } = validateProduct(req.body);
    if (!ok) return res.status(400).json({ errors });
    q.updateProduct.run(
      value.name, value.category, value.unit, value.location,
      value.warn_days, value.freeze_days, value.notes, id
    );
    q.logEvent.run(null, id, 'product_updated', value.name);
    res.json(loadProduct(id, todayUTC()));
  });

  app.delete('/api/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!q.product.get(id)) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    q.deleteProduct.run(id);
    res.status(204).end();
  });

  /* ---------- Chargen ---------- */
  app.post('/api/products/:id/batches', (req, res) => {
    const id = Number(req.params.id);
    if (!q.product.get(id)) return res.status(404).json({ error: 'Produkt nicht gefunden.' });
    const { ok, errors, value } = validateBatch(req.body);
    if (!ok) return res.status(400).json({ errors });
    const info = q.insertBatch.run(id, value.quantity, value.best_before, value.frozen_on, value.note);
    const batchId = Number(info.lastInsertRowid);
    q.logEvent.run(batchId, id, 'batch_created',
      `${value.quantity} · MHD ${value.best_before}${value.frozen_on ? ` · eingefroren ${value.frozen_on}` : ''}`);
    res.status(201).json(decorateBatch(q.batch.get(batchId), q.product.get(id), todayUTC()));
  });

  app.put('/api/batches/:id', (req, res) => {
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

  app.post('/api/batches/:id/freeze', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    if (existing.frozen_on) return res.status(409).json({ error: 'Charge ist bereits eingefroren.' });
    const on = isValidDate(req.body?.frozen_on) ? req.body.frozen_on : todayUTC();
    q.updateBatch.run(
      existing.quantity, existing.best_before, on, existing.note, id
    );
    q.logEvent.run(id, existing.product_id, 'batch_frozen', `eingefroren am ${on}`);
    res.json(decorateBatch(q.batch.get(id), q.product.get(existing.product_id), todayUTC()));
  });

  app.put('/api/batches/:id/quantity', (req, res) => {
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

  app.delete('/api/batches/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = q.batch.get(id);
    if (!existing) return res.status(404).json({ error: 'Charge nicht gefunden.' });
    q.deleteBatch.run(id);
    q.logEvent.run(null, existing.product_id, 'batch_deleted', `MHD ${existing.best_before}`);
    res.status(204).end();
  });

  /* ---------- Einstellungen & Export ---------- */
  app.get('/api/settings', (_req, res) => {
    res.json({ warn_days: defaultWarn() });
  });

  app.put('/api/settings', (req, res) => {
    const n = Number(req.body?.warn_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      return res.status(400).json({ errors: ['warn_days muss eine ganze Zahl zwischen 0 und 365 sein.'] });
    }
    q.setSetting.run('warn_days', String(n));
    res.json({ warn_days: n });
  });

  app.get('/api/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="mhd-export-${todayUTC()}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      version: 2,
      warn_days: defaultWarn(),
      products: q.products.all().map((p) => ({ ...p, batches: q.batchesOf.all(p.id) })),
    });
  });

  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    console.error('[mhd] Fehler:', err.message);
    res.status(500).json({ error: 'Interner Fehler.' });
  });

  return { app, db };
}
