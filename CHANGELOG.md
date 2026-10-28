# Changelog

## v0.7.0 — 2026-10-28

Geräteverwaltung: Jeder sieht seine angemeldeten Geräte und kann sie selbst abmelden.

**Neu**
- Tab „Geräte" unter `/settings` (für alle Benutzer, nicht nur Admins)
- Anzeige je Anmeldung: Browser (Chrome/Safari/Firefox/Edge/Opera), System
  (iOS/Android/Windows/macOS/Linux), Gerätetyp (Handy/Tablet/Rechner), IP,
  Anmeldezeitpunkt und „zuletzt aktiv"
- `GET /api/sessions`, `DELETE /api/sessions/:prefix`, `DELETE /api/sessions`
- Einzelnes Gerät abmelden; „Alle anderen Geräte abmelden" behält die eigene Sitzung
- Abmelden des eigenen Geräts leitet sauber zur Anmeldung
- Protokolleintrag `session_revoked`

**Absicherung**
- Es werden nur Sitzungen des angemeldeten Benutzers durchsucht — ein fremdes
  Token-Präfix liefert `404` statt fremde Geräte abzumelden
- Sitzungs-Kennung nach außen nur als 10-Zeichen-Präfix, nie das volle Token

**Behoben**
- Migration: SQLite erlaubt bei `ALTER TABLE ADD COLUMN` keinen nicht-konstanten
  Default (`datetime('now')`) — zweistufige Migration, die den Absturz beim Start verursachte

## v0.6.1 — 2026-10-28

Benutzer-Formular klappt erst auf Knopfdruck auf.

**Geändert**
- „Neuer Benutzer" ist ein Button neben der Überschrift; das Formular ist zugeklappt
  und öffnet erst auf Klick (`aria-expanded`, Fokus auf Benutzername)
- „Abbrechen" schließt und leert das Formular; nach erfolgreichem Anlegen klappt es
  ebenfalls zu

## v0.6.0 — 2026-10-28

Einstellungen sind jetzt eine eigene Seite statt eines Popups.

**Neu**
- `public/settings.html` + `public/settings.js` unter `/settings`, mit Tabs:
  Allgemein (Warnzeit, Export), Sicherheit (Passwort), Benutzer (nur Admin),
  Protokoll (nur Admin)
- Der aktive Tab steht in der URL (`/settings#users`) und überlebt ein Neuladen
- Zahnrad in der Kopfzeile ist ein Link; Zurück-Pfeil führt zur Übersicht

**Aufgeräumt**
- beide Dialoge (`settings-dialog`, `log-dialog`) aus `index.html` und `app.js` entfernt
  — es gibt jetzt genau eine Stelle für jede Einstellung

## v0.5.1 — 2026-10-28

Anwesenheit: Admins sehen, wer gerade online ist.

**Neu**
- `users.last_seen` (Migration füllt aus `last_login` vor)
- wird bei jeder authentifizierten Anfrage aktualisiert, höchstens einmal pro Minute
  und Benutzer (In-Memory-Drosselung, kein Schreibzugriff pro Request)
- „online" = Aktivität in den letzten 5 Minuten
- `GET /api/users` liefert `online`, `last_seen`, `last_seen_min`
- Benutzerliste zeigt Badge (online/offline) und lesbaren Text:
  „gerade aktiv", „zuletzt aktiv vor 12 Min.", „zuletzt aktiv vor 3 Tagen · 26.10.2026, 09:14"

## v0.5.0 — 2026-10-28

Vollständiges Protokoll aller Aktionen, nur für Administratoren sichtbar.

**Neu**
- `events`-Tabelle um Handelnden (`user_id`, `username`), Entität (`entity`, `entity_name`)
  und Client-IP erweitert
- Jede Änderung wird protokolliert: Produkte anlegen/ändern/löschen, Chargen anlegen/einfrieren/
  Menge/löschen, Kategorien, Benutzer anlegen/löschen/Rolle/Passwort-Reset,
  eigener Passwortwechsel, fehlgeschlagene Anmeldungen und Passwortversuche, Einstellungen
- `GET /api/events` (nur Admin): Filter nach Typ, Person und Datum, Limit bis 500
- Dialog „Protokoll" im Einstellungsbereich mit lesbaren Bezeichnungen, Filtern und IP-Spalte
- Produktänderungen protokollieren die geänderten Felder im Klartext
  (`Warnzeit: 7 → 2, Einfrieren: – → 1`)

**Absicherung**
- Protokoll ist serverseitig auf Admins begrenzt; Mitarbeiter erhalten `403`
- Ein fehlgeschlagener Protokolleintrag bricht die Fachaktion nie ab (try/catch + Log)

## v0.4.0 — 2026-10-28

Mehrere Benutzer mit Rollen.

**Neu**
- Rolle `admin` / `user`; der erste Benutzer wird automatisch Administrator
- Benutzerverwaltung im Einstellungsdialog (nur für Admins sichtbar):
  anlegen, löschen, Rolle wechseln, Passwort zurücksetzen
- `GET/POST /api/users`, `DELETE /api/users/:id`, `PUT /api/users/:id/role`,
  `POST /api/users/:id/password`
- Passwort-Reset durch einen Admin beendet die Sitzungen des betroffenen Benutzers sofort

**Absicherung**
- Benutzerverwaltung und globale Einstellungen serverseitig auf Admins begrenzt (`403` sonst)
- Eigenes Konto kann nicht gelöscht werden; eigene Admin-Rolle nicht entfernbar
- Letzter Administrator kann weder gelöscht noch degradiert werden
- Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, `.`, `_`, `-`; doppelte Namen (auch
  andere Groß-/Kleinschreibung) abgelehnt
- Startpasswort mindestens 10 Zeichen, gehasht mit scrypt wie alle Passwörter

## v0.3.0 — 2026-10-28

Passwortschutz, Frisch-/TK-MHD, Verkaufstempo und pflegbare Kategorien.

**Neu: Zugangsschutz**
- Anmeldung mit Benutzername + Passwort, Ein Benutzerkonto (erweiterbar)
- Passwort-Hashing mit scrypt (N=2^15, r=8, p=3) — kein Klartext, zeitkonstanter Vergleich
- Session-Cookie: HttpOnly, Secure, SameSite=Strict, 30 Tage; Logout löscht die Session serverseitig
- Brute-Force-Sperre: 5 Fehlversuche pro IP **und** pro Benutzername in 15 Minuten,
  Sperre verdoppelt sich bei Wiederholung (max. 24 h); auch das richtige Passwort
  wird während der Sperre abgewiesen
- Gleiche Rechenzeit für unbekannte Benutzer (keine Benutzer-Enumeration)
- Security-Header: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy
- SQL-Injection strukturell ausgeschlossen: ausschließlich Prepared Statements

**Neu: Frisch-MHD und TK-MHD**
- Pro Produkt `freeze_days` (Tage vor Frisch-MHD einfrieren) und `tk_days` (TK-Haltbarkeit ab Einfrieren)
- `freeze_deadline` = Frisch-MHD − Vorlauf
- Nach dem Einfrieren gilt automatisch `tk_best_before` = Einfriertag + `tk_days`
- Ablaufstatus bezieht sich danach auf das TK-MHD (`post_freeze_status`)

**Neu: Verkaufstempo**
- Stufen `schnell` / `mittel` / `langsam` → Warnzeit 1 / 3 / 14 Tage
- Manuelle Warnzeit überschreibt weiterhin die Stufe

**Neu: Kategorien**
- Tabelle `categories` mit eigener Auswahlliste im Produktformular
- Letzter Eintrag „+ Neue Kategorie …" legt direkt eine neue an
- Löschen einer benutzten Kategorie deaktiviert sie nur (bestehende Produkte behalten sie)

**Migration**
- Schema v3, idempotent; v1- und v2-Bestände werden übernommen
- `ALTER TABLE ... RENAME` schreibt Fremdschlüssel mit um → `batches` wird erst
  nach der Umbenennung neu angelegt (sonst FK auf `products_old`)

## v0.2.0 — 2026-10-28

Umbau auf Hofladen-Logik: ein Produkt, viele Chargen (siehe Commit `52fae36`).

## v0.1.0 — 2026-10-28

Erste Version: flache Produktliste mit einem MHD.
