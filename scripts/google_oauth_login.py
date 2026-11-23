#!/usr/bin/env python3
"""Patygo — Desktop OAuth login; refresh token stays in %USERPROFILE%\\.patygo\\

Sohbete secret yazılmaz. Tarayıcıda Google hesabınla izin ver.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/adwords",
    "https://www.googleapis.com/auth/content",
]

OUT_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".patygo"
CFG = OUT_DIR / "google-api.json"
TOKEN = OUT_DIR / "google-oauth-token.json"


def main() -> int:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        print("MISSING_DEPS: pip install google-auth-oauthlib google-auth")
        return 2

    if not CFG.is_file():
        print("MISSING_CFG", CFG)
        return 1
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    client_path = Path(cfg.get("oauthDesktopJsonPath") or "")
    if not client_path.is_file():
        print("MISSING_CLIENT_JSON")
        return 1

    creds = None
    if TOKEN.is_file():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)

    if creds and creds.valid:
        print("ALREADY_VALID")
        return 0

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        flow = InstalledAppFlow.from_client_secrets_file(str(client_path), SCOPES)
        # Local server; browser opens for consent (Internal app = org users only).
        creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    try:
        os.chmod(TOKEN, 0o600)
    except OSError:
        pass

    cfg["oauthTokenPath"] = str(TOKEN)
    cfg["oauthScopes"] = SCOPES
    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("TOKEN_SAVED")
    print("has_refresh", bool(creds.refresh_token))
    print("ga4PropertyId", cfg.get("ga4PropertyId") or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
