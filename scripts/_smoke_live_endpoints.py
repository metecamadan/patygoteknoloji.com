#!/usr/bin/env python3
"""Smoke critical public endpoints on patygoteknoloji.com."""
import json
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
BASE = "https://patygoteknoloji.com"
UA = {"User-Agent": "patygo-live-endpoint-smoke"}


def fetch(path: str, timeout: float = 25) -> tuple[int, bytes]:
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, res.read()


def main() -> int:
    checks = [
        ("/api/payment/status", None),
        ("/api/catalog-bootstrap", "json"),
        ("/api/catalog/bootstrap?path=/urunler", "json_alias"),
        ("/urunler", "html"),
    ]
    failed = 0
    primary_total = None
    for path, kind in checks:
        try:
            status, body = fetch(path)
            print(path, status, end="")
            if kind == "json":
                data = json.loads(body.decode("utf-8"))
                primary_total = data.get("total")
                print(f" total={primary_total} products={len(data.get('products') or [])}")
            elif kind == "json_alias":
                data = json.loads(body.decode("utf-8"))
                alias_total = data.get("total")
                print(f" total={alias_total} products={len(data.get('products') or [])}")
                if primary_total is not None and alias_total != primary_total:
                    print("  FAIL alias total mismatch")
                    failed += 1
            elif kind == "html":
                text = body.decode("utf-8", errors="replace")
                print(
                    " bootstrap="
                    + str("patygo-catalog-bootstrap" in text)
                    + " infinite="
                    + str("data-catalog-infinite" in text)
                )
            else:
                print(" ok", body[:80].decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as err:
            print(path, err.code, "FAIL")
            failed += 1
        except Exception as err:
            print(path, type(err).__name__, err, "FAIL")
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
