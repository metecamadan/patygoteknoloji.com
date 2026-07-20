#!/usr/bin/env bash
# Sunucuda bir kez çalıştırın:
#   bash scripts/setup-github-deploy-key.sh
# Çıkan private key'i GitHub → Settings → Secrets → Actions içine DEPLOY_SSH_KEY olarak ekleyin.
set -euo pipefail

KEY_PATH="${HOME}/.ssh/github_actions_deploy"
AUTHORIZED="${HOME}/.ssh/authorized_keys"

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"

if [[ ! -f "${KEY_PATH}" ]]; then
  ssh-keygen -t ed25519 -f "${KEY_PATH}" -N "" -C "github-actions-patygo-deploy"
fi

PUB="$(cat "${KEY_PATH}.pub")"
touch "${AUTHORIZED}"
chmod 600 "${AUTHORIZED}"
if ! grep -qxF "${PUB}" "${AUTHORIZED}"; then
  echo "${PUB}" >> "${AUTHORIZED}"
  echo "Public key authorized_keys'e eklendi."
else
  echo "Public key zaten authorized_keys içinde."
fi

echo
echo "===== GitHub Secrets ====="
echo "DEPLOY_HOST = $(curl -fsS ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo "DEPLOY_USER = $(whoami)"
echo "DEPLOY_SSH_KEY = (aşağıdaki private key'in tamamı)"
echo
echo "----- BEGIN PRIVATE KEY (DEPLOY_SSH_KEY) -----"
cat "${KEY_PATH}"
echo "----- END PRIVATE KEY -----"
echo
echo "Repo → Settings → Secrets and variables → Actions → New repository secret"
echo "  DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY"
