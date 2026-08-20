#!/usr/bin/env bash
# Geriye uyumluluk: eski ad. Asıl kurulum scripts/server-bootstrap.sh
echo "Not: gcp-bootstrap.sh adı tarihseldir; Google Cloud zorunlu değildir."
echo "Yönlendiriliyor → scripts/server-bootstrap.sh"
exec "$(cd "$(dirname "$0")" && pwd)/server-bootstrap.sh" "$@"
