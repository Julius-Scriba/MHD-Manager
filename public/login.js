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
