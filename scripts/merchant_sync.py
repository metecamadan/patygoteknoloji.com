#!/usr/bin/env python3
"""Sync Patygo catalog to Google Merchant productInputs. No secrets printed."""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_getaddrinfo(*args, **kwargs):
    results = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in results if r[0] == socket.AF_INET]
    return v4 or results


socket.getaddrinfo = _ipv4_getaddrinfo

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ["USERPROFILE"]) / ".patygo"
CFG = OUT / "google-api.json"
DISPLAY = "Patygo API TR"


def load_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    creds = Credentials.from_authorized_user_file(cfg["oauthTokenPath"])
    last_err = None
    for attempt in range(4):
        try:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            return cfg, creds
        except Exception as e:
            last_err = e
            print("refresh_retry", attempt, type(e).__name__)
            time.sleep(2 + attempt)
    raise SystemExit(f"refresh_failed {type(last_err).__name__}")


def http_json(method: str, url: str, token: str, body: dict | None = None, retries: int = 4):
    data = None
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    last_err: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", "replace")
            # Retry transient 5xx / 429
            if e.code in (429, 500, 502, 503, 504) and attempt + 1 < retries:
                time.sleep(2 + attempt * 2)
                continue
            return e.code, {"error": err_body[:1200]}
        except (TimeoutError, urllib.error.URLError, ConnectionResetError, OSError) as e:
            last_err = e
            print("http_retry", attempt, type(e).__name__)
            time.sleep(2 + attempt * 2)
    return 599, {"error": f"network_failed {type(last_err).__name__ if last_err else 'unknown'}"}


def ensure_api_ds(cfg: dict, token: str) -> tuple[dict, str]:
    account = str(cfg.get("merchantCenterAccountId") or "").strip()
    if not account:
        raise SystemExit("missing_merchant_account")
    list_url = f"https://merchantapi.googleapis.com/datasources/v1/accounts/{account}/dataSources"
    status, body = http_json("GET", list_url, token)
    if status != 200:
        raise SystemExit(f"list_ds_err {status} {body.get('error', '')[:300]}")

    api_ds = None
    wanted = str(cfg.get("merchantApiDataSourceId") or "").strip()
    for ds in body.get("dataSources") or []:
        ds_id = str(ds.get("dataSourceId") or "")
        input_type = str(ds.get("input") or "")
        name = str(ds.get("displayName") or "")
        if input_type != "API":
            continue
        if name == DISPLAY or (wanted and wanted == ds_id):
            api_ds = ds
            break
        if api_ds is None:
            api_ds = ds

    for ds in body.get("dataSources") or []:
        if str(ds.get("input") or "") == "API" and str(ds.get("displayName") or "") == DISPLAY:
            api_ds = ds
            break

    if not api_ds:
        status, created = http_json(
            "POST",
            list_url,
            token,
            {"displayName": DISPLAY, "primaryProductDataSource": {"countries": ["TR"]}},
        )
        if status not in (200, 201):
            raise SystemExit(f"create_ds_err {status} {created.get('error', '')[:400]}")
        api_ds = created
        print("created_ds", api_ds.get("dataSourceId"))

    ds_id = str(api_ds.get("dataSourceId") or "")
    if not ds_id and api_ds.get("name"):
        ds_id = str(api_ds["name"]).rstrip("/").split("/")[-1]
    if not ds_id:
        raise SystemExit("no_ds_id")

    cfg["merchantApiDataSourceId"] = ds_id
    cfg["merchantApiDataSourceName"] = api_ds.get("name") or f"accounts/{account}/dataSources/{ds_id}"
    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return cfg, ds_id


def export_inputs(limit: int, dry_run: bool) -> dict:
    cmd = ["node", str(ROOT / "scripts" / "merchant_export_payload.js")]
    if limit > 0:
        cmd.extend(["--limit", str(limit)])
    if dry_run:
        cmd.append("--dry-run")
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        print("export_stderr", (proc.stderr or "")[:500])
        print("export_stdout", (proc.stdout or "")[:500])
        raise SystemExit(f"export_failed {proc.returncode}")
    return json.loads(proc.stdout)


def list_merchant_offer_ids(account: str, token: str) -> set[str]:
    offer_ids: set[str] = set()
    page_token = ""
    while True:
        q = {"pageSize": 250}
        if page_token:
            q["pageToken"] = page_token
        url = (
            f"https://merchantapi.googleapis.com/products/v1/accounts/{account}/products?"
            + urllib.parse.urlencode(q)
        )
        status, body = http_json("GET", url, token)
        if status != 200:
            print("list_products_err", status, str(body.get("error", ""))[:300])
            break
        for product in body.get("products") or []:
            oid = str(product.get("offerId") or "").strip()
            # Prefer channel products with tr/TR
            lang = str(product.get("contentLanguage") or "")
            label = str(product.get("feedLabel") or "")
            if oid and (not lang or lang == "tr") and (not label or label == "TR"):
                offer_ids.add(oid)
        page_token = str(body.get("nextPageToken") or "")
        if not page_token:
            break
    return offer_ids


def insert_product(account: str, ds_id: str, token: str, product_input: dict) -> tuple[int, dict]:
    ds_name = f"accounts/{account}/dataSources/{ds_id}"
    url = (
        f"https://merchantapi.googleapis.com/products/v1/accounts/{account}/productInputs:insert?"
        + urllib.parse.urlencode({"dataSource": ds_name})
    )
    return http_json("POST", url, token, product_input)


def delete_product(account: str, ds_id: str, token: str, offer_id: str) -> tuple[int, dict]:
    # name: accounts/{account}/productInputs/{contentLanguage~feedLabel~offerId}
    product_name = f"accounts/{account}/productInputs/tr~TR~{urllib.parse.quote(offer_id, safe='')}"
    ds_name = f"accounts/{account}/dataSources/{ds_id}"
    url = (
        f"https://merchantapi.googleapis.com/products/v1/{product_name}?"
        + urllib.parse.urlencode({"dataSource": ds_name})
    )
    return http_json("DELETE", url, token)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync catalog to Google Merchant")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--from-file", default="", help="Use exported JSON instead of local catalog")
    parser.add_argument("--skip", type=int, default=0, help="Skip first N inputs (resume)")
    parser.add_argument("--delete-missing", action="store_true", help="Delete offerIds not in export")
    parser.add_argument("--sleep-ms", type=int, default=50)
    args = parser.parse_args()

    cfg, creds = load_creds()
    token = creds.token
    cfg, ds_id = ensure_api_ds(cfg, token)
    account = str(cfg["merchantCenterAccountId"])
    print("account", account)
    print("api_ds_id", ds_id)

    if args.from_file:
        payload = json.loads(Path(args.from_file).read_text(encoding="utf-8"))
    elif args.dry_run:
        payload = export_inputs(args.limit, dry_run=True)
        print(
            "dry_run",
            json.dumps(
                {
                    "eligible": payload.get("eligible"),
                    "excluded": payload.get("excluded"),
                    "exportCount": payload.get("exportCount"),
                    "sample": (payload.get("inputs") or [])[:5],
                },
                ensure_ascii=False,
            ),
        )
        return 0
    else:
        payload = export_inputs(args.limit, dry_run=False)

    inputs = payload.get("inputs") or []
    if args.limit > 0:
        inputs = inputs[: args.limit]
    skip = max(0, int(args.skip or 0))
    if skip:
        inputs = inputs[skip:]
        print("resume_skip", skip)
    print("export_count", len(inputs), "eligible", payload.get("eligible"))

    if args.dry_run and args.from_file:
        print(
            "dry_run",
            json.dumps(
                {
                    "eligible": payload.get("eligible"),
                    "exportCount": len(inputs),
                    "sample": [
                        {
                            "offerId": row.get("offerId"),
                            "title": (row.get("productAttributes") or {}).get("title"),
                        }
                        for row in inputs[:5]
                    ],
                },
                ensure_ascii=False,
            ),
        )
        return 0

    ok = 0
    err = 0
    consecutive_auth = 0

    def refresh_token(force: bool = False) -> str:
        nonlocal creds, token
        from google.auth.transport.requests import Request

        if force or (creds.expired and creds.refresh_token):
            creds.refresh(Request())
            token = creds.token
            print("token_refreshed", flush=True)
        return token

    for i, product_input in enumerate(inputs):
        if ok > 0 and ok % 400 == 0:
            try:
                refresh_token(force=True)
            except Exception as e:
                print("token_refresh_warn", type(e).__name__, flush=True)
        status, body = insert_product(account, ds_id, token, product_input)
        if status == 401:
            consecutive_auth += 1
            try:
                refresh_token(force=True)
                status, body = insert_product(account, ds_id, token, product_input)
            except Exception as e:
                print("token_refresh_fail", type(e).__name__, flush=True)
        else:
            consecutive_auth = 0
        if status in (200, 201):
            ok += 1
            err = 0  # reset hard-stop window after recovery
            done = skip + ok
            if ok <= 3 or done % 100 == 0:
                print("insert_ok", done, product_input.get("offerId"), flush=True)
        else:
            err += 1
            print(
                "insert_err",
                status,
                product_input.get("offerId"),
                str(body.get("error", ""))[:240],
                flush=True,
            )
            if consecutive_auth >= 5 or err >= 20:
                print("too_many_errors_stop", flush=True)
                break
        if args.sleep_ms > 0:
            time.sleep(args.sleep_ms / 1000.0)

    deleted = 0
    if args.delete_missing and args.limit == 0 and err < 20:
        remote = list_merchant_offer_ids(account, token)
        local = {str(row.get("offerId") or "") for row in inputs}
        missing = sorted(oid for oid in remote if oid and oid not in local)
        print("delete_candidates", len(missing), "remote", len(remote), "local", len(local))
        for oid in missing:
            status, body = delete_product(account, ds_id, token, oid)
            if status in (200, 204):
                deleted += 1
            else:
                print("delete_err", status, oid, str(body.get("error", ""))[:200])
            if args.sleep_ms > 0:
                time.sleep(args.sleep_ms / 1000.0)

    print(
        json.dumps(
            {"ok": err == 0, "inserted": ok, "errors": err, "deleted": deleted, "api_ds_id": ds_id},
            ensure_ascii=False,
        )
    )
    return 0 if err == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
