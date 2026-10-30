/* Product Manager · Hersteller: Liste, Detailseite mit Kontakt und Produkten */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const fmtQty = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : String(Number(n).toFixed(2)).replace('.', ','));

const state = {
  makers: [], products: [], cats: [], locations: [], counts: {}, today: '',
  search: '', current: null, open: new Set(),
  editingProductId: null, editBatch: null, batchParent: null,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 401) {
    window.location.replace('/login.html');
    throw new Error('Nicht angemeldet.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Server liefert {errors:[...]} oder {error:"..."} — beides brauchbar machen
    throw new Error((data.errors && data.errors.join(' ')) || data.error || `Fehler ${res.status}`);
  }
  return data;
}

/* ---------- Liste ---------- */
async function loadList() {
  const [data, cats] = await Promise.all([api('/api/manufacturers'), api('/api/categories')]);
  state.makers = data.manufacturers;
  state.cats = cats.categories;
  state.locations = cats.locations || [];
  renderList();
}

function visibleMakers() {
  const term = state.search.trim().toLowerCase();
  if (!term) return state.makers;
  return state.makers.filter((m) => [m.name, m.city, m.contact_name, m.email, m.phone]
    .some((f) => String(f || '').toLowerCase().includes(term)));
}

function renderList() {
  const list = visibleMakers();
  const box = $('#maker-list');
  $('#maker-subline').textContent = state.makers.length
    ? `${state.makers.length} ${state.makers.length === 1 ? 'Hersteller' : 'Hersteller'} · ${state.makers.reduce((s, m) => s + m.product_count, 0)} Produkte`
    : 'Noch keine Hersteller erfasst';
  const empty = $('#maker-empty');
  if (!list.length) {
    box.innerHTML = '';
    empty.hidden = false;
    empty.textContent = state.makers.length
      ? 'Kein Hersteller passt zur Suche.'
      : 'Noch keine Hersteller — leg den ersten über „Hersteller" an.';
    return;
  }
  empty.hidden = true;
  box.innerHTML = list.map((m) => `
    <li class="maker-item" data-id="${m.id}">
      <a class="maker-link" href="/manufacturers/${m.id}">
        <span class="maker-name">${esc(m.name)}</span>
        <span class="maker-sub">${[
          m.product_count ? `${m.product_count} ${m.product_count === 1 ? 'Produkt' : 'Produkte'}` : 'keine Produkte',
          m.city ? esc(m.city) : '',
          m.order_note ? esc(m.order_note) : '',
        ].filter(Boolean).join(' · ')}</span>
      </a>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </li>`).join('');
}

$('#maker-search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderList();
});

/* ---------- Detail ---------- */
async function loadDetail(id) {
  const data = await api(`/api/manufacturers/${id}`);
  state.current = data.manufacturer;
  state.products = data.products;
  state.today = data.today || state.today;
  state.open = new Set();
  renderDetail();
}

function fact(label, html) {
  if (!html) return '';
  return `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
}

function renderDetail() {
  const m = state.current;
  $('#detail-name').textContent = m.name;
  $('#detail-sub').textContent = [
    `${m.product_count} ${m.product_count === 1 ? 'Produkt' : 'Produkte'}`,
    m.city,
    m.order_note,
  ].filter(Boolean).join(' · ');

  const addr = [m.street, [m.postal_code, m.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const webHref = m.website
    ? (/^https?:/i.test(m.website) ? m.website : `https://${m.website}`)
    : '';

  const facts = [
    fact('Ansprechpartner', m.contact_name ? esc(m.contact_name) : ''),
    fact('Telefon', m.phone
      ? `<a href="tel:${esc(m.phone.replace(/\s/g, ''))}">${esc(m.phone)}</a>` : ''),
    fact('E-Mail', m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''),
    fact('Adresse', addr ? esc(addr) : ''),
    fact('Website', webHref
      ? `<a href="${esc(webHref)}" target="_blank" rel="noopener">${esc(m.website)}</a>` : ''),
    fact('Bestellvorlauf', m.order_lead_days !== null && m.order_lead_days !== undefined
      ? `${esc(m.order_lead_days)} Tage` : ''),
    fact('Bestellrhythmus', m.order_note ? esc(m.order_note) : ''),
    fact('Lieferung', m.delivery_note ? esc(m.delivery_note) : ''),
  ].join('');

  $('#maker-facts').innerHTML = facts
    || '<div><dt>Kontakt</dt><dd>Noch nichts hinterlegt — über „Bearbeiten" ergänzen.</dd></div>';

  const notes = $('#maker-notes');
  if (m.notes) { notes.textContent = `Notiz: ${m.notes}`; notes.hidden = false; }
  else notes.hidden = true;

  // Löschen nur anbieten, wenn keine Produkte hängen (Server lehnt es sonst ab)
  $('#btn-del-maker').hidden = m.product_count > 0;

  renderMakerProducts();
}

function renderMakerProducts() {
  const box = $('#maker-products');
  const empty = $('#maker-products-empty');
  if (!state.products.length) {
    box.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  box.innerHTML = state.products.map(cardHtml).join('');
}

function statusChipOf(b) {
  if (b.freeze_status === 'due') return `<span class="chip freeze">bis ${fmtDate(b.freeze_deadline)} einfrieren</span>`;
  if (b.freeze_status === 'missed') return '<span class="chip freeze">einfrieren verpasst</span>';
  const status = b.post_freeze_status || b.status;
  const days = b.post_freeze_status ? b.tk_days_left : b.days_left;
  const label = status === 'expired' ? `abgelaufen (${Math.abs(days)} T.)`
    : status === 'urgent' ? 'heute fällig'
    : status === 'soon' ? `in ${days} T.`
    : 'haltbar';
  const tk = (b.frozen_on || b.tk_best_before) ? '<span class="chip freeze">TK</span>' : '';
  return `<span class="chip ${status}">${label}</span>${tk}`;
}

function canFreeze(p) {
  return p.freeze_days !== null && p.freeze_days !== undefined && p.tk_days;
}

/**
 * Karte in der Herstelleransicht: alle Aktionen der Gesamtübersicht
 * (Charge anlegen, zählen, einfrieren, bearbeiten, löschen, Produkt bearbeiten
 * und löschen) plus ein Link in die volle Produktdetailseite.
 */
function cardHtml(p) {
  const open = state.open.has(p.id);
  const unit = esc(p.unit);
  const nextMhd = p.next_best_before ? `<span class="next">nächstes MHD ${fmtDate(p.next_best_before)}</span>` : '';
  const checkChip = p.batches.some((b) => b.quantity > 0 && b.check_due)
    ? '<span class="chip check-due">prüfen</span>' : '';
  const batches = p.batches.length
    ? p.batches.map((b) => batchHtml(b, p)).join('')
    : '<div class="batch-empty">Noch keine Charge erfasst.</div>';

  const facts = [
    ['Ort', p.location],
    ['Kategorie', p.category],
  ].filter(([, v]) => v);

  const rules = [];
  if (p.warn_days_stock > p.warn_days_effective) {
    rules.push(`Warnung ab ${p.warn_days_effective} T. (bei ${fmtQty(p.total_quantity)} ${p.unit} Bestand: ${p.warn_days_stock} T.)`);
  } else {
    rules.push(`Warnung ab ${p.warn_days_effective} T. vor MHD`);
  }
  rules.push(p.freeze_days === null || p.freeze_days === undefined
    ? 'Einfrieren nicht vorgesehen'
    : `einfrieren bis ${p.freeze_days} T. vor MHD` + (p.tk_days ? ` · TK ${p.tk_days} T.` : ''));
  if (p.notes) rules.push(`Notiz: ${p.notes}`);

  return `<article class="card ${open ? 'open' : ''}" data-worst="${p.worst_status}" data-id="${p.id}">
    <button class="card-head" type="button" data-act="toggle" aria-expanded="${open}">
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="card-title">
        <div class="name">${esc(p.name)}</div>
        <div class="card-sub"><span class="qty">${fmtQty(p.total_quantity)} ${unit}</span>${nextMhd}</div>
      </div>
      <div class="card-flags">${checkChip}${p.freeze_due_count ? `<span class="chip freeze">${p.freeze_due_count}× TK</span>` : ''}</div>
    </button>
    <div class="batches">
      <div class="prod-detail">
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        <p class="rules">${rules.map((r) => esc(r)).join(' · ')}</p>
        <div class="prod-actions">
          <a class="btn ghost small" href="/products/${p.id}" data-act="open-product">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Details</span>
          </a>
          <button class="btn ghost small" type="button" data-act="edit-product">Bearbeiten</button>
          <button class="btn ghost small danger" type="button" data-act="del-product">Löschen</button>
        </div>
      </div>
      ${batches}
      <div class="add-batch"><button class="btn ghost small" type="button" data-act="add-batch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Charge</button></div>
    </div>
  </article>`;
}

function batchHtml(b, p) {
  const useTk = Boolean(b.tk_best_before);
  const days = useTk ? b.tk_days_left : b.days_left;
  const dayBig = days < 0 ? Math.abs(days) : days;
  const dayUnit = days < 0 ? (Math.abs(days) === 1 ? 'Tag her' : 'Tage her') : days === 0 ? 'heute' : (days === 1 ? 'Tag' : 'Tage');
  const dateLine = useTk ? `TK-MHD ${fmtDate(b.tk_best_before)}` : `Frisch-MHD ${fmtDate(b.best_before)}`;
  const info = [
    dateLine,
    `<span>${fmtQty(b.quantity)} ${esc(p.unit)}</span>`,
    b.frozen_on ? `eingefroren ${fmtDate(b.frozen_on)}` : '',
    b.note ? esc(b.note) : '',
  ].filter(Boolean).join(' · ');

  // Einfrieren nur anbieten, solange die Frist läuft
  const freezeBtn = (canFreeze(p) && !b.frozen_on && b.freeze_status === 'due')
    ? '<button class="btn freeze small" type="button" data-act="freeze">Einfrieren</button>' : '';

  return `<div class="batch" data-status="${b.status}" data-batch="${b.id}">
    <div class="days"><div class="d">${dayBig}</div><div class="u">${dayUnit}</div></div>
    <div class="batch-info">
      <div class="l1">${esc(p.name)} ${statusChipOf(b)}</div>
      <div class="l2">${info}</div>
    </div>
    <div class="batch-actions">
      ${b.quantity > 0 || b.check_due
        ? `<button class="btn ghost small" type="button" data-act="check-batch" title="Bestand zählen">${b.check_due ? 'Zählen' : 'Gezählt'}</button>` : ''}
      ${freezeBtn}
      <span class="icon-btn" role="button" tabindex="0" data-act="edit-batch" title="Charge bearbeiten" aria-label="Charge bearbeiten">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18 10l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      </span>
      <span class="icon-btn danger" role="button" tabindex="0" data-act="del-batch" title="Charge löschen" aria-label="Charge löschen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </div>
  </div>`;
}

/* ---------- Aktionen auf den Karten ---------- */
const UNITS = ['kg', 'g', 'Stk', 'Pkg', 'l', 'ml', 'Dose', 'Flasche'];
const PACES = ['schnell', 'mittel', 'langsam'];
const PACE_LABELS = {
  schnell: 'schnell (Fleisch, Frischware)',
  mittel: 'mittel (Molkerei, Feinkost)',
  langsam: 'langsam (Haltbares)',
};
const PACE_HINT = {
  schnell: 'Warnung 1 Tag vor MHD, Bestand prüfen jede Woche — für Ware, die schnell weggeht.',
  mittel: 'Warnung 3 Tage vor MHD, Bestand prüfen alle 14 Tage.',
  langsam: 'Warnung 14 Tage vor MHD, Bestand prüfen alle 30 Tage — für Ware, die lange liegt.',
};

const productDialog = $('#product-dialog');
const productForm = $('#product-form');
const batchDialog = $('#batch-dialog');
const batchForm = $('#batch-form');
const checkDialog = $('#check-dialog');
const checkForm = $('#check-form');
let checkTarget = null;

$('#mk-unit').innerHTML = UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');
$('#mk-pace').innerHTML = PACES.map((v) => `<option value="${v}">${PACE_LABELS[v]}</option>`).join('');

const updateMakerPaceHint = () => {
  $('#mk-pace-hint').textContent = PACE_HINT[$('#mk-pace').value] || '';
};
$('#mk-pace').addEventListener('change', updateMakerPaceHint);

function categorySchemaOf(name) {
  const hit = state.cats.find((c) => c.name === name);
  return (hit && hit.schema) || { freezeable: false, warnDays: 7, pace: 'mittel' };
}

function fillMakerCategorySelect(selected) {
  const sel = $('#mk-category');
  sel.innerHTML = ['<option value="">— wählen —</option>']
    .concat(state.cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`))
    .join('');
  if (selected && !state.cats.some((c) => c.name === selected)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(selected)}">${esc(selected)}</option>`);
  }
  sel.value = selected || '';
}

function fillMakerLocationSelect(selected) {
  const sel = $('#mk-location');
  const known = new Set(state.locations || []);
  for (const p of state.products) if (p.location) known.add(p.location);
  sel.innerHTML = ['<option value="">— keiner —</option>']
    .concat([...known].sort((a, b) => a.localeCompare(b, 'de'))
      .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`))
    .concat('<option value="__new_location__">+ Neuer Ort …</option>')
    .join('');
  if (selected && !known.has(selected)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(selected)}">${esc(selected)}</option>`);
  }
  sel.value = selected || '';
  $('#mk-new-location-wrap').hidden = true;
  productForm.new_location.value = '';
}

$('#mk-location').addEventListener('change', (e) => {
  const isNew = e.target.value === '__new_location__';
  $('#mk-new-location-wrap').hidden = !isNew;
  if (isNew) setTimeout(() => productForm.new_location.focus(), 20);
});

function applyMakerCategorySchema() {
  const schema = categorySchemaOf($('#mk-category').value);
  $('#mk-freeze-wrap').hidden = !schema.freezeable;
  $('#mk-tk-wrap').hidden = !schema.freezeable;
  if (!schema.freezeable) {
    productForm.freeze_days.value = '';
    productForm.tk_days.value = '';
  }
  $('#mk-category-note').textContent = schema.freezeable
    ? 'Diese Kategorie kann eingefroren werden — Einfrier-Vorlauf und TK-Haltbarkeit sind möglich.'
    : 'Diese Kategorie wird nicht eingefroren — keine TK-Felder.';
}

$('#mk-category').addEventListener('change', applyMakerCategorySchema);

function openMakerProductDialog(product) {
  state.editingProductId = product.id;
  productForm.reset();
  $('#product-error').hidden = true;
  $('#product-title').textContent = `Produkt bearbeiten — ${product.name}`;
  fillMakerCategorySelect(product.category || '');
  fillMakerLocationSelect(product.location || '');
  productForm.name.value = product.name;
  $('#mk-unit').value = product.unit;
  $('#mk-pace').value = product.pace || 'mittel';
  productForm.warn_days.value = product.warn_days ?? '';
  productForm.freeze_days.value = product.freeze_days ?? '';
  productForm.tk_days.value = product.tk_days ?? '';
  productForm.check_days.value = product.check_days ?? '';
  productForm.notes.value = product.notes || '';
  applyMakerCategorySchema();
  updateMakerPaceHint();
  productDialog.showModal();
}

$('#product-cancel').addEventListener('click', () => productDialog.close());

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(productForm).entries());
  const payload = {
    name: raw.name,
    category: raw.category,
    location: raw.location === '__new_location__' ? String(raw.new_location || '').trim() : raw.location,
    unit: raw.unit,
    pace: raw.pace,
    notes: raw.notes,
    warn_days: raw.warn_days === '' ? null : raw.warn_days,
    freeze_days: raw.freeze_days === '' ? null : raw.freeze_days,
    tk_days: raw.tk_days === '' ? null : raw.tk_days,
    check_days: raw.check_days === '' ? null : raw.check_days,
    // Hersteller bleibt der, auf dessen Seite wir gerade sind
    manufacturer_id: state.current ? state.current.id : null,
    manufacturer: state.current ? state.current.name : '',
  };
  const save = $('#product-save');
  save.disabled = true;
  try {
    await api(`/api/products/${state.editingProductId}`, { method: 'PUT', body: JSON.stringify(payload) });
    productDialog.close();
    await loadDetail(state.current.id);
  } catch (err) {
    $('#product-error').textContent = err.message;
    $('#product-error').hidden = false;
  } finally {
    save.disabled = false;
  }
});

function openBatchDialog(product, batch) {
  state.editBatch = batch || null;
  state.batchParent = product;
  $('#batch-title').textContent = batch ? 'Charge bearbeiten' : 'Neue Charge';
  $('#batch-sub').textContent = `${product.name}${product.tk_days ? ` · TK ${product.tk_days} Tage` : ''}`;
  $('#batch-unit').textContent = `(${product.unit})`;
  $('#batch-error').hidden = true;
  batchForm.reset();
  batchForm.quantity.value = '1';
  if (batch) {
    batchForm.best_before.value = batch.best_before;
    batchForm.quantity.value = batch.quantity;
    batchForm.frozen_on.value = batch.frozen_on || '';
    batchForm.note.value = batch.note || '';
  } else {
    batchForm.best_before.value = state.today;
  }
  batchDialog.showModal();
}

$('#batch-cancel').addEventListener('click', () => batchDialog.close());
batchDialog.addEventListener('close', () => { state.editBatch = null; state.batchParent = null; });

batchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(batchForm).entries());
  const payload = { ...raw, quantity: raw.quantity === '' ? 0 : raw.quantity };
  const save = $('#batch-save');
  save.disabled = true;
  try {
    if (state.editBatch) {
      await api(`/api/batches/${state.editBatch.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api(`/api/products/${state.batchParent.id}/batches`, { method: 'POST', body: JSON.stringify(payload) });
      state.open.add(state.batchParent.id);
    }
    batchDialog.close();
    await loadDetail(state.current.id);
  } catch (err) {
    $('#batch-error').textContent = err.message;
    $('#batch-error').hidden = false;
  } finally {
    save.disabled = false;
  }
});

function openCheckSheet(product, batch) {
  checkTarget = { product, batch };
  checkForm.reset();
  $('#check-error').hidden = true;
  $('#check-title').textContent = product.name;
  $('#check-sub').textContent = `Frisch-MHD ${fmtDate(batch.best_before)}${batch.frozen_on ? ` · eingefroren ${fmtDate(batch.frozen_on)}` : ''}`;
  $('#check-qty').value = String(batch.quantity);
  $('#check-hint').textContent = `Erfasst sind ${fmtQty(batch.quantity)} ${product.unit}. Stimmt die Zahl, einfach bestätigen.`;
  checkDialog.showModal();
  setTimeout(() => { $('#check-qty').focus(); $('#check-qty').select(); }, 40);
}

$('#check-cancel').addEventListener('click', () => checkDialog.close());
checkDialog.addEventListener('close', () => { checkTarget = null; });

checkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!checkTarget) return;
  const qty = Number($('#check-qty').value);
  if (!Number.isFinite(qty) || qty < 0) {
    $('#check-error').textContent = 'Bitte eine Menge ab 0 eingeben.';
    $('#check-error').hidden = false;
    return;
  }
  const btn = $('#check-save');
  btn.disabled = true;
  try {
    await api(`/api/batches/${checkTarget.batch.id}/check`, {
      method: 'POST',
      body: JSON.stringify({ quantity: qty }),
    });
    checkDialog.close();
    await loadDetail(state.current.id);
  } catch (err) {
    $('#check-error').textContent = err.message;
    $('#check-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Zentraler Klick-Handler ---------- */
$('#maker-products').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const productId = Number(card.dataset.id);
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;

  const actEl = e.target.closest('[data-act]');
  const act = actEl?.dataset.act;

  if (act === 'toggle' || !act) {
    if (state.open.has(productId)) state.open.delete(productId); else state.open.add(productId);
    card.classList.toggle('open');
    card.querySelector('.card-head').setAttribute('aria-expanded', String(state.open.has(productId)));
    return;
  }
  if (act === 'open-product') return; // normaler Link
  if (act === 'edit-product') { e.stopPropagation(); return openMakerProductDialog(product); }
  if (act === 'add-batch') { e.stopPropagation(); return openBatchDialog(product, null); }
  if (act === 'del-product') {
    e.stopPropagation();
    const n = product.batches.length;
    const warn = n
      ? `\n\nAchtung: ${n} ${n === 1 ? 'Charge wird' : 'Chargen werden'} ebenfalls gelöscht.`
      : '';
    if (!confirm(`„${product.name}" und alle Chargen endgültig löschen?${warn}`)) return;
    try {
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      state.open.delete(product.id);
      await loadDetail(state.current.id);
    } catch (err) { alert(err.message); }
    return;
  }

  const batchEl = e.target.closest('.batch');
  const batch = batchEl ? product.batches.find((b) => b.id === Number(batchEl.dataset.batch)) : null;

  if (act === 'freeze' && batch) {
    e.stopPropagation();
    actEl.disabled = true;
    try {
      await api(`/api/batches/${batch.id}/freeze`, { method: 'POST', body: JSON.stringify({}) });
      await loadDetail(state.current.id);
    } catch (err) {
      alert(err.message);
      actEl.disabled = false;
    }
    return;
  }
  if (act === 'edit-batch' && batch) { e.stopPropagation(); return openBatchDialog(product, batch); }
  if (act === 'del-batch' && batch) {
    e.stopPropagation();
    const txt = `Charge (Frisch-MHD ${fmtDate(batch.best_before)}, ${fmtQty(batch.quantity)} ${product.unit}) löschen?`;
    if (!confirm(txt)) return;
    try { await api(`/api/batches/${batch.id}`, { method: 'DELETE' }); await loadDetail(state.current.id); }
    catch (err) { alert(err.message); }
    return;
  }
  if (act === 'check-batch' && batch) {
    e.stopPropagation();
    return openCheckSheet(product, batch);
  }
});

$('#maker-products').addEventListener('keydown', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  t.click();
});

/* ---------- Tabs in der Detailansicht ---------- */
for (const tab of document.querySelectorAll('[data-mtab]')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('[data-mtab]')) t.classList.toggle('active', t === tab);
    for (const p of document.querySelectorAll('[data-mpanel]')) {
      p.hidden = p.dataset.mpanel !== tab.dataset.mtab;
    }
  });
}

/* ---------- Dialog ---------- */
const dialog = $('#maker-dialog');
const form = $('#maker-form');
let editId = null;

function openDialog(maker) {
  editId = maker ? maker.id : null;
  form.reset();
  $('#maker-error').hidden = true;
  $('#maker-form-title').textContent = maker ? 'Hersteller bearbeiten' : 'Neuer Hersteller';
  if (maker) {
    for (const key of ['name', 'contact_name', 'email', 'phone', 'street', 'postal_code', 'city',
      'website', 'order_note', 'delivery_note', 'notes']) {
      form.elements[key].value = maker[key] || '';
    }
    form.elements.order_lead_days.value = maker.order_lead_days ?? '';
  }
  dialog.showModal();
  setTimeout(() => form.elements.name.focus(), 40);
}

$('#btn-new-maker').addEventListener('click', () => openDialog(null));
$('#btn-edit-maker').addEventListener('click', () => openDialog(state.current));
$('#maker-cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { editId = null; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(form).entries());
  const payload = {
    name: raw.name,
    contact_name: raw.contact_name,
    email: raw.email,
    phone: raw.phone,
    street: raw.street,
    postal_code: raw.postal_code,
    city: raw.city,
    website: raw.website,
    order_lead_days: raw.order_lead_days === '' ? null : raw.order_lead_days,
    order_note: raw.order_note,
    delivery_note: raw.delivery_note,
    notes: raw.notes,
  };
  const save = $('#maker-save');
  save.disabled = true;
  try {
    if (editId) {
      await api(`/api/manufacturers/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      dialog.close();
      await loadDetail(editId);
    } else {
      const created = await api('/api/manufacturers', { method: 'POST', body: JSON.stringify(payload) });
      dialog.close();
      window.location.href = `/manufacturers/${created.id}`;
    }
  } catch (err) {
    $('#maker-error').textContent = err.message;
    $('#maker-error').hidden = false;
  } finally {
    save.disabled = false;
  }
});

/* ---------- Löschen ---------- */
$('#btn-del-maker').addEventListener('click', async () => {
  if (!state.current) return;
  if (!confirm(`Hersteller „${state.current.name}" löschen?`)) return;
  try {
    await api(`/api/manufacturers/${state.current.id}`, { method: 'DELETE' });
    window.location.href = '/manufacturers';
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- Routing: /manufacturers und /manufacturers/<id> ---------- */
function showView(name) {
  $('#view-list').hidden = name !== 'list';
  $('#view-detail').hidden = name !== 'detail';
  $('#list-header').hidden = name !== 'list';
  $('#detail-header').hidden = name !== 'detail';
}

async function boot() {
  const id = Number(location.pathname.split('/').filter(Boolean)[1]);
  if (Number.isInteger(id) && id > 0) {
    showView('detail');
    try {
      await loadDetail(id);
    } catch (err) {
      $('#detail-name').textContent = 'Nicht gefunden';
      $('#detail-sub').textContent = err.message;
    }
    return;
  }
  showView('list');
  await loadList();
}

boot().catch((err) => {
  $('#maker-subline').textContent = 'Daten konnten nicht geladen werden';
  $('#maker-list').innerHTML = `<li class="maker-item"><span class="maker-sub">${esc(err.message)}</span></li>`;
});
