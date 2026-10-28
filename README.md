# MHD Manager

Mindesthaltbarkeitsdaten für den Hofladen: **ein Produkt, viele Chargen**.
Jede Charge hat ihr eigenes MHD, ihre eigene Menge und optional ein Einfrierdatum.
Die App warnt rechtzeitig vor Ablauf **und** vor der Frist, bis zu der noch
eingefroren werden muss.

**Live:** https://mhd.unknownengine.com

## Modell

```
Rinderhackfleisch            ← Produkt (Stammdaten)
  Warnzeit 2 Tage
  Einfrieren: 1 Tag vor MHD
├─ Charge  MHD 30.10. · 4,5 kg · frisch          → "bis 29.10. einfrieren"
├─ Charge  MHD 01.11. · 2,0 kg · eingefroren 27.10.
└─ Charge  MHD 03.11. · 3,0 kg · frisch
```

- **Produkt** = Name, Kategorie, Einheit, Ort, Warnzeit, Einfrier-Vorlauf
- **Charge** = Menge + MHD + optional Eingefroren-Datum + Notiz
- Verkauft/verbraucht? Charge löschen. Zählt man nach, Menge korrigieren.

## Status pro Charge

| Feld | Werte | Bedeutung |
|---|---|---|
| `status` | `expired` / `urgent` / `soon` / `ok` | MHD vorbei / heute / innerhalb Warnzeit / später |
| `freeze_status` | `window` / `due` / `missed` / `frozen` / `none` | Frist läuft / jetzt einfrieren / Frist verpasst / eingefroren / kein Einfrieren |

`freeze_deadline` = MHD − Einfrier-Vorlauf. Ist die Frist erreicht und die Charge
nicht eingefroren, erscheint sie als **kritisch** (Chip „bis … einfrieren").

Einfrieren verlängert das MHD **nicht** automatisch — die App warnt zum richtigen
Zeitpunkt, die Entscheidung bleibt betrieblich.

## Funktionsumfang (v0.2)

- Produkte anlegen/bearbeiten, Warnzeit und Einfrier-Vorlauf pro Produkt
- Beliebig viele Chargen pro Produkt, Einfrieren mit einem Klick
- Übersicht mit Zählern (abgelaufen / heute / einfrieren / bald fällig)
- Suche, Filter (auch „Einfrieren fällig"), Sortierung nach MHD/Name/Menge
- Änderungsprotokoll in der Tabelle `events` (noch ohne eigene Ansicht)
- JSON-Export, responsive UI, Light/Dark automatisch

Geplant: Push-/Mail-Warnungen, Barcode-Scan, Verkaufsstatistik.

## Benutzer & Rollen

Mehrere Personen können die App nutzen, mit zwei Rollen:

| Rolle | Rechte |
|---|---|
| **Administrator** | alles: Produkte, Chargen, Benutzer anlegen/löschen, Rollen, Passwörter zurücksetzen, globale Einstellungen |
| **Mitarbeiter** | Produkte und Chargen pflegen, Übersicht, Export |

Der **erste** Benutzer wird automatisch Administrator. Weitere Benutzer legt ein Admin
im Einstellungsdialog an (Abschnitt „Benutzer").

Absicherungen: das eigene Konto ist nicht löschbar, die eigene Admin-Rolle nicht
entfernbar, und der letzte Administrator kann weder gelöscht noch degradiert werden —
damit sperrt sich niemand aus dem System aus. Ein Passwort-Reset durch den Admin
beendet die laufenden Sitzungen des betroffenen Benutzers sofort.

## Stack

| Baustein | Entscheidung |
|---|---|
| Runtime | Node.js ≥ 22.5 (nutzt `node:sqlite`, **keine nativen Builds**) |
| Backend | Express 4, REST-API |
| Datenbank | SQLite-Datei (`DATA_DIR/mhd.db`), Schema v2 mit Auto-Migration |
| Frontend | Vanilla JS, kein Build-Step, statisch aus `public/` |
| Deployment | systemd-Unit + Nginx-Reverse-Proxy |

## Lokal starten

```bash
npm install
npm start     # http://127.0.0.1:8091
npm test      # 8 Tests: Datumslogik, Einfrier-Fristen, Validierung
```

Umgebungsvariablen: `PORT`, `HOST`, `DATA_DIR`.

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Status + Anzahl Produkte/Chargen |
| GET | `/api/overview` | Produkte mit Chargen, Zählern, verdichtetem Status |
| GET | `/api/products` | Produktliste |
| POST | `/api/products` | Produkt anlegen |
| PUT | `/api/products/:id` | Produkt ändern |
| DELETE | `/api/products/:id` | Produkt **mit allen Chargen** löschen |
| POST | `/api/products/:id/batches` | Charge anlegen |
| PUT | `/api/batches/:id` | Charge ändern |
| PUT | `/api/batches/:id/quantity` | Menge korrigieren |
| POST | `/api/batches/:id/freeze` | Charge einfrieren (`frozen_on` optional) |
| DELETE | `/api/batches/:id` | Charge löschen |
| GET | `/api/settings` | Standard-Warnzeit lesen |
| PUT | `/api/settings` | Standard-Warnzeit setzen |
| GET | `/api/export` | JSON-Backup (Produkte + Chargen) |

Datumsrechnung ausschließlich in UTC — keine Zeitzonen-Verschiebung um Mitternacht.

## Deployment

Siehe [deploy/README.md](deploy/README.md).

```bash
cd projects/mhd-manager
tar czf /tmp/mhd.tgz --exclude=node_modules --exclude=data .
cat /tmp/mhd.tgz | ssh gameserver 'tar xzf - -C /opt/mhd-manager'
ssh gameserver 'cd /opt/mhd-manager && npm ci --omit=dev && systemctl restart mhd-manager'
```

Datenbank liegt unter `/var/lib/mhd-manager/mhd.db` — nicht im Repo.
