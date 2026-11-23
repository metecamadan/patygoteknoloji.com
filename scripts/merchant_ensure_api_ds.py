#!/usr/bin/env python3
"""Ensure Merchant API primary data source for TR. No secrets printed."""
from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Prefer IPv4 — some Windows paths reset IPv6 to Google OAuth.
_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_getaddrinfo(*args, **kwargs):
    results = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in results if r[0] == socket.AF_INET]
    return v4 or results


socket.getaddrinfo = _ipv4_getaddrinfo

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


def http_json(method: str, url: str, token: str, body: dict | None = None):
    data = None
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "replace")
        return e.code, {"error": err_body[:800]}


def main() -> int:
    cfg, creds = load_creds()
    account = str(cfg.get("merchantCenterAccountId") or "").strip()
    if not account:
        print("missing_merchant_account")
        return 1
    token = creds.token
    list_url = f"https://merchantapi.googleapis.com/datasources/v1/accounts/{account}/dataSources"
    status, body = http_json("GET", list_url, token)
    if status != 200:
        print("list_err", status, body.get("error", "")[:400])
        return 1

    api_ds = None
    for ds in body.get("dataSources") or []:
        ds_id = str(ds.get("dataSourceId") or "")
        input_type = str(ds.get("input") or "")
        name = str(ds.get("displayName") or "")
        print("ds", ds_id, "input", input_type, "name", name[:60])
        if input_type == "API" and (
            name == DISPLAY or str(cfg.get("merchantApiDataSourceId") or "") == ds_id
        ):
            api_ds = ds
        elif input_type == "API" and api_ds is None:
            # Prefer named DS; keep first API as fallback
            if name == DISPLAY:
                api_ds = ds

    # Second pass: prefer exact display name
    for ds in body.get("dataSources") or []:
        if str(ds.get("input") or "") == "API" and str(ds.get("displayName") or "") == DISPLAY:
            api_ds = ds
            break

    if not api_ds:
        create_url = list_url
        payload = {
            "displayName": DISPLAY,
            "primaryProductDataSource": {"countries": ["TR"]},
        }
        status, created = http_json("POST", create_url, token, payload)
        if status not in (200, 201):
            print("create_err", status, created.get("error", "")[:500])
            return 1
        api_ds = created
        print("created", api_ds.get("dataSourceId"), api_ds.get("input"))

    ds_id = str(api_ds.get("dataSourceId") or "")
    if not ds_id and api_ds.get("name"):
        # accounts/{id}/dataSources/{dsId}
        ds_id = str(api_ds["name"]).rstrip("/").split("/")[-1]
    if not ds_id:
        print("no_ds_id", json.dumps(api_ds, ensure_ascii=False)[:400])
        return 1

    cfg["merchantApiDataSourceId"] = ds_id
    cfg["merchantApiDataSourceName"] = (
        api_ds.get("name") or f"accounts/{account}/dataSources/{ds_id}"
    )
    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("api_ds_id", ds_id)
    print("api_ds_input", api_ds.get("input") or "API")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
