// mhd-manager · Validierung + Statuslogik (ohne DB, testbar)
export const UNITS = ['kg', 'g', 'Stk', 'Pkg', 'l', 'ml', 'Dose', 'Flasche'];
export const PACES = ['schnell', 'mittel', 'langsam'];

/**
 * Prüf-Intervall in Tagen je Verkaufstempo (Bestandskontrolle).
 * Kurzlebige Ware (Fleisch, Milch, Salat) dreht schnell um → wöchentlich.
 * Lange liegende Ware braucht keinen engen Rhythmus.
 */
export const PACE_CHECK_DAYS = { schnell: 7, mittel: 14, langsam: 30 };

export function checkIntervalDays(product, fallback = 14) {
  if (Number.isInteger(product.check_days) && product.check_days >= 1) return product.check_days;
  const fromPace = PACE_CHECK_DAYS[product.pace];
  if (Number.isInteger(fromPace)) return fromPace;
  return fallback;
}

/** Warnzeit-Vorschlag je Verkaufstempo (Tage vor MHD). Manueller Wert überschreibt. */
export const PACE_WARN_DAYS = { schnell: 1, mittel: 3, langsam: 14 };

/**
 * Warnzeit nach Absatzmenge: Wie viele Tage braucht man, um die vorhandene Menge
 * loszuwerden? Tempo allein reicht nicht — 48 Päckchen gehen nicht in 48 Stunden
 * weg, auch wenn es "schnell" verkaufte Ware ist.
 *
 * Gezählt wird in Stück je Tag. Ein Tempo von "schnell" heißt hier 1 Stück/Tag,
 * "mittel" 1 Stück je 2 Tage, "langsam" 1 Stück je 7 Tage — also die Kehrwerte
 * der Vorschlagstage. Bei 21 Stück und mittlerem Tempo läuft das 42 Tage.
 */
export const PACE_UNITS_PER_DAY = { schnell: 1, mittel: 0.5, langsam: 1 / 7 };

/**
 * Effektive Warnzeit = Maximum aus manuell/aus Tempo gesetzter Warnzeit und
 * der Absatzdauer des Bestands. Gedeckelt, damit ein großer Bestand nicht
 * Monate im Voraus "bald fällig" meldet.
 */
export function warnDaysForStock(product, stock, warnedByPace, cap = 60) {
  const perDay = PACE_UNITS_PER_DAY[product.pace] ?? 0.5;
  if (!Number.isFinite(stock) || stock <= 0) return warnedByPace;
  const daysToSellOut = Math.ceil(stock / perDay);
  return Math.min(cap, Math.max(warnedByPace, daysToSellOut));
}

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

/** Effektive Warnzeit: manueller Wert gewinnt, sonst Vorschlag aus dem Verkaufstempo. */
export function effectiveWarnDays(product, fallbackWarnDays = 7) {
  if (Number.isInteger(product.warn_days) && product.warn_days >= 0) return product.warn_days;
  const fromPace = PACE_WARN_DAYS[product.pace];
  if (Number.isInteger(fromPace)) return fromPace;
  return fallbackWarnDays;
}

/** Letzter Tag, an dem eine Charge noch eingefroren werden darf. */
export function freezeDeadline(bestBefore, freezeDays) {
  if (!Number.isFinite(freezeDays) || freezeDays < 0) return null;
  if (!isValidDate(bestBefore)) return null;
  return addDays(bestBefore, -freezeDays);
}

/** TK-MHD: Einfriertag + TK-Haltbarkeit in Tagen. */
export function frozenBestBefore(frozenOn, tkDays) {
  if (!isValidDate(frozenOn)) return null;
  if (!Number.isFinite(tkDays) || tkDays <= 0) return null;
  return addDays(frozenOn, tkDays);
}

/**
 * freeze_status:
 *   none      – kein Einfrieren vorgesehen
 *   frozen    – bereits eingefroren
 *   due       – jetzt einfrieren (Frist erreicht/überschritten, noch nicht eingefroren)
 *   window    – Frist läuft, noch Zeit
 *   missed    – Frist vorbei und Frisch-MHD vorbei
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

  const pace = str(body.pace, 20, 'mittel') || 'mittel';
  if (!PACES.includes(pace)) errors.push('Verkaufstempo unbekannt.');

  const warn_days = intOrNull(body.warn_days, 0, 365);
  if (warn_days === undefined) errors.push('Warnzeit muss eine ganze Zahl zwischen 0 und 365 sein (leer = aus Verkaufstempo).');

  const freeze_days = intOrNull(body.freeze_days, 0, 60);
  if (freeze_days === undefined) errors.push('Einfrier-Vorlauf muss eine ganze Zahl zwischen 0 und 60 sein (leer = kein Einfrieren).');

  const tk_days = intOrNull(body.tk_days, 1, 3650);
  if (tk_days === undefined) errors.push('TK-Haltbarkeit muss eine ganze Zahl zwischen 1 und 3650 Tagen sein.');

  const check_days = intOrNull(body.check_days, 1, 365);
  if (check_days === undefined) {
    errors.push('Prüf-Intervall muss eine ganze Zahl zwischen 1 und 365 Tagen sein (leer = aus Verkaufstempo).');
  }

  if (freeze_days !== null && freeze_days !== undefined && (tk_days === null || tk_days === undefined)) {
    errors.push('Wenn eingefroren werden kann, muss die TK-Haltbarkeit in Tagen angegeben werden.');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      name,
      category: str(body.category, 60),
      unit,
      location: str(body.location, 60),
      pace,
      warn_days,
      freeze_days,
      tk_days,
      check_days,
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
    value: { quantity, best_before, frozen_on, note: str(body.note, 300) },
  };
}

/** Kategorie-Name validieren. */
export function validateCategoryName(raw) {
  const name = str(raw, 60);
  if (!name) return { ok: false, error: 'Kategoriename ist Pflichtfeld.' };
  if (name.length < 2) return { ok: false, error: 'Kategoriename braucht mindestens 2 Zeichen.' };
  return { ok: true, value: name };
}
