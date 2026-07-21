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
echo "DEPLOY_HOST = patygoteknoloji.com"
echo "DEPLOY_USER = $(whoami)"
echo "DEPLOY_SSH_KEY = sadece aşağıdaki OpenSSH bloğu (tırnak yok)"
echo
echo "Kopyala: cat ${KEY_PATH}"
echo "İlk satır şöyle olmalı: -----BEGIN OPENSSH PRIVATE KEY-----"
echo "Son satır şöyle olmalı: -----END OPENSSH PRIVATE KEY-----"
echo
cat "${KEY_PATH}"
echo
echo "Repo → Settings → Secrets and variables → Actions → New repository secret"
echo "  DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY"
echo "Not: Script etiketlerini (DEPLOY_SSH_KEY yazısı vb.) secret'a ekleme."
