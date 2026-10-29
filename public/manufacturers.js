/* Product Manager · Hersteller: Liste, Detailseite mit Kontakt und Produkten */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const fmtQty = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : String(Number(n).toFixed(2)).replace('.', ','));

const state = {
  makers: [], products: [], cats: [], counts: {}, today: '',
  search: '', current: null, open: new Set(),
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
  const tk = b.frozen_on ? '<span class="chip freeze">TK</span>' : '';
  return `<span class="chip ${status}">${label}</span>${tk}`;
}

/** Gleiche Karten wie in der Gesamtübersicht — nur ohne Produkt-Aktionen. */
function cardHtml(p) {
  const open = state.open.has(p.id);
  const unit = esc(p.unit);
  const nextMhd = p.next_best_before ? `<span class="next">nächstes MHD ${fmtDate(p.next_best_before)}</span>` : '';
  const checkChip = p.batches.some((b) => b.quantity > 0 && b.check_due)
    ? '<span class="chip check-due">prüfen</span>' : '';
  const batches = p.batches.length
    ? p.batches.map((b) => batchHtml(b, p)).join('')
    : '<div class="batch-empty">Noch keine Charge erfasst.</div>';

  return `<article class="card ${open ? 'open' : ''}" data-worst="${p.worst_status}" data-id="${p.id}">
    <button class="card-head" type="button" data-act="toggle" aria-expanded="${open}">
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="card-title">
        <div class="name">${esc(p.name)}</div>
        <div class="card-sub"><span class="qty">${fmtQty(p.total_quantity)} ${unit}</span>${nextMhd}</div>
      </div>
      <div class="card-flags">${checkChip}${p.freeze_due_count ? `<span class="chip freeze">${p.freeze_due_count}× TK</span>` : ''}</div>
    </button>
    <div class="batches">${batches}</div>
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

  return `<div class="batch" data-status="${b.status}" data-batch="${b.id}">
    <div class="days"><div class="d">${dayBig}</div><div class="u">${dayUnit}</div></div>
    <div class="batch-info">
      <div class="l1">${esc(p.name)} ${statusChipOf(b)}</div>
      <div class="l2">${info}</div>
    </div>
  </div>`;
}

/* Karten auf-/zuklappen */
document.addEventListener('click', (e) => {
  const head = e.target.closest('.card-head[data-act="toggle"]');
  if (!head) return;
  const card = head.closest('.card');
  const id = Number(card.dataset.id);
  if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
  card.classList.toggle('open');
  head.setAttribute('aria-expanded', String(state.open.has(id)));
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
