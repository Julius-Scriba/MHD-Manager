// mhd-manager · Validierung + Hilfsfunktionen (ohne DB-Abhängigkeit, testbar)
export const UNITS = ['Stk', 'g', 'kg', 'ml', 'l', 'Pkg', 'Dose', 'Flasche'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  // Round-Trip schützt gegen 2026-02-31 usw.
  return d.toISOString().slice(0, 10) === value;
}

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function daysUntil(dateStr, today = todayUTC()) {
  if (!isValidDate(dateStr)) return null;
  const a = Date.parse(dateStr + 'T00:00:00Z');
  const b = Date.parse(today + 'T00:00:00Z');
  return Math.round((a - b) / 86_400_000);
}

/**
 * Status eines Produkts relativ zu heute.
 * expired  = MHD vorbei (negativ)
 * urgent   = heute / morgen / übermorgen (0..2)
 * soon     = innerhalb der Vorwarnzeit (default 7)
 * ok       = alles danach
 */
export function statusOf(days, warnDays = 7) {
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 2) return 'urgent';
  if (days <= warnDays) return 'soon';
  return 'ok';
}

function str(value, maxLen, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Validiert einen Produkt-Payload. Liefert { ok, errors, value }. */
export function validateProduct(body = {}) {
  const errors = [];
  const name = str(body.name, 120);
  if (!name) errors.push('Name ist Pflichtfeld.');

  const best_before = str(body.best_before, 10);
  if (!best_before) errors.push('MHD (Datum) ist Pflichtfeld.');
  else if (!isValidDate(best_before)) errors.push('MHD muss ein gültiges Datum im Format YYYY-MM-DD sein.');

  const opened_on = str(body.opened_on, 10) || null;
  if (opened_on && !isValidDate(opened_on)) errors.push('Angebrochen am muss ein gültiges Datum sein.');

  let quantity = Number(body.quantity === undefined || body.quantity === '' ? 1 : body.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 99999) {
    errors.push('Menge muss eine Zahl zwischen 0 und 99999 sein.');
    quantity = 1;
  }

  const unit = str(body.unit, 20, 'Stk') || 'Stk';
  if (!UNITS.includes(unit)) errors.push('Einheit unbekannt.');

  const value = {
    name,
    category: str(body.category, 60),
    location: str(body.location, 60),
    quantity,
    unit,
    best_before,
    opened_on,
    notes: str(body.notes, 500),
  };
  return { ok: errors.length === 0, errors, value };
}
