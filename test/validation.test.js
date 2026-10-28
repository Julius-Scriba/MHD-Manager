// Tests für Validierung + Statuslogik (keine DB nötig)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, daysUntil, statusOf, validateProduct, todayUTC } from '../src/validation.js';

test('isValidDate akzeptiert echte Daten', () => {
  assert.equal(isValidDate('2026-10-28'), true);
  assert.equal(isValidDate('2024-02-29'), true); // Schaltjahr
});

test('isValidDate lehnt Unsinn ab', () => {
  for (const bad of ['2026-02-31', '28.10.2026', '', '2026-13-01', null, 20261028]) {
    assert.equal(isValidDate(bad), false, `sollte ungültig sein: ${bad}`);
  }
});

test('daysUntil rechnet in UTC-Tagen', () => {
  assert.equal(daysUntil('2026-10-28', '2026-10-28'), 0);
  assert.equal(daysUntil('2026-10-29', '2026-10-28'), 1);
  assert.equal(daysUntil('2026-10-27', '2026-10-28'), -1);
  assert.equal(daysUntil('2027-10-28', '2026-10-28'), 365);
});

test('statusOf vergibt die richtigen Buckets', () => {
  assert.equal(statusOf(-1), 'expired');
  assert.equal(statusOf(0), 'urgent');
  assert.equal(statusOf(2), 'urgent');
  assert.equal(statusOf(3), 'soon');
  assert.equal(statusOf(7), 'soon');
  assert.equal(statusOf(8), 'ok');
  assert.equal(statusOf(null), 'unknown');
  assert.equal(statusOf(5, 3), 'ok');
});

test('validateProduct: Minimum ist Name + MHD', () => {
  const ok = validateProduct({ name: 'Hafermilch', best_before: '2026-11-01' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.quantity, 1);
  assert.equal(ok.value.unit, 'Stk');
  assert.equal(ok.value.opened_on, null);

  const bad = validateProduct({ name: '  ', best_before: 'morgen' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
});

test('validateProduct normalisiert Eingaben', () => {
  const r = validateProduct({
    name: '  Joghurt  ',
    best_before: '2026-11-10',
    quantity: '4',
    unit: 'Stk',
    opened_on: '',
    category: 'Milchprodukte',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Joghurt');
  assert.equal(r.value.quantity, 4);
  assert.equal(r.value.opened_on, null);
});

test('validateProduct lehnt kaputte Mengen und Einheiten ab', () => {
  assert.equal(validateProduct({ name: 'X', best_before: '2026-11-10', quantity: -3 }).ok, false);
  assert.equal(validateProduct({ name: 'X', best_before: '2026-11-10', quantity: 'viel' }).ok, false);
  assert.equal(validateProduct({ name: 'X', best_before: '2026-11-10', unit: 'Eimer' }).ok, false);
});

test('todayUTC liefert YYYY-MM-DD', () => {
  assert.match(todayUTC(), /^\d{4}-\d{2}-\d{2}$/);
});
