# MHD Manager

Produkte mit Mindesthaltbarkeitsdatum erfassen, im Blick behalten, rechtzeitig
verbrauchen. Läuft als schlanker Node-Dienst hinter Nginx.

**Live:** https://mhd.unknownengine.com (Gameserver `vmd202972`)

## Funktionsumfang (v0.1)

- Produkt anlegen mit Name, MHD, Menge/Einheit, Kategorie, Ort, „angebrochen am“, Notiz
- Übersicht mit Tagesdifferenz und Status: **abgelaufen**, **dringend** (≤2 Tage),
  **bald fällig** (innerhalb der Vorwarnzeit), **in Ordnung**
- Suche über Name/Kategorie/Ort/Notiz, Filter nach Status, Sortierung nach MHD/Name/Anlage
- Vorwarnzeit in den Einstellungen konfigurierbar (Standard 7 Tage)
- JSON-Export aller Daten
- Responsive UI (Handy zuerst, Desktop skaliert), Light/Dark über Systemeinstellung

Später geplant: Push-/Mail-Warnungen, Barcode-Scan, Verbrauchshistorie, mehrere
Lagerorte, PWA-Installation.

## Stack

| Baustein | Entscheidung |
|---|---|
| Runtime | Node.js ≥ 22.5 (nutzt `node:sqlite`, **keine nativen Builds**) |
| Backend | Express 4, REST-API |
| Datenbank | SQLite als Datei (`DATA_DIR/mhd.db`) |
| Frontend | Vanilla JS, kein Build-Step, statisch aus `public/` |
| Deployment | systemd-Unit + Nginx-Reverse-Proxy |

## Lokal starten

```bash
npm install
npm start            # http://127.0.0.1:8091
npm test             # Validierungs-/Statustests
```

Konfiguration über Umgebungsvariablen: `PORT`, `HOST`, `DATA_DIR`.

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Status + Produktanzahl |
| GET | `/api/products` | Liste inkl. `days_left` + `status` |
| POST | `/api/products` | Produkt anlegen |
| PUT | `/api/products/:id` | Produkt ändern |
| DELETE | `/api/products/:id` | Produkt löschen |
| GET | `/api/settings` | Vorwarnzeit lesen |
| PUT | `/api/settings` | Vorwarnzeit setzen (`warn_days`) |
| GET | `/api/export` | JSON-Backup |

Statusfelder berechnet der Server (UTC-Tagesdifferenz), das Frontend rechnet nichts nach.

## Deployment (Gameserver)

```bash
# auf dem Server
rsync -a --delete --exclude node_modules --exclude data ./ root@vmd202972:/opt/mhd-manager/
ssh gameserver 'cd /opt/mhd-manager && npm ci --omit=dev && systemctl restart mhd-manager'
```

Dateien: `deploy/mhd-manager.service` (systemd), `deploy/nginx-mhd.conf` (Site-Config).
Datenbank liegt unter `/var/lib/mhd-manager/mhd.db` — nicht im Repo, nicht im Deploy-Ordner.

Backup: `GET /api/export` oder Dateikopie von `/var/lib/mhd-manager/mhd.db`
(im WAL-Modus zusätzlich `mhd.db-wal` sichern oder vorher `sqlite3 mhd.db "PRAGMA wal_checkpoint(TRUNCATE)"`).

Deploy-Details: [deploy/README.md](deploy/README.md)
