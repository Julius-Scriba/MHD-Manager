// Tests: Validierung, Statuslogik, Einfrier-Fristen
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDate, daysUntil, statusOf, validateProduct, validateBatch,
  freezeDeadline, freezeStatus, addDays, todayUTC,
} from '../src/validation.js';

test('isValidDate akzeptiert echte Daten, lehnt Unsinn ab', () => {
  assert.equal(isValidDate('2026-10-28'), true);
  assert.equal(isValidDate('2024-02-29'), true);
  for (const bad of ['2026-02-31', '28.10.2026', '', '2026-13-01', null, 20261028]) {
    assert.equal(isValidDate(bad), false, `sollte ungültig sein: ${bad}`);
  }
});

test('daysUntil und addDays rechnen in UTC', () => {
  assert.equal(daysUntil('2026-10-29', '2026-10-28'), 1);
  assert.equal(daysUntil('2026-10-27', '2026-10-28'), -1);
  assert.equal(addDays('2026-10-28', -2), '2026-10-26');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

test('statusOf: abgelaufen / dringend / bald / ok', () => {
  assert.equal(statusOf(-1), 'expired');
  assert.equal(statusOf(0), 'urgent');
  assert.equal(statusOf(1, 2), 'soon');
  assert.equal(statusOf(2, 2), 'soon');
  assert.equal(statusOf(3, 2), 'ok');
  assert.equal(statusOf(7, 7), 'soon');
  assert.equal(statusOf(8, 7), 'ok');
  assert.equal(statusOf(null), 'unknown');
});

test('freezeDeadline zieht den Vorlauf vom MHD ab', () => {
  assert.equal(freezeDeadline('2026-10-30', 2), '2026-10-28');
  assert.equal(freezeDeadline('2026-10-30', 0), '2026-10-30');
  assert.equal(freezeDeadline('2026-10-30', null), null);
  assert.equal(freezeDeadline('2026-13-01', 2), null);
});

test('freezeStatus deckt alle Fälle ab', () => {
  const base = { bestBefore: '2026-10-30', freezeDays: 2 };
  // Frist ist der 28.10. — heute der 28.10. → fällig
  assert.equal(freezeStatus({ ...base }, '2026-10-28'), 'due');
  // gestern wäre die Frist gewesen → überfällig, MHD noch nicht vorbei
  assert.equal(freezeStatus({ ...base }, '2026-10-29'), 'due');
  // Frist noch nicht erreicht
  assert.equal(freezeStatus({ ...base }, '2026-10-26'), 'window');
  // eingefroren
  assert.equal(freezeStatus({ ...base, frozenOn: '2026-10-27' }, '2026-10-28'), 'frozen');
  // kein Einfrieren vorgesehen
  assert.equal(freezeStatus({ bestBefore: '2026-10-30', freezeDays: null }, '2026-10-28'), 'none');
  // Frist UND MHD vorbei
  assert.equal(freezeStatus({ ...base }, '2026-11-02'), 'missed');
});

test('validateProduct: Name Pflicht, Warnzeit und Vorlauf optional', () => {
  const ok = validateProduct({ name: 'Hackfleisch' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.unit, 'kg');
  assert.equal(ok.value.warn_days, null);
  assert.equal(ok.value.freeze_days, null);

  assert.equal(validateProduct({ name: '  ' }).ok, false);
  assert.equal(validateProduct({ name: 'X', warn_days: -1 }).ok, false);
  assert.equal(validateProduct({ name: 'X', warn_days: 1.5 }).ok, false);
  assert.equal(validateProduct({ name: 'X', freeze_days: 99 }).ok, false);
  assert.equal(validateProduct({ name: 'X', unit: 'Eimer' }).ok, false);

  const withRules = validateProduct({ name: 'Hack', warn_days: '2', freeze_days: '1', unit: 'kg' });
  assert.equal(withRules.ok, true);
  assert.equal(withRules.value.warn_days, 2);
  assert.equal(withRules.value.freeze_days, 1);
});

test('validateBatch: MHD Pflicht, Menge numerisch, Einfrieren optional', () => {
  const ok = validateBatch({ best_before: '2026-11-01', quantity: 4.5 });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.frozen_on, null);

  assert.equal(validateBatch({ best_before: 'morgen', quantity: 1 }).ok, false);
  assert.equal(validateBatch({ best_before: '2026-11-01', quantity: -1 }).ok, false);
  assert.equal(validateBatch({ best_before: '2026-11-01', frozen_on: '31.10.2026' }).ok, false);

  const frozen = validateBatch({ best_before: '2026-11-01', quantity: 2, frozen_on: '2026-10-28' });
  assert.equal(frozen.ok, true);
  assert.equal(frozen.value.frozen_on, '2026-10-28');
});

test('todayUTC liefert YYYY-MM-DD', () => {
  assert.match(todayUTC(), /^\d{4}-\d{2}-\d{2}$/);
});
