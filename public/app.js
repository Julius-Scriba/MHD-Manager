/* mhd-manager · Frontend */
'use strict';

const UNITS = ['Stk', 'g', 'kg', 'ml', 'l', 'Pkg', 'Dose', 'Flasche'];
const STATUS_LABEL = { expired: 'Abgelaufen', urgent: 'Dringend', soon: 'Bald fällig', ok: 'In Ordnung' };

const state = { products: [], today: '', warnDays: 7, search: '', filter: '', sort: 'mhd', editing: null };

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function relDays(n) {
  if (n === null || n === undefined) return '–';
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  return n > 0 ? `in ${n} Tagen` : `vor ${Math.abs(n)} Tagen`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors && data.errors.join(' ')) || data.error || `Fehler ${res.status}`);
  return data;
}

/* ---------- Laden & Rendern ---------- */
async function load() {
  try {
    const data = await api('/api/products');
    state.products = data.products;
    state.today = data.today;
    state.warnDays = data.warn_days;
    render();
  } catch (err) {
    $('#subline').textContent = 'Verbindung fehlgeschlagen';
    $('#list').innerHTML = `<p class="empty">Daten konnten nicht geladen werden.<br><small>${esc(err.message)}</small></p>`;
  }
}

function visible() {
  const term = state.search.trim().toLowerCase();
  let list = state.products.filter((p) => {
    if (state.filter && p.status !== state.filter) return false;
    if (!term) return true;
    return [p.name, p.category, p.location, p.notes].some((f) => String(f || '').toLowerCase().includes(term));
  });
  const by = {
    mhd: (a, b) => a.best_before.localeCompare(b.best_before) || a.name.localeCompare(b.name),
    'mhd-desc': (a, b) => b.best_before.localeCompare(a.best_before) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    added: (a, b) => b.id - a.id,
  };
  return list.sort(by[state.sort] || by.mhd);
}

function render() {
  const counts = { expired: 0, urgent: 0, soon: 0, ok: 0 };
  for (const p of state.products) if (p.status in counts) counts[p.status]++;

  $('#stats').innerHTML = Object.entries(counts)
    .map(([k, n]) => `<div class="stat" data-k="${k}"><div class="n">${n}</div><div class="l">${STATUS_LABEL[k]}</div></div>`)
    .join('');

  const list = visible();
  $('#subline').textContent = state.products.length
    ? `${state.products.length} ${state.products.length === 1 ? 'Produkt' : 'Produkte'} · Stand ${fmtDate(state.today)}`
    : 'Noch keine Produkte erfasst';

  const box = $('#list');
  const empty = $('#empty');
  if (!list.length) {
    box.innerHTML = '';
    empty.hidden = false;
    empty.textContent = state.products.length
      ? 'Kein Produkt passt zu Suche/Filter.'
      : 'Tippe oben auf „Produkt“, um das erste MHD zu erfassen.';
    return;
  }
  empty.hidden = true;

  box.innerHTML = list.map((p) => {
    const qty = `${p.quantity} ${esc(p.unit)}`;
    const details = [
      `<em>MHD ${fmtDate(p.best_before)}</em>`,
      `<em>${esc(relDays(p.days_left))}</em>`,
      p.location ? `<em>${esc(p.location)}</em>` : '',
      p.category ? `<em>${esc(p.category)}</em>` : '',
      p.opened_on ? `<em>angebrochen ${fmtDate(p.opened_on)}</em>` : '',
    ].filter(Boolean).join('');
    const dayLabel = p.days_left < 0 ? `${Math.abs(p.days_left)}` : `${p.days_left}`;
    const dayUnit = p.days_left < 0 ? 'Tage her' : p.days_left === 0 ? 'heute' : 'Tage';
    return `<article class="row" data-status="${p.status}" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)}, MHD ${fmtDate(p.best_before)}">
      <div class="days"><div class="d">${p.days_left === 0 ? '0' : dayLabel}</div><div class="u">${dayUnit}</div></div>
      <div class="meta">
        <div class="name">${esc(p.name)} <span style="color:var(--muted);font-weight:400">· ${qty}</span></div>
        <div class="line2">${details}</div>
        ${p.notes ? `<div class="line2 truncate"><em>${esc(p.notes)}</em></div>` : ''}
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-act="edit" title="Bearbeiten" aria-label="Bearbeiten">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn" data-act="del" title="Löschen" aria-label="Löschen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </article>`;
  }).join('');

  // Datalists aus vorhandenen Daten füllen
  const uniq = (key) => [...new Set(state.products.map((p) => p[key]).filter(Boolean))].sort();
  $('#categories').innerHTML = uniq('category').map((v) => `<option value="${esc(v)}"></option>`).join('');
  $('#locations').innerHTML = uniq('location').map((v) => `<option value="${esc(v)}"></option>`).join('');
}

/* ---------- Formular ---------- */
const dialog = $('#dialog');
const form = $('#form');

$('#unit-select').innerHTML = UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');

function openEditor(product) {
  state.editing = product || null;
  $('#dialog-title').textContent = product ? 'Produkt bearbeiten' : 'Neues Produkt';
  $('#form-error').hidden = true;
  form.reset();
  form.quantity.value = '1';
  form.unit.value = 'Stk';
  if (product) {
    form.name.value = product.name;
    form.best_before.value = product.best_before;
    form.quantity.value = product.quantity;
    form.unit.value = product.unit;
    form.opened_on.value = product.opened_on || '';
    form.category.value = product.category || '';
    form.location.value = product.location || '';
    form.notes.value = product.notes || '';
  } else {
    form.best_before.value = state.today;
  }
  dialog.showModal();
  if (!product) setTimeout(() => form.name.focus(), 30);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.quantity = payload.quantity === '' ? 1 : Number(payload.quantity);
  const btn = $('#btn-save');
  btn.disabled = true;
  try {
    if (state.editing) await api(`/api/products/${state.editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    dialog.close();
    await load();
  } catch (err) {
    const box = $('#form-error');
    box.textContent = err.message;
    box.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#btn-cancel').addEventListener('click', () => dialog.close());
$('#btn-add').addEventListener('click', () => openEditor(null));

/* ---------- Zeilen-Aktionen ---------- */
$('#list').addEventListener('click', async (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const id = Number(row.dataset.id);
  const product = state.products.find((p) => p.id === id);
  if (!product) return;

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'edit') return openEditor(product);
  if (act === 'del') {
    if (!confirm(`„${product.name}“ wirklich löschen?`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  openEditor(product);
});

$('#list').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  const product = state.products.find((p) => p.id === Number(row.dataset.id));
  if (product) openEditor(product);
});

/* ---------- Toolbar ---------- */
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value;
    render();
  }, 120);
});
$('#filter').addEventListener('change', (e) => { state.filter = e.target.value; render(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

/* ---------- Einstellungen ---------- */
const settingsDialog = $('#settings-dialog');
$('#btn-settings').addEventListener('click', () => {
  $('#settings-form').warn_days.value = state.warnDays;
  settingsDialog.showModal();
});
$('#btn-settings-cancel').addEventListener('click', () => settingsDialog.close());
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ warn_days: Number($('#settings-form').warn_days.value) }) });
    state.warnDays = data.warn_days;
    settingsDialog.close();
    await load();
  } catch (err) {
    alert(err.message);
  }
});
$('#btn-export').addEventListener('click', () => { window.location.href = '/api/export'; });

load();
