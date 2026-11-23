#!/usr/bin/env python3
"""Probe Ads + Merchant with local OAuth token. No secrets printed."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

OUT = Path(os.environ["USERPROFILE"]) / ".patygo"
CFG = OUT / "google-api.json"


def main() -> int:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    creds = Credentials.from_authorized_user_file(cfg["oauthTokenPath"])
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    # --- Merchant / Content API: list accounts ---
    print("=== MERCHANT ===")
    try:
        content = build("content", "v2.1", credentials=creds, cache_discovery=False)
        # authinfo shows which merchant accounts this OAuth user can access
        info = content.accounts().authinfo().execute()
        ids = [
            str(a.get("accountId") or a.get("id") or "")
            for a in (info.get("accountIdentifiers") or [])
        ]
        ids = [i for i in ids if i]
        print("authinfo_accounts", len(ids))
        for i in ids[:10]:
            print("merchant_id", i)
        if ids:
            cfg["merchantCenterAccountId"] = ids[0]
            if len(ids) > 1:
                cfg["merchantCenterAccountIds"] = ids
    except Exception as e:
        print("merchant_err", type(e).__name__, str(e)[:240])

    # --- Google Ads: list accessible customers ---
    print("=== ADS ===")
    try:
        import urllib.request

        if not creds.valid:
            creds.refresh(Request())
        req = urllib.request.Request(
            "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers",
            method="GET",
            headers={
                "Authorization": f"Bearer {creds.token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        names = body.get("resourceNames") or []
        print("accessible_customers", len(names))
        digits = []
        for n in names:
            # customers/1234567890
            cid = str(n).split("/")[-1]
            print("ads_customer", cid)
            digits.append(cid)
        if digits:
            cfg["googleAdsCustomerIds"] = digits
            if len(digits) == 1:
                cfg["googleAdsCustomerId"] = digits[0]
    except Exception as e:
        err = str(e)
        print("ads_err", type(e).__name__, err[:400])
        if hasattr(e, "read"):
            try:
                print("ads_body", e.read().decode("utf-8", "replace")[:400])
            except Exception:
                pass

    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("cfg_updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
