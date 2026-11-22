#!/usr/bin/env bash
# Keep root SSH allowlist to: this admin PC + GitHub Actions deploy.
# Safe to re-run. Never prints private keys.
set -euo pipefail

AK="/root/.ssh/authorized_keys"
GITHUB_PUB_FILE="/root/.ssh/github_actions_deploy.pub"
# Public half of ~/.ssh/patygo_vps on the admin PC (comment normalized).
ADMIN_PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIY9bm46JIJHwKy2WafTl13AxdaI+YIu6mAw9TbveSJ8 patygo-admin-pc'

mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch "$AK"
chmod 600 "$AK"

if [[ -f "$GITHUB_PUB_FILE" ]]; then
  read -r GITHUB_KIND GITHUB_BODY _ <"$GITHUB_PUB_FILE" || true
else
  GITHUB_KIND=""
  GITHUB_BODY=""
fi

python3 - <<'PY' "$AK" "$ADMIN_PUB" "$GITHUB_KIND" "$GITHUB_BODY"
import sys
from pathlib import Path

ak_path = Path(sys.argv[1])
admin_line = sys.argv[2].strip()
github_kind = sys.argv[3].strip()
github_body = sys.argv[4].strip()

admin_parts = admin_line.split()
admin_body = admin_parts[1]
wanted = {
    admin_body: admin_parts[0] + " " + admin_body + " patygo-admin-pc",
}
if github_kind and github_body:
    wanted[github_body] = github_kind + " " + github_body + " github-actions-patygo-deploy"

existing = ak_path.read_text() if ak_path.exists() else ""
removed = []
for line in existing.splitlines():
    s = line.strip()
    if not s or s.startswith("#"):
        continue
    parts = s.split()
    if len(parts) < 2:
        removed.append("(malformed)")
        continue
    body = parts[1]
    comment = parts[-1] if len(parts) >= 3 else "(no-comment)"
    if body not in wanted:
        removed.append(comment)

final = list(wanted.values())
ak_path.write_text("\n".join(final) + "\n")
print("SSH_ALLOWLIST_KEPT", [line.split()[-1] for line in final])
print("SSH_ALLOWLIST_REMOVED", removed)
print("SSH_ALLOWLIST_LINES", len(final))
if len(final) < 1:
    raise SystemExit("authorized_keys empty after ensure")
PY
