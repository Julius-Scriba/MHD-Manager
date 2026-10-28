/* mhd-manager · Einstellungen als eigene Seite */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { user: null, warnDays: 7 };

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

const flash = (el, message, isError) => {
  el.textContent = message;
  el.hidden = false;
  el.className = isError ? 'form-error' : 'form-ok';
};
const clearFlash = (...els) => { for (const el of els) { el.hidden = true; el.textContent = ''; } };

/** Zeitstempel der DB sind UTC → lokale, lesbare Form. */
const fmtWhen = (s) => {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ---------- Tabs ---------- */
const TABS = ['general', 'security', 'users', 'log'];

function showTab(name) {
  if (!TABS.includes(name)) name = 'general';
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.dataset.panel !== name;
  }
  if (name === 'users') loadUsers();
  if (name === 'log') loadLog();
  // Tab in der URL halten, damit ein Neuladen dort bleibt
  const url = name === 'general' ? '/settings' : `/settings#${name}`;
  history.replaceState(null, '', url);
}

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && !tab.hidden) showTab(tab.dataset.tab);
});

/* ---------- Start ---------- */
async function init() {
  try {
    const [me, settings] = await Promise.all([api('/api/me'), api('/api/settings')]);
    state.user = me.user;
    state.warnDays = settings.warn_days;
    const isAdmin = me.user.role === 'admin';
    $('#user-line').textContent = `Angemeldet als ${me.user.username}${isAdmin ? ' · Administrator' : ''}`;
    $('#tab-users').hidden = !isAdmin;
    $('#tab-log').hidden = !isAdmin;
    $('#settings-form').warn_days.value = settings.warn_days;
    showTab((location.hash || '').replace('#', '') || 'general');
  } catch (err) {
    if (err.message !== 'Nicht angemeldet.') {
      $('#user-line').textContent = 'Daten konnten nicht geladen werden';
    }
  }
}

/* ---------- Allgemein ---------- */
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash($('#settings-error'), $('#settings-ok'));
  try {
    const data = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ warn_days: Number($('#settings-form').warn_days.value) }),
    });
    state.warnDays = data.warn_days;
    flash($('#settings-ok'), 'Gespeichert.', false);
  } catch (err) {
    flash($('#settings-error'), err.message, true);
  }
});

$('#btn-export').addEventListener('click', () => { window.location.href = '/api/export'; });

/* ---------- Sicherheit ---------- */
$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash($('#password-error'), $('#password-ok'));
  const form = $('#password-form');
  const current = form.current.value;
  const next = form.next.value;
  const confirm = form.confirm.value;

  if (next.length < 10) return flash($('#password-error'), 'Das neue Passwort braucht mindestens 10 Zeichen.', true);
  if (next !== confirm) return flash($('#password-error'), 'Die beiden neuen Passwörter stimmen nicht überein.', true);
  if (next === current) return flash($('#password-error'), 'Das neue Passwort muss sich vom alten unterscheiden.', true);

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api('/api/password', { method: 'POST', body: JSON.stringify({ current, next }) });
    form.reset();
    flash($('#password-ok'), 'Passwort geändert. Andere Geräte wurden abgemeldet.', false);
  } catch (err) {
    flash($('#password-error'), err.message, true);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Benutzer ---------- */
/** Anwesenheit in Worten: „gerade aktiv", „vor 12 Min.", „am 28.10.2026, 09:14". */
function presenceText(u) {
  const seen = u.last_seen_min;
  if (u.online) return 'gerade aktiv';
  if (seen === null || seen === undefined) {
    return u.last_login ? 'noch keine Aktivität erfasst' : 'noch nie angemeldet';
  }
  if (seen < 60) return `zuletzt aktiv vor ${seen} Min.`;
  const when = fmtWhen(u.last_seen);
  const hours = Math.round(seen / 60);
  if (seen < 60 * 24) return `zuletzt aktiv vor ${hours} Std. · ${when}`;
  const days = Math.round(hours / 24);
  return `zuletzt aktiv vor ${days} ${days === 1 ? 'Tag' : 'Tagen'} · ${when}`;
}

async function loadUsers() {
  if (state.user?.role !== 'admin') return;
  try {
    const data = await api('/api/users');
    $('#user-list').innerHTML = data.users.map((u) => {
      const self = u.id === state.user?.id;
      const roleLabel = u.role === 'admin' ? 'Administrator' : 'Mitarbeiter';
      return `<li class="user-item" data-user="${u.id}">
        <div>
          <div class="u-name">${esc(u.username)}
            <span class="role-badge ${u.role === 'admin' ? 'admin' : ''}">${roleLabel}</span>
            ${self ? '<span class="role-badge">du</span>' : ''}
            <span class="presence ${u.online ? 'on' : 'off'}">${u.online ? 'online' : 'offline'}</span>
          </div>
          <div class="u-meta">${esc(presenceText(u))}</div>
        </div>
        <div class="u-actions">
          ${self ? '' : `<button class="btn ghost small" type="button" data-uact="role" data-id="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">
            ${u.role === 'admin' ? 'Zu Mitarbeiter' : 'Zu Admin'}</button>`}
          <button class="btn ghost small" type="button" data-uact="reset" data-id="${u.id}" data-name="${esc(u.username)}">Passwort</button>
          ${self ? '' : `<button class="btn ghost small danger" type="button" data-uact="del" data-id="${u.id}" data-name="${esc(u.username)}">Löschen</button>`}
        </div>
      </li>`;
    }).join('');
  } catch (err) {
    $('#user-list').innerHTML = `<li class="u-meta">${esc(err.message)}</li>`;
  }
}

$('#user-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-uact]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const act = btn.dataset.uact;
  btn.disabled = true;
  try {
    if (act === 'del') {
      if (!confirm(`Benutzer „${btn.dataset.name}" löschen? Die Sitzung wird sofort beendet.`)) {
        btn.disabled = false;
        return;
      }
      await api(`/api/users/${id}`, { method: 'DELETE' });
    } else if (act === 'reset') {
      const pw = prompt(`Neues Passwort für „${btn.dataset.name}" (min. 10 Zeichen):`);
      if (!pw) { btn.disabled = false; return; }
      await api(`/api/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password: pw }) });
      alert('Passwort gesetzt.');
    } else if (act === 'role') {
      await api(`/api/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role: btn.dataset.role }) });
    }
    await loadUsers();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = $('#user-form');
  const box = $('#user-error');
  box.hidden = true;
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: form.username.value.trim(),
        password: form.password.value,
        role: form.role.value,
      }),
    });
    form.reset();
    await loadUsers();
  } catch (err) {
    box.textContent = err.message;
    box.hidden = false;
  }
});

/* ---------- Protokoll ---------- */
const LOG_LABELS = {
  login_ok: ['Anmeldung', 't-info'],
  login_failed: ['Fehlversuch', 't-danger'],
  product_created: ['Produkt neu', 't-info'],
  product_updated: ['Produkt geändert', 't-info'],
  product_deleted: ['Produkt gelöscht', 't-danger'],
  batch_created: ['Charge neu', 't-info'],
  batch_frozen: ['eingefroren', 't-info'],
  quantity_changed: ['Menge geändert', 't-info'],
  batch_deleted: ['Charge gelöscht', 't-danger'],
  category_created: ['Kategorie neu', 't-info'],
  category_deleted: ['Kategorie weg', 't-warn'],
  user_created: ['Benutzer neu', 't-info'],
  user_deleted: ['Benutzer gelöscht', 't-danger'],
  user_role_changed: ['Rolle geändert', 't-warn'],
  user_password_reset: ['Passwort zurückgesetzt', 't-warn'],
  password_changed: ['Passwort geändert', 't-info'],
  password_change_failed: ['Passwort-Fehlversuch', 't-danger'],
  settings_changed: ['Einstellung', 't-info'],
};
const logLabel = (type) => LOG_LABELS[type] || [type.replace(/_/g, ' '), ''];

async function loadLog() {
  if (state.user?.role !== 'admin') return;
  const params = new URLSearchParams();
  const type = $('#log-type').value;
  const user = $('#log-user').value;
  const since = $('#log-since').value;
  if (type) params.set('type', type);
  if (user) params.set('user', user);
  if (since) params.set('since', since);
  params.set('limit', '300');

  const body = $('#log-body');
  body.innerHTML = '<tr><td colspan="5" class="log-empty">Lädt …</td></tr>';
  try {
    const data = await api(`/api/events?${params}`);
    const types = $('#log-type');
    if (types.options.length <= 1) {
      for (const t of data.filters.types) {
        const o = document.createElement('option');
        o.value = t.type;
        o.textContent = `${logLabel(t.type)[0]} (${t.n})`;
        types.append(o);
      }
    }
    const users = $('#log-user');
    if (users.options.length <= 1) {
      for (const u of data.filters.users) {
        const o = document.createElement('option');
        o.value = u.username;
        o.textContent = `${u.username} (${u.n})`;
        users.append(o);
      }
    }

    $('#log-summary').textContent = data.events.length
      ? `${data.events.length} von insgesamt ${data.total} Einträgen`
      : '';

    body.innerHTML = data.events.length
      ? data.events.map((e) => {
        const [label, cls] = logLabel(e.type);
        return `<tr>
          <td class="when">${esc(fmtWhen(e.at) || '–')}</td>
          <td class="who">${esc(e.username || '–')}</td>
          <td><span class="log-type ${cls}">${esc(label)}</span></td>
          <td>${esc(e.entity_name || '')}</td>
          <td class="detail">${esc(e.detail || '')}${e.ip ? ` <span class="u-meta">· ${esc(e.ip)}</span>` : ''}</td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="5" class="log-empty">Keine Einträge für diese Auswahl.</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="log-empty">${esc(err.message)}</td></tr>`;
  }
}

for (const id of ['#log-type', '#log-user', '#log-since']) {
  $(id).addEventListener('change', loadLog);
}

/* ---------- Abmelden ---------- */
$('#btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/login.html');
});

init();
