#!/usr/bin/env bash
# Workflow dosyası push etmek için GitHub CLI'da workflow scope gerekir.
# Bir kez çalıştırın, cihaz kodunu onaylayın, ardından main'e push edilebilir.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI bulunamadı. https://cli.github.com adresinden kurun."
  exit 1
fi

echo "GitHub workflow scope yenileniyor..."
gh auth refresh -h github.com -s workflow,repo
gh auth status
echo
echo "Tamam. Artık .github/workflows/* değişikliklerini push edebilirsiniz:"
echo "  git push origin main"
