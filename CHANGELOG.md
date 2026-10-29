# Changelog

## v0.11.0 — 2026-10-29

Hersteller als eigene Seiten, App heißt jetzt Product Manager.

**Neu**
- Tabelle `manufacturers`: Kontakt, Adresse, Website, Bestellvorlauf,
  Bestellrhythmus, Lieferung, Notiz
- `/manufacturers` — Liste mit Suche über Name, Ort, Kontakt, E-Mail, Telefon
- `/manufacturers/<id>` — eigene Seite mit zwei Tabs:
  Kontakt & Bestellung, Produkte (gleiche Karten wie die Gesamtübersicht)
- Produkte verweisen per `manufacturer_id` auf einen Hersteller; `manufacturers`
  werden beim Laden mitgeliefert und beim Speichern mitgeschickt
- Hersteller umbenennen zieht den Namen auf den Produkten mit
- Löschen nur ohne zugeordnete Produkte (Server antwortet sonst mit 409)

**Geändert**
- „MHD Manager" heißt „Product Manager" (Titel, Überschrift, Anmeldeseite)
- Kopfzeile der Übersicht hat einen Hersteller-Link
- Bestehende Freitext-Hersteller wurden in Datensätze überführt (25 Produkte)

**Absicherung**
- Release-Prüfung: `npm test`, Syntax je Datei, Test-API-Läufe gegen `mhd2`

## v0.10.0 — 2026-10-29

Produktkarten aufgeräumt: Übersicht bleibt Übersicht, Details erst beim Aufklappen.

**Geändert**
- Kopfzeile zeigt nur noch vier Dinge: Name, Menge, nächstes MHD, Warn-Chips
- Ort, Kategorie, Hersteller, Warnregeln und Aktionen wandern in den Detailbereich
  (zweispaltige Faktenliste, Regeln als eine Zeile, Bearbeiten/Löschen klein darunter)
- Bearbeiten/Löschen-Icons aus der Kopfzeile entfernt — sie lagen im Aufklapp-Button
  und lösten versehentlich Aktionen aus, statt aufzuklappen
- Warn-Chips für Prüfung und Einfrieren sitzen rechts in der Kopfzeile

**Warum**
Ein Produkt mit zwei Chargen, Hersteller, Kategorie und Regeln hatte fünf gestapelte
Textzeilen. Jetzt sind es zwei — die Karte bleibt scanbar, ohne dass Information fehlt.

## v0.9.1 — 2026-10-29

Hersteller je Produkt.

**Neu**
- Feld „Hersteller" im Produkt-Dialog (Freitext, max. 80 Zeichen)
- Vorschlagsliste aus bereits verwendeten Herstellern — kein doppeltes Eintippen
- Hersteller erscheint in der Produktzeile unter Name/Menge/Ort/Kategorie
- Suche findet Hersteller mit
- Protokoll nennt Änderungen am Hersteller
- JSON-Export enthält das Feld automatisch (`SELECT *`)

## v0.9.0 — 2026-10-29

Kategorien nach Vorgabe, Warnzeit richtet sich jetzt nach der Absatzmenge.

**Neu**
- Zwölf Kategorien: Fleisch & Wurst, Obst & Gemüse, Feinkost & Spezialitäten,
  Milchprodukte & Eier, Brot & Backwaren, Konserven & Eingemachtes,
  Honig/Marmelade & Süßes, Öle/Essig & Gewürze, Getränke, Nudeln/Reis & Getreide,
  Tiefkühlprodukte, Geschenke & Sonstiges
- `warnDaysForStock()`: Warnzeit ist mindestens so lang, wie der Abverkauf des
  vorhandenen Bestands dauert (Tempo × Menge), gedeckelt auf 60 Tage
- Produktkarte zeigt beide Werte, wenn sie abweichen:
  „Warnzeit 1 T. · bei 48 Pkg Bestand 48 T."

**Geändert**
- „Fleisch" → „Fleisch & Wurst", „Feinkosten & Spezialitäten" → „Feinkost & Spezialitäten"
  (Produkte umgehängt, alte Kategorien entfernt)
- Frischfleisch auf Verkaufstempo „schnell"

**Beispiel**
- Wildbouletten, 48 Pkg, MHD in 19 Tagen → Status „bald fällig" statt „haltbar"

## v0.8.0 — 2026-10-28

Bestandsprüfung: zählen statt raten, mit drei Zuständen und eigenem Prüfrhythmus.

**Neu**
- Prüf-Intervall je Produkt (`check_days`), sonst aus dem Verkaufstempo:
  schnell = 7 Tage, mittel = 14 Tage, langsam = 30 Tage
- Charge zeigt „prüfen", wenn die letzte Zählung älter als das Intervall ist
  (noch nie gezählt = immer fällig)
- Zähl-Dialog je Charge: erfasste Menge vorbelegt, Bestätigen oder korrigieren
- „Charge ist leer — löschen": Menge 0 und Charge entfernen, **Produkt bleibt bestehen**
- `POST /api/batches/:id/check` (mit optionaler Mengenkorrektur) und
  `POST /api/batches/check` (Sammelbestätigung)
- Protokolleintrag `batch_checked`, bei Korrektur mit „alt → neu"

**Geändert**
- Verkaufstempo-Hinweis nennt jetzt auch den Prüfrhythmus

**Zweiter Hostname**
- `https://mhd2.unknownengine.com` als eigener Vhost mit eigenem Zertifikat,
  weil einzelne Resolver `mhd` nicht auflösen. Zwei getrennte server-Blöcke —
  ein gemeinsamer Block liefert immer nur das erste Zertifikat aus.

## v0.7.2 — 2026-10-28

Passwort setzen im Benutzer-Tab ohne Browser-Dialog.

**Geändert**
- „Passwort" bei einem Benutzer öffnet einen eigenen Dialog statt `prompt()`:
  eigenes Passwortfeld mit Auge, Stärkeanzeige, Wiederholung, Inline-Fehler
- Unsichtbares Benutzernamen-Feld im Dialog, damit der Passwort-Manager den
  Eintrag der richtigen Person zuordnet
- Erfolgsmeldung im Dialog, schließt nach kurzer Bestätigung

**Technisch**
- Auge-Schalter arbeitet jetzt per Delegation — funktioniert auch für später
  eingefügte Felder

## v0.7.1 — 2026-10-28

Passwortfelder sind echte, klar erkennbare Passwortfelder mit Einblick.

**Neu**
- Jedes Passwortfeld hat ein eigenes Auge zum Ein- und Ausblenden
  (Sicherheit: aktuell, neu, Wiederholung; ebenso auf der Anmeldeseite)
- Das `type="password"` bleibt im Markup erhalten und wird nur zur Anzeige
  umgeschaltet — Passwort-Manager und Vorschlagsfunktion des Browsers greifen weiter
- `autocomplete`-Hinweise: `username` (unsichtbar, readonly), `current-password`,
  `new-password` — der Browser erkennt damit Anmeldung und Passwortwechsel
- Passwortstärke-Anzeige beim Tippen (Länge, Groß-/Kleinschreibung, Ziffern, Sonderzeichen)

**Geändert**
- Die frühere Checkbox „Passwörter anzeigen" ist ersetzt: pro Feld ein Auge,
  damit man einzelne Felder gezielt prüfen kann

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
