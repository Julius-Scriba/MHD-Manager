# Deployment: Gameserver (vmd202972, 169.58.122.172)

**Live:** https://mhd.unknownengine.com

## Layout auf dem Server

| Pfad | Inhalt |
|---|---|
| `/opt/mhd-manager/` | Code (aus diesem Repo, `npm ci --omit=dev`) |
| `/var/lib/mhd-manager/mhd.db` | SQLite-Datenbank (gehört User `mhd`) |
| `/etc/systemd/system/mhd-manager.service` | systemd-Unit, lauscht auf `127.0.0.1:8091` |
| `/etc/nginx/sites-enabled/mhd-manager` | Reverse-Proxy + TLS |

## Deploy

```bash
cd projects/mhd-manager
tar czf /tmp/mhd.tgz --exclude=node_modules --exclude=data .
cat /tmp/mhd.tgz | ssh gameserver 'tar xzf - -C /opt/mhd-manager'
ssh gameserver 'cd /opt/mhd-manager && npm ci --omit=dev --no-audit --no-fund && systemctl restart mhd-manager'
```

Erstmalig zusätzlich: User `mhd`, `/var/lib/mhd-manager`, Unit installieren,
Nginx-Site verlinken, Zertifikat ausstellen.

```bash
ssh gameserver '
  useradd --system --home /var/lib/mhd-manager --shell /usr/sbin/nologin mhd || true
  mkdir -p /var/lib/mhd-manager && chown -R mhd:mhd /var/lib/mhd-manager
  cp /opt/mhd-manager/deploy/mhd-manager.service /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now mhd-manager
  ln -sf /opt/mhd-manager/deploy/nginx-mhd.conf /etc/nginx/sites-enabled/mhd-manager
  nginx -t && systemctl reload nginx
'
```

## Verifizieren

```bash
ssh gameserver 'systemctl is-active mhd-manager && curl -s localhost:8091/api/health'
curl -s https://mhd.unknownengine.com/api/health
```

## Backup

```bash
ssh gameserver 'sqlite3 /var/lib/mhd-manager/mhd.db "PRAGMA wal_checkpoint(TRUNCATE)" 2>/dev/null; cp /var/lib/mhd-manager/mhd.db /root/mhd-backup-$(date +%F).db'
```

Alternativ jederzeit `GET /api/export` (JSON mit allen Produkten).

## Wenn die App nicht erreichbar ist

1. `systemctl status mhd-manager --no-pager -l` — startet der Dienst?
2. `curl -s localhost:8091/api/health` — antwortet die App?
3. `curl -s -I https://mhd.unknownengine.com` — antwortet Nginx?
4. Browser zeigt 502 → Dienst tot; Browser zeigt Standard-Nginx-Seite → SNI/Serverblock prüfen.
