#!/usr/bin/env python3
"""SCP merchant mapper to VPS, export eligible ProductInputs, download JSON."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from vps_ssh import connect  # noqa: E402

REMOTE = "/var/www/patygoteknoloji.com"
LOCAL_OUT = Path.home() / ".patygo" / "merchant-export.json"

FILES = [
    ("lib/google-merchant.js", f"{REMOTE}/lib/google-merchant.js"),
    ("scripts/merchant_export_payload.js", f"{REMOTE}/scripts/merchant_export_payload.js"),
]


def main() -> int:
    client = connect(timeout=45)
    sftp = client.open_sftp()
    try:
        for local_rel, remote in FILES:
            local = ROOT / local_rel
            print("put", local_rel)
            sftp.put(str(local), remote)
        # akakce.js may need resolveMirroredImages export — push that too
        sftp.put(str(ROOT / "lib" / "akakce.js"), f"{REMOTE}/lib/akakce.js")
        print("put lib/akakce.js")
    finally:
        sftp.close()

    limit = "1"
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        limit = sys.argv[1]
    cmd = (
        f"cd {REMOTE} && node scripts/merchant_export_payload.js --limit {limit} "
        f"--out /tmp/merchant-export.json"
    )
    print("remote", cmd)
    _, stdout, stderr = client.exec_command(cmd, timeout=180)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    print("exit", code)
    if out.strip():
        print("stdout", out.strip()[:500])
    if err.strip():
        print("stderr", err.strip()[:500])
    if code != 0:
        client.close()
        return code

    sftp = client.open_sftp()
    try:
        LOCAL_OUT.parent.mkdir(parents=True, exist_ok=True)
        sftp.get("/tmp/merchant-export.json", str(LOCAL_OUT))
        print("saved", LOCAL_OUT)
    finally:
        sftp.close()
        client.close()

    data = json.loads(LOCAL_OUT.read_text(encoding="utf-8"))
    print(
        json.dumps(
            {
                "exportCount": data.get("exportCount"),
                "eligible": data.get("eligible"),
                "catalogCount": data.get("catalogCount"),
                "sampleOffer": (data.get("inputs") or [{}])[0].get("offerId"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
