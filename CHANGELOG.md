# Changelog

## v0.2.0 — 2026-10-28

Umbau auf Hofladen-Logik: ein Produkt, viele Chargen.

**Geändert**
- `products` ist jetzt ein Stammdaten-Datensatz (Name, Kategorie, Einheit, Ort,
  **Warnzeit**, **Einfrier-Vorlauf**) — Feld „angebrochen am" entfällt
- Neue Tabelle `batches`: mehrere MHDs pro Produkt, jede Charge mit eigener
  Menge und eigenem MHD
- Neue Tabelle `events` als Änderungsprotokoll (angelegt, eingefroren,
  Menge korrigiert, gelöscht)
- Status wird pro Charge berechnet, pro Produkt zur schlechtesten Charge verdichtet
- Migration v1 → v2 überführt bestehende Zeilen verlustfrei in Produkt + Charge

**Neu**
- `POST /api/batches/:id/freeze` — Charge einfrieren (Datum optional)
- `PUT /api/batches/:id/quantity` — Menge nach Zählung korrigieren
- `GET /api/overview` — Liste inkl. Zähler und verdichtetem Status
- **Einfrier-Frist**: `freeze_deadline` = MHD − Vorlauf, Status
  `window` / `due` / `missed` / `frozen`
- Warnzeit pro Produkt (globale Einstellung nur noch Fallback)

## v0.1.0 — 2026-10-28

Erste Version: flache Produktliste mit einem MHD, Status, Suche, Export.
