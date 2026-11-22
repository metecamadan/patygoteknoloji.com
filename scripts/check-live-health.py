#!/usr/bin/env python3
"""Patygo live health: domain smoke + VPS facts. No secrets, no supplier host hits."""
from __future__ import annotations

import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vps_ssh import connect  # noqa: E402

BASE = os.environ.get("SITE_BASE_URL", "https://patygoteknoloji.com").rstrip("/")
if "patygoteknoloji.com" not in BASE and "localhost" not in BASE and "127.0.0.1" not in BASE:
    raise SystemExit("SITE_BASE_URL must be the store domain (or local loopback for tests).")

REMOTE = r"""
import json, os, re, subprocess, time
print("NOW", time.strftime("%Y-%m-%d %H:%M:%S"))
print("LOAD", open("/proc/loadavg").read().strip())
want = {}
for line in open("/proc/meminfo"):
    k, v = line.split(":", 1)
    if k in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
        want[k] = v.strip()
print("MEM", want)
st = os.statvfs("/")
print("DISK_FREE_GB", round(st.f_frsize * st.f_bavail / 1024**3, 1), "TOTAL_GB", round(st.f_frsize * st.f_blocks / 1024**3, 1))
print("NGINX", subprocess.check_output(["systemctl", "is-active", "nginx"], text=True).strip())
data = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
now = time.time() * 1000
for p in data:
    if p.get("name") != "patygo":
        continue
    e = p.get("pm2_env") or {}
    m = p.get("monit") or {}
    up = e.get("pm_uptime") or 0
    print(
        "PM2", e.get("status"),
        "restarts", e.get("restart_time"),
        "unstable", e.get("unstable_restarts"),
        "mem_mb", round((m.get("memory") or 0) / 1048576, 1),
        "cpu", m.get("cpu"),
        "uptime_h", round((now - up) / 3600000, 1) if up else None,
    )
root = "/var/www/patygoteknoloji.com/.runtime"
fx_path = os.path.join(root, "fx-rates.json")
if os.path.exists(fx_path):
    d = json.load(open(fx_path))
    print("FX", d.get("rateDate"), d.get("fetchedAt"), "USD", d.get("USD"), "EUR", d.get("EUR"))
else:
    print("FX missing")
for name in ("supplier-settings.json", "supplier-2-settings.json", "supplier-3-settings.json"):
    sp = os.path.join(root, name)
    if not os.path.exists(sp):
        print("SLOT", name, "missing")
        continue
    s = json.load(open(sp))
    err = re.sub(r"https?://\S+", "[url]", str(s.get("lastError") or ""))[:160]
    print(
        "SLOT", name, s.get("lastFetchStatus"),
        "at", s.get("lastFetchAt"),
        "ok", s.get("lastSuccessfulFetchAt"),
        "items", s.get("itemCount"),
        "stale", s.get("catalogStale"),
        "err", err,
    )
digest_path = os.path.join(root, "xml-fetch-digest.json")
if os.path.exists(digest_path):
    days = (json.load(open(digest_path)).get("days") or {})
    for key in sorted(days.keys())[-4:]:
        attempts = (days[key] or {}).get("attempts") or []
        ok = sum(1 for row in attempts if row.get("ok"))
        quota = sum(1 for row in attempts if row.get("quota"))
        fail = sum(1 for row in attempts if not row.get("ok"))
        last = attempts[-1] if attempts else {}
        err = re.sub(r"https?://\S+", "[url]", str(last.get("error") or ""))[:120]
        print("DIGEST", key, "n", len(attempts), "ok", ok, "fail", fail, "quota", quota, "lastAt", last.get("at"), "lastOk", last.get("ok"), "lastErr", err)
else:
    print("DIGEST missing")
logf = "/root/.pm2/logs/patygo-error.log"
if os.path.exists(logf):
    data = subprocess.check_output(["tail", "-n", "400", logf], text=True, errors="replace")
    keys = (
        "Döviz kuru alınamadı",
        "fetch failed",
        "EADDRINUSE",
        "uncaught",
        "out of memory",
        "Günlük erişim",
        "yurtici cargo sync failed",
    )
    print("ERR_COUNTS_LAST400", {k: data.count(k) for k in keys})
else:
    print("no error log")
"""


def fetch(path: str, timeout: float = 20.0):
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": "PatygoHealth/1.0"})
    started = datetime.now(timezone.utc)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read(256_000)
            return {
                "ok": True,
                "status": res.status,
                "seconds": (datetime.now(timezone.utc) - started).total_seconds(),
                "bytes": len(body),
                "json": _maybe_json(body, res.headers.get("Content-Type", "")),
            }
    except urllib.error.HTTPError as err:
        return {"ok": False, "status": err.code, "error": str(err.reason)}
    except Exception as err:  # noqa: BLE001 — health probe must never crash the summary
        return {"ok": False, "status": None, "error": str(err)[:200]}


def _maybe_json(body: bytes, content_type: str):
    if "json" not in content_type.lower():
        return None
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return None


def tls_expiry(host: str = "patygoteknoloji.com"):
    ctx = ssl.create_default_context()
    with ctx.wrap_socket(
        __import__("socket").create_connection((host, 443), 8),
        server_hostname=host,
    ) as sock:
        cert = sock.getpeercert()
        return cert.get("notAfter")


def domain_smoke():
    print("=== DOMAIN", BASE, "===")
    home = fetch("/")
    print("HOME", home.get("status"), "s", round(home.get("seconds") or 0, 3), "b", home.get("bytes"))
    pay = fetch("/api/payment/status")
    print("PAYMENT", pay.get("status"), pay.get("json") or pay.get("error"))
    ship = fetch("/api/shipping")
    print("SHIPPING", ship.get("status"), ship.get("json") or ship.get("error"))
    products = fetch("/api/products?limit=1")
    payload = products.get("json") or {}
    print(
        "PRODUCTS",
        products.get("status"),
        "total",
        payload.get("total"),
        "s",
        round(products.get("seconds") or 0, 3),
    )
    feed = fetch("/api/feeds/akakce.xml")
    print("AKAKCE", feed.get("status"), "b", feed.get("bytes"), "s", round(feed.get("seconds") or 0, 3))
    for path, label in (("/sitemap.xml", "SITEMAP"), ("/admin", "ADMIN"), ("/api/home-slider", "SLIDER")):
        row = fetch(path)
        extra = ""
        if label == "SLIDER" and isinstance(row.get("json"), dict):
            extra = " slides=" + str(len((row["json"].get("slides") or [])))
        print(label, row.get("status"), "s", round(row.get("seconds") or 0, 3), extra)
    print("TLS_NOT_AFTER", tls_expiry())


def vps_probe():
    print("=== VPS ===")
    client = connect(25)
    try:
        payload = base64.b64encode(REMOTE.encode("utf-8")).decode("ascii")
        wrapped = "python3 -c \"import base64; exec(base64.b64decode('%s'))\"" % payload
        _, out, err = client.exec_command(wrapped, timeout=35)
        print(out.read().decode("utf-8", "replace").rstrip())
        remote_err = err.read().decode("utf-8", "replace").strip()
        if remote_err:
            print("REMOTE_ERR", remote_err[:500])
    finally:
        client.close()


def main():
    domain_smoke()
    if "--domain-only" in sys.argv:
        return
    vps_probe()


if __name__ == "__main__":
    main()
