// mhd-manager · Validierung + Statuslogik (ohne DB, testbar)
export const UNITS = ['kg', 'g', 'Stk', 'Pkg', 'l', 'ml', 'Dose', 'Flasche'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(dateStr, today = todayUTC()) {
  if (!isValidDate(dateStr)) return null;
  const a = Date.parse(dateStr + 'T00:00:00Z');
  const b = Date.parse(today + 'T00:00:00Z');
  return Math.round((a - b) / 86_400_000);
}

export function statusOf(days, warnDays = 7) {
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days === 0) return 'urgent';
  if (days <= warnDays) return 'soon';
  return 'ok';
}

/**
 * Frist zum Einfrieren: letzter Tag, an dem noch eingefroren werden darf.
 * null = für dieses Produkt ist Einfrieren nicht vorgesehen.
 */
export function freezeDeadline(bestBefore, freezeDays) {
  if (!Number.isFinite(freezeDays) || freezeDays < 0) return null;
  if (!isValidDate(bestBefore)) return null;
  return addDays(bestBefore, -freezeDays);
}

/**
 * freeze_status:
 *   none     – kein Einfrieren vorgesehen
 *   frozen   – bereits eingefroren
 *   due      – jetzt einfrieren (Frist erreicht/überschritten, noch nicht eingefroren)
 *   window   – Frist läuft, noch Zeit
 *   missed   – Frist vorbei und MHD vorbei
 */
export function freezeStatus({ bestBefore, freezeDays, frozenOn }, today = todayUTC()) {
  if (frozenOn) return 'frozen';
  const deadline = freezeDeadline(bestBefore, freezeDays);
  if (!deadline) return 'none';
  const left = daysUntil(deadline, today);
  const mhdLeft = daysUntil(bestBefore, today);
  if (left < 0) return mhdLeft < 0 ? 'missed' : 'due';
  return left === 0 ? 'due' : 'window';
}

const intOrNull = (v, min, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

const str = (v, max, fallback = '') => {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
};

/** Produktstamm validieren. */
export function validateProduct(body = {}) {
  const errors = [];
  const name = str(body.name, 120);
  if (!name) errors.push('Name ist Pflichtfeld.');

  const unit = str(body.unit, 20, 'kg') || 'kg';
  if (!UNITS.includes(unit)) errors.push('Einheit unbekannt.');

  const warn_days = intOrNull(body.warn_days, 0, 365);
  if (warn_days === undefined) errors.push('Warnzeit muss eine ganze Zahl zwischen 0 und 365 sein.');

  const freeze_days = intOrNull(body.freeze_days, 0, 60);
  if (freeze_days === undefined) errors.push('Einfrier-Vorlauf muss eine ganze Zahl zwischen 0 und 60 sein (leer = kein Einfrieren).');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      name,
      category: str(body.category, 60),
      unit,
      location: str(body.location, 60),
      warn_days,
      freeze_days,
      notes: str(body.notes, 500),
    },
  };
}

/** Charge validieren. */
export function validateBatch(body = {}) {
  const errors = [];

  const best_before = str(body.best_before, 10);
  if (!best_before) errors.push('MHD ist Pflichtfeld.');
  else if (!isValidDate(best_before)) errors.push('MHD muss ein gültiges Datum (YYYY-MM-DD) sein.');

  let quantity = Number(body.quantity === undefined || body.quantity === '' ? 0 : body.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999) {
    errors.push('Menge muss eine Zahl zwischen 0 und 999999 sein.');
    quantity = 0;
  }

  const frozen_on = str(body.frozen_on, 10) || null;
  if (frozen_on && !isValidDate(frozen_on)) errors.push('Eingefroren am muss ein gültiges Datum sein.');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      quantity,
      best_before,
      frozen_on,
      note: str(body.note, 300),
    },
  };
}
