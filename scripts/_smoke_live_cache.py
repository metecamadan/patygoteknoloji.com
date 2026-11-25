#!/usr/bin/env python3
import urllib.request

UA = {"User-Agent": "PatygoSmoke/1.0", "Cache-Control": "no-cache", "Pragma": "no-cache"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, dict(r.headers), r.read().decode("utf-8", "replace")

for label, base in (
    ("prod", "https://patygoteknoloji.com"),
):
    st, hdr, body = get(base + "/")
    print("==", label, st)
    for n in ("style.css?v=", "home-slider.js?v="):
        i = body.find(n)
        print(" ", body[i : i + 40].split('"')[0] if i >= 0 else "MISSING " + n)
    # cache headers on css
    i = body.find("style.css?v=")
    if i >= 0:
        ver = body[i : i + 40].split('"')[0]
        st2, h2, _ = get(base + "/" + ver.lstrip("/"))
        print("  css", st2, "cache-control=", h2.get("Cache-Control") or h2.get("cache-control"))
        print("  etag=", h2.get("ETag") or h2.get("etag"))
