/* Anmeldung */
'use strict';
const form = document.getElementById('login-form');
const errBox = document.getElementById('login-error');
const btn = document.getElementById('login-submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Prüfe …';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      window.location.replace('/');
      return;
    }
    errBox.textContent = data.error || 'Anmeldung fehlgeschlagen.';
    errBox.hidden = false;
    form.password.value = '';
    form.password.focus();
  } catch {
    errBox.textContent = 'Keine Verbindung zum Server.';
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
});

/* Passwort einblenden — type bleibt "password", nur zur Anzeige umgeschaltet. */
const EYE_ON = '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>';
const EYE_OFF = '<path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.5 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.3 7.6C3.6 9.4 2 12 2 12s3.6 6 10 6a9.9 9.9 0 0 0 4.2-.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';

for (const btn of document.querySelectorAll('.pw-eye')) {
  btn.addEventListener('click', () => {
    const input = document.querySelector(btn.dataset.eye);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    btn.classList.toggle('on', show);
    btn.querySelector('svg').innerHTML = show ? EYE_OFF : EYE_ON;
    input.focus();
  });
}
