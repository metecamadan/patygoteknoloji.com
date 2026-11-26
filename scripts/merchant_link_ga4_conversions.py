"""Link GA4 property to Merchant Center as conversion source (idempotent).

Uses local OAuth at %USERPROFILE%\\.patygo\\ (content scope).
Does not print tokens. Writes merchantConversionSource into google-api.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

CFG_PATH = Path.home() / ".patygo" / "google-api.json"


def main() -> int:
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    creds = Credentials.from_authorized_user_file(cfg["oauthTokenPath"])
    if not creds.valid:
        creds.refresh(Request())

    account = str(cfg["merchantCenterAccountId"])
    prop = str(cfg.get("ga4PropertyId") or "").strip()
    if not prop:
        print("missing_ga4PropertyId")
        return 1

    headers = {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}
    list_url = f"https://merchantapi.googleapis.com/conversions/v1/accounts/{account}/conversionSources"
    listed = requests.get(list_url, headers=headers, timeout=30)
    print("list_status", listed.status_code)
    if listed.status_code != 200:
        print("list_body", listed.text[:800])
        return 2

    sources = listed.json().get("conversionSources") or []
    for src in sources:
        link = src.get("googleAnalyticsLink") or {}
        print(
            "source",
            src.get("name"),
            "state",
            src.get("state"),
            "propertyId",
            link.get("propertyId"),
        )
        if str(link.get("propertyId") or "") == prop and src.get("state") == "ACTIVE":
            cfg["merchantConversionSource"] = src.get("name")
            cfg["merchantConversionGa4PropertyId"] = prop
            CFG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print("ok_already_active")
            return 0

    created = requests.post(
        list_url,
        headers=headers,
        json={"googleAnalyticsLink": {"propertyId": prop}},
        timeout=30,
    )
    print("create_status", created.status_code)
    print("create_body", created.text[:1200])
    if created.status_code not in (200, 201):
        return 3

    body = created.json()
    cfg["merchantConversionSource"] = body.get("name")
    cfg["merchantConversionGa4PropertyId"] = prop
    CFG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("ok_created", body.get("state"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
