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
const TABS = ['general', 'security', 'devices', 'users', 'log'];

function showTab(name) {
  if (!TABS.includes(name)) name = 'general';
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.dataset.panel !== name;
  }
  if (name === 'devices') loadDevices();
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
    // Passwort-Manager ordnet den Eintrag zu; Feld selbst bleibt unsichtbar und schreibgeschützt
    $('#pw-username').value = me.user.username;
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
/* Jedes Passwortfeld hat sein eigenes Auge — type bleibt im HTML "password",
   damit der Browser Passwort-Manager und Vorschläge weiter anbietet. */
const EYE_ON = '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>';
const EYE_OFF = '<path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.5 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.3 7.6C3.6 9.4 2 12 2 12s3.6 6 10 6a9.9 9.9 0 0 0 4.2-.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';

for (const btn of document.querySelectorAll('.pw-eye')) {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.eye);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', `${show ? 'Verbergen' : 'Anzeigen'}`);
    btn.classList.toggle('on', show);
    btn.querySelector('svg').innerHTML = show ? EYE_OFF : EYE_ON;
    input.focus();
  });
}

/* Einfache Passwortstärke — Hinweis, keine Vorschrift. */
const meterFill = $('#pw-meter-fill');
const meterText = $('#pw-meter-text');
function passwordScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 10) score += 1;
  if (pw.length >= 14) score += 1;
  if (pw.length >= 18) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^\w\s]/.test(pw)) score += 1;
  if (/^(.)\1+$/.test(pw)) score = Math.min(score, 1);
  return Math.min(score, 5);
}

$('#pw-new').addEventListener('input', (e) => {
  const pw = e.target.value;
  const meter = $('#pw-meter');
  if (!pw) { meter.hidden = true; return; }
  meter.hidden = false;
  const score = passwordScore(pw);
  const labels = ['sehr schwach', 'schwach', 'mittel', 'gut', 'stark', 'sehr stark'];
  meterFill.style.width = `${(score / 5) * 100}%`;
  meterFill.dataset.level = String(score);
  meterText.textContent = labels[score];
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash($('#password-error'), $('#password-ok'));
  const form = $('#password-form');
  const current = $('#pw-current').value;
  const next = $('#pw-new').value;
  const confirm = $('#pw-confirm').value;

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

/* ---------- Geräte ---------- */
const DEVICE_ICONS = {
  Rechner: '<path d="M4 6h16v10H4zM9 20h6M12 16v4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  Handy: '<rect x="7" y="3" width="10" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11 18h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  Tablet: '<rect x="5" y="4" width="14" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11 17h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};

/** „vor 3 Min.", „vor 2 Std.", „am 28.10.2026, 09:14" */
function agoText(min) {
  if (min === null || min === undefined) return 'unbekannt';
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  if (min < 60 * 24) {
    const h = Math.round(min / 60);
    return `vor ${h} Std.`;
  }
  const d = Math.round(min / (60 * 24));
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

async function loadDevices() {
  const list = $('#device-list');
  list.innerHTML = '<li class="device-item"><span class="u-meta">Lädt …</span></li>';
  try {
    const data = await api('/api/sessions');
    list.innerHTML = data.sessions.map((s) => `
      <li class="device-item ${s.current ? 'is-current' : ''}" data-prefix="${esc(s.id)}">
        <span class="device-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">${DEVICE_ICONS[s.kind] || DEVICE_ICONS.Rechner}</svg>
        </span>
        <div class="device-body">
          <div class="device-name">
            ${esc(s.browser)} auf ${esc(s.system)}
            ${s.current ? '<span class="role-badge">dieses Gerät</span>' : ''}
            ${s.active && !s.current ? '<span class="presence on">aktiv</span>' : ''}
          </div>
          <div class="u-meta">
            ${s.active ? 'gerade aktiv' : `zuletzt ${agoText(s.last_seen_min)}`}
            · angemeldet ${esc(fmtWhen(s.created_at) || '–')}
            ${s.ip ? ` · ${esc(s.ip)}` : ''}
          </div>
        </div>
        <div class="u-actions">
          <button class="btn ghost small ${s.current ? '' : 'danger'}" type="button" data-dact="revoke" data-prefix="${esc(s.id)}" data-current="${s.current ? '1' : '0'}">
            ${s.current ? 'Abmelden' : 'Abmelden'}
          </button>
        </div>
      </li>`).join('');
  } catch (err) {
    list.innerHTML = `<li class="device-item"><span class="u-meta">${esc(err.message)}</span></li>`;
  }
}

$('#device-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-dact="revoke"]');
  if (!btn) return;
  const isCurrent = btn.dataset.current === '1';
  if (!confirm(isCurrent
    ? 'Dieses Gerät jetzt abmelden? Du wirst zur Anmeldung zurückgeleitet.'
    : 'Dieses Gerät abmelden? Es muss sich neu anmelden.')) return;
  btn.disabled = true;
  try {
    await api(`/api/sessions/${encodeURIComponent(btn.dataset.prefix)}`, { method: 'DELETE' });
    if (isCurrent) {
      window.location.replace('/login.html');
      return;
    }
    await loadDevices();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

$('#btn-revoke-others').addEventListener('click', async (e) => {
  if (!confirm('Alle anderen Geräte abmelden? Sie müssen sich neu anmelden.')) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const data = await api('/api/sessions', { method: 'DELETE' });
    await loadDevices();
    flash($('#devices-ok'), `${data.ended} Gerät(e) abgemeldet.`, false);
  } catch (err) {
    alert(err.message);
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
    toggleUserForm(false);
    await loadUsers();
  } catch (err) {
    box.textContent = err.message;
    box.hidden = false;
  }
});

/* „Neuer Benutzer" bleibt zugeklappt, bis man es wirklich braucht. */
function toggleUserForm(open) {
  const wrap = $('#user-form-wrap');
  const btn = $('#btn-new-user');
  wrap.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    $('#user-error').hidden = true;
    $('#user-form').username.focus();
  } else {
    $('#user-form').reset();
    $('#user-error').hidden = true;
  }
}

$('#btn-new-user').addEventListener('click', () => toggleUserForm($('#user-form-wrap').hidden));
$('#btn-cancel-user').addEventListener('click', () => toggleUserForm(false));

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
  session_revoked: ['Gerät abgemeldet', 't-warn'],
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
