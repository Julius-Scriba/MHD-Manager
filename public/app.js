/* mhd-manager v3 · Frontend: Produkte + Chargen + Kategorien + Auth */
'use strict';

const UNITS = ['kg', 'g', 'Stk', 'Pkg', 'l', 'ml', 'Dose', 'Flasche'];
const PACES = [
  ['schnell', 'Schnell (Warnung 1 Tag vorher)'],
  ['mittel', 'Mittel (Warnung 3 Tage vorher)'],
  ['langsam', 'Langsam (Warnung 14 Tage vorher)'],
];
const NEW_CATEGORY = '__new__';

const state = {
  products: [], categories: [], counts: {}, today: '', warnDays: 7, user: null,
  search: '', filter: '', sort: 'mhd', open: new Set(),
  editProduct: null, editBatch: null, batchParent: null,
};

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const fmtQty = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : String(Number(n).toFixed(2)).replace('.', ','));

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
  if (!res.ok) throw new Error((data.errors && data.errors.join(' ')) || data.error || `Fehler ${res.status}`);
  return data;
}

/* ---------- Laden ---------- */
async function load() {
  try {
    const [me, cats] = await Promise.all([api('/api/me'), api('/api/categories')]);
    state.user = me.user;
    state.categories = cats.categories;
    const data = await api('/api/overview');
    state.products = data.products;
    state.counts = data.counts;
    state.today = data.today;
    state.warnDays = data.warn_days;
    render();
  } catch (err) {
    if (err.message !== 'Nicht angemeldet.') {
      $('#subline').textContent = 'Daten konnten nicht geladen werden';
      $('#list').innerHTML = `<p class="empty">Fehler beim Laden.<br><small>${esc(err.message)}</small></p>`;
    }
  }
}

function visibleProducts() {
  const term = state.search.trim().toLowerCase();
  let list = state.products.filter((p) => {
    if (term) {
      const hit = [p.name, p.category, p.location, p.notes].some((f) => String(f || '').toLowerCase().includes(term));
      if (!hit) return false;
    }
    if (state.filter === 'freeze') return p.batches.some((b) => b.quantity > 0 && (b.freeze_status === 'due' || b.freeze_status === 'missed'));
    if (state.filter === 'ok') return p.worst_status === 'ok';
    if (state.filter) return p.batches.some((b) => b.quantity > 0 && (b.post_freeze_status || b.status) === state.filter);
    return true;
  });
  const by = {
    mhd: (a, b) => (a.next_best_before || '9999').localeCompare(b.next_best_before || '9999') || a.name.localeCompare(b.name, 'de'),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    qty: (a, b) => b.total_quantity - a.total_quantity || a.name.localeCompare(b.name, 'de'),
  };
  return list.sort(by[state.sort] || by.mhd);
}

/* ---------- Render ---------- */
function render() {
  const c = state.counts;
  $('#stats').innerHTML = [
    ['expired', 'Abgelaufen'], ['urgent', 'Heute fällig'], ['freeze_due', 'Einfrieren'], ['soon', 'Bald fällig'],
  ].map(([k, l]) => `<div class="stat" data-k="${k}"><div class="n">${c[k] || 0}</div><div class="l">${l}</div></div>`).join('');

  const nBatches = state.products.reduce((s, p) => s + p.active_batches, 0);
  $('#subline').textContent = state.products.length
    ? `${state.products.length} Produkte · ${nBatches} Chargen · Stand ${fmtDate(state.today)}`
    : 'Noch keine Produkte erfasst';

  const list = visibleProducts();
  const box = $('#list');
  const empty = $('#empty');
  if (!list.length) {
    box.innerHTML = '';
    empty.hidden = false;
    empty.textContent = state.products.length ? 'Kein Produkt passt zu Suche/Filter.' : 'Tippe oben auf „Produkt", um das erste anzulegen.';
    return;
  }
  empty.hidden = true;
  box.innerHTML = list.map(cardHtml).join('');
  $('#locations').innerHTML = [...new Set(state.products.map((p) => p.location).filter(Boolean))]
    .sort().map((v) => `<option value="${esc(v)}"></option>`).join('');
}

function statusChip(b) {
  if (b.freeze_status === 'due') return `<span class="chip freeze">bis ${fmtDate(b.freeze_deadline)} einfrieren</span>`;
  if (b.freeze_status === 'missed') return '<span class="chip freeze">einfrieren verpasst</span>';

  const status = b.post_freeze_status || b.status;
  const days = b.post_freeze_status ? b.tk_days_left : b.days_left;
  const label = status === 'expired' ? `abgelaufen (${Math.abs(days)} T.)`
    : status === 'urgent' ? 'heute fällig'
    : status === 'soon' ? `in ${days} T.`
    : 'haltbar';
  const tk = b.frozen_on ? '<span class="chip freeze">TK</span>' : '';
  return `<span class="chip ${status}">${label}</span>${tk}`;
}

function cardHtml(p) {
  const open = state.open.has(p.id);
  const headMeta = [
    p.active_batches ? `${p.active_batches} ${p.active_batches === 1 ? 'Charge' : 'Chargen'}` : 'keine Charge',
    `${fmtQty(p.total_quantity)} ${esc(p.unit)}`,
    p.next_best_before ? `nächstes MHD ${fmtDate(p.next_best_before)}` : '',
    p.location ? esc(p.location) : '',
    p.category ? esc(p.category) : '',
  ].filter(Boolean).join(' · ');

  const warnLine = p.warn_days_stock > p.warn_days_effective
    ? `Warnzeit ${p.warn_days_effective} T. · bei ${fmtQty(p.total_quantity)} ${esc(p.unit)} Bestand ${p.warn_days_stock} T.`
    : `Warnzeit ${p.warn_days_effective} T.`;
  const rules = [warnLine];
  if (p.freeze_days !== null) rules.push(`einfrieren ${p.freeze_days} T. vor Frisch-MHD`);
  if (p.tk_days) rules.push(`TK ${p.tk_days} T.`);

  const batches = p.batches.length
    ? p.batches.map((b) => batchHtml(b, p)).join('')
    : '<div class="batch-empty">Noch keine Charge erfasst.</div>';

  return `<article class="card ${open ? 'open' : ''}" data-worst="${p.worst_status}" data-id="${p.id}">
    <button class="card-head" type="button" data-act="toggle" aria-expanded="${open}">
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="card-title">
        <div class="name">${esc(p.name)} <span class="qty">${fmtQty(p.total_quantity)} ${esc(p.unit)}</span></div>
        <div class="meta"><span>${headMeta}</span></div>
        <div class="meta"><span>${rules.join(' · ')}</span>${p.freeze_due_count ? `<span class="chip freeze">${p.freeze_due_count}× einfrieren</span>` : ''}</div>
      </div>
      <div class="card-tools">
        <span class="icon-btn" role="button" tabindex="0" data-act="edit-product" title="Produkt bearbeiten" aria-label="Produkt bearbeiten">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </span>
        <span class="icon-btn danger" role="button" tabindex="0" data-act="del-product" title="Produkt löschen" aria-label="Produkt löschen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
    </button>
    <div class="batches">
      ${batches}
      <div class="add-batch"><button class="btn ghost small" type="button" data-act="add-batch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Charge</button></div>
    </div>
  </article>`;
}

function batchHtml(b, p) {
  // Angezeigt wird die Frist, die gerade zählt: eingefroren → TK-MHD, sonst Frisch-MHD
  const useTk = Boolean(b.tk_best_before);
  const days = useTk ? b.tk_days_left : b.days_left;
  const dayBig = days < 0 ? Math.abs(days) : days;
  const dayUnit = days < 0 ? (Math.abs(days) === 1 ? 'Tag her' : 'Tage her') : days === 0 ? 'heute' : (days === 1 ? 'Tag' : 'Tage');
  const dateLine = useTk ? `TK-MHD ${fmtDate(b.tk_best_before)}` : `Frisch-MHD ${fmtDate(b.best_before)}`;

  const checkChip = b.check_due
    ? '<span class="chip check-due" title="Bestand seit dem letzten Zählen zu lange nicht geprüft">prüfen</span>'
    : '';
  const info = [
    dateLine,
    `<span>${fmtQty(b.quantity)} ${esc(p.unit)}</span>`,
    b.frozen_on ? `eingefroren ${fmtDate(b.frozen_on)}` : '',
    b.freeze_status === 'window' && b.freeze_deadline ? `bis ${fmtDate(b.freeze_deadline)} einfrieren` : '',
    b.note ? esc(b.note) : '',
  ].filter(Boolean).join(' · ');

  const canFreeze = !b.frozen_on && p.tk_days && b.status !== 'expired';

  return `<div class="batch" data-status="${b.status}" data-batch="${b.id}">
    <div class="days"><div class="d">${dayBig}</div><div class="u">${dayUnit}</div></div>
    <div class="batch-info">
      <div class="l1">${esc(p.name)} ${statusChip(b)} ${checkChip}</div>
      <div class="l2">${info}</div>
    </div>
    <div class="batch-actions">
      <button class="btn ghost small" type="button" data-act="check-batch" title="Bestand zählen">${b.check_due ? 'Zählen' : 'Gezählt'}</button>
      ${canFreeze ? `<button class="btn freeze small" type="button" data-act="freeze">Einfrieren</button>` : ''}
      <span class="icon-btn" role="button" tabindex="0" data-act="edit-batch" title="Charge bearbeiten" aria-label="Charge bearbeiten">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      </span>
      <span class="icon-btn" role="button" tabindex="0" data-act="del-batch" title="Charge löschen" aria-label="Charge löschen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </div>
  </div>`;
}

/* ---------- Bestandsprüfung: eine Charge zählen ---------- */
const checkDialog = $('#check-dialog');
const checkForm = $('#check-form');
let checkTarget = null;

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

$('#check-form').addEventListener('submit', async (e) => {
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
      method: 'POST', body: JSON.stringify({ quantity: qty }),
    });
    if (qty === 0) {
      await api(`/api/batches/${checkTarget.batch.id}`, { method: 'DELETE' });
    }
    checkDialog.close();
    await load();
  } catch (err) {
    $('#check-error').textContent = err.message;
    $('#check-error').hidden = false;
    btn.disabled = false;
  }
});

/* „Charge ist leer": Menge 0 und Charge entfernen — Produkt bleibt bestehen. */
$('#check-empty').addEventListener('click', async (e) => {
  if (!checkTarget) return;
  const { product, batch } = checkTarget;
  if (!confirm(`Charge (${fmtQty(batch.quantity)} ${product.unit}, MHD ${fmtDate(batch.best_before)}) entfernen? Das Produkt bleibt bestehen.`)) return;
  e.currentTarget.disabled = true;
  try {
    await api(`/api/batches/${batch.id}`, { method: 'DELETE' });
    checkDialog.close();
    await load();
  } catch (err) {
    $('#check-error').textContent = err.message;
    $('#check-error').hidden = false;
    e.currentTarget.disabled = false;
  }
});

/* ---------- Kategorien im Dropdown ---------- */
function fillCategorySelect(selected) {
  const sel = $('#category-select');
  const opts = ['<option value="">— keine —</option>'];
  for (const c of state.categories) {
    if (!c.active) continue;
    opts.push(`<option value="${esc(c.name)}">${esc(c.name)}</option>`);
  }
  opts.push(`<option value="${NEW_CATEGORY}">+ Neue Kategorie …</option>`);
  sel.innerHTML = opts.join('');

  const known = state.categories.some((c) => c.name.toLowerCase() === String(selected || '').toLowerCase());
  if (selected && !known) {
    // Altbestand: Kategorie existiert nicht in der Liste → als Eintrag ergänzen
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(selected)}">${esc(selected)}</option>`);
  }
  sel.value = selected || '';
}

$('#category-select').addEventListener('change', (e) => {
  if (e.target.value !== NEW_CATEGORY) return;
  e.target.value = '';
  const name = prompt('Name der neuen Kategorie:');
  if (!name || !name.trim()) return;
  api('/api/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
    .then(async (created) => {
      state.categories.push(created);
      await load();
      fillCategorySelect(created.name);
    })
    .catch((err) => alert(err.message));
});

/* ---------- Produkt-Dialog ---------- */
const productDialog = $('#product-dialog');
const productForm = $('#product-form');
$('#unit-select').innerHTML = UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');
$('#pace-select').innerHTML = PACES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

const PACE_HINT = {
  schnell: 'Warnung 1 Tag vor MHD, Bestand prüfen jede Woche — für Ware, die schnell weggeht.',
  mittel: 'Warnung 3 Tage vor MHD, Bestand prüfen alle 14 Tage.',
  langsam: 'Warnung 14 Tage vor MHD, Bestand prüfen alle 30 Tage — für Ware, die lange liegt.',
};
const updatePaceHint = () => { $('#pace-hint').textContent = PACE_HINT[productForm.pace.value] || ''; };
$('#pace-select').addEventListener('change', updatePaceHint);

function openProductDialog(product) {
  state.editProduct = product || null;
  $('#product-title').textContent = product ? 'Produkt bearbeiten' : 'Neues Produkt';
  $('#product-error').hidden = true;
  productForm.reset();
  $('#unit-select').value = 'kg';
  $('#pace-select').value = 'mittel';
  fillCategorySelect(product?.category || '');
  if (product) {
    productForm.name.value = product.name;
    productForm.location.value = product.location || '';
    $('#unit-select').value = product.unit;
    $('#pace-select').value = product.pace || 'mittel';
    productForm.warn_days.value = product.warn_days ?? '';
    productForm.freeze_days.value = product.freeze_days ?? '';
    productForm.tk_days.value = product.tk_days ?? '';
    productForm.check_days.value = product.check_days ?? '';
    productForm.notes.value = product.notes || '';
  }
  updatePaceHint();
  productDialog.showModal();
  if (!product) setTimeout(() => productForm.name.focus(), 30);
}

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(productForm).entries());
  const payload = {
    name: raw.name,
    category: raw.category === NEW_CATEGORY ? '' : raw.category,
    location: raw.location,
    unit: raw.unit,
    pace: raw.pace,
    notes: raw.notes,
    warn_days: raw.warn_days === '' ? null : raw.warn_days,
    freeze_days: raw.freeze_days === '' ? null : raw.freeze_days,
    tk_days: raw.tk_days === '' ? null : raw.tk_days,
    check_days: raw.check_days === '' ? null : raw.check_days,
  };
  try {
    if (state.editProduct) await api(`/api/products/${state.editProduct.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    productDialog.close();
    await load();
  } catch (err) {
    const box = $('#product-error');
    box.textContent = err.message;
    box.hidden = false;
  }
});

/* ---------- Chargen-Dialog ---------- */
const batchDialog = $('#batch-dialog');
const batchForm = $('#batch-form');

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

batchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(batchForm).entries());
  const payload = { ...raw, quantity: raw.quantity === '' ? 0 : raw.quantity };
  try {
    if (state.editBatch) {
      await api(`/api/batches/${state.editBatch.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api(`/api/products/${state.batchParent.id}/batches`, { method: 'POST', body: JSON.stringify(payload) });
      state.open.add(state.batchParent.id);
    }
    batchDialog.close();
    await load();
  } catch (err) {
    const box = $('#batch-error');
    box.textContent = err.message;
    box.hidden = false;
  }
});

/* ---------- Interaktion ---------- */
$('#list').addEventListener('click', async (e) => {
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
  if (act === 'edit-product') { e.stopPropagation(); return openProductDialog(product); }
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
      await load();
    } catch (err) { alert(err.message); }
    return;
  }

  const batchEl = e.target.closest('.batch');
  const batch = batchEl ? product.batches.find((b) => b.id === Number(batchEl.dataset.batch)) : null;

  if (act === 'freeze' && batch) {
    actEl.disabled = true;
    try {
      await api(`/api/batches/${batch.id}/freeze`, { method: 'POST', body: JSON.stringify({}) });
      await load();
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
    try { await api(`/api/batches/${batch.id}`, { method: 'DELETE' }); await load(); } catch (err) { alert(err.message); }
  }
  if (act === 'check-batch' && batch) {
    e.stopPropagation();
    return openCheckSheet(product, batch);
  }
});

$('#list').addEventListener('keydown', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  t.click();
});

/* ---------- Toolbar ---------- */
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 120);
});
$('#filter').addEventListener('change', (e) => { state.filter = e.target.value; render(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

/* ---------- Gemeinsam ---------- */
$('#btn-add-product').addEventListener('click', () => openProductDialog(null));
for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', (e) => e.target.closest('dialog').close());
}

load();
