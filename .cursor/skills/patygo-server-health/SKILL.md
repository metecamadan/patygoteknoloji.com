---
name: patygo-server-health
description: >-
  Checks live patygoteknoloji.com store health (domain smoke + VPS process/disk/FX/XML digest).
  Use when the user asks sunucu sağlığı, site ayakta mı, her şey yolunda mı, VPS/PM2/nginx durumu,
  canlı smoke, ops health, or whether production is OK — before local npm test unless they asked for tests.
---

# Patygo canlı sunucu sağlığı

## Intent first

User asks “sunucu sağlığı / her şey yolunda mı?” → this skill. Local `npm test` is a different ask.
Do not replace a health question with a test-fix detour unless the user (or a failing hook they care about) explicitly asked.

## Hard rules

- Prove with **domain**: `https://patygoteknoloji.com` — never claim OK via VPS IP alone.
- Supplier XML only from VPS `87.76.157.41`. This PC must not curl/fetch the supplier host.
- Touch only mağaza: PM2 `patygo`, `/var/www/patygoteknoloji.com`. Never `/var/www/acik-artirma`, `artirma` user, their nginx/PM2/DB.
- No secrets, `.env`, XML passwords, or full supplier URLs in chat/logs.
- “API answered” ≠ healthy. Need process + domain endpoints + catalog/FX/XML facts.

## Run order

1. Public domain smoke (this PC OK):
   - `GET /` → 200
   - `GET /api/payment/status` → POS `enabled`, `testMode` false for live take
   - `GET /api/shipping` → shipping enabled flags
   - `GET /api/products?limit=1` → 200 + non-zero `total` when catalog should be live
   - `GET /api/feeds/akakce.xml` → 200
   - `GET /sitemap.xml`, `/admin` → 200
   - TLS `notAfter` still valid
2. VPS via `scripts/vps_ssh.py` / `scripts/check-live-health.py`:
   - nginx active; load / MemAvailable / disk free
   - PM2 `patygo`: online, restart count, mem, uptime
   - `.runtime/fx-rates.json`: `rateDate`, `fetchedAt`, USD/EUR (weekend may keep Friday TCMB date — not automatically stale)
   - Slot 1 settings: `supplier-settings.json` lastFetchStatus/ok time/itemCount
   - `.runtime/xml-fetch-digest.json` last few Istanbul days: ok vs fail vs quota
   - Tail PM2 error log for `Döviz kuru alınamadı`, quota text, crash/OOM — count only; scrub URLs
3. Prefer `python scripts/check-live-health.py` when present; print structured lines, then summarize.

## Report shape (user language)

1. Verdict first: ayakta / kısmi risk / kırmızı.
2. Table or short bullets: site, POS, katalog, XML, FX, PM2, disk.
3. Open risks that do not take the site down (e.g. historical FX fetch-failed lines, weak admin password warning, empty home slider, Akakçe image 404s) — separate from outage.
4. What you did **not** check (e.g. `gh` unauthenticated → Actions unknown).

## SSH allowlist

- Allowed comments only: `patygo-admin-pc` (local `~/.ssh/patygo_vps`) and `github-actions-patygo-deploy`.
- Before removing any `authorized_keys` line, match **key body fingerprint** to local `patygo_vps.pub` — never delete by comment name alone.
- Deploy runs `scripts/ensure-authorized-ssh-keys.sh` after `git reset` to keep those two keys.

## Do not

- Hit bilgisayarim.com.tr from this PC.
- `pm2 restart all` / touch auction stack.
- Greenwash: if FX cache missing/stale by `ratesAreStale` rules, or XML digest failures today, say so.
- Dump secrets or raw supplier URLs.
- Strip SSH keys without fingerprint proof (22 Nov 2026 lockout lesson).
