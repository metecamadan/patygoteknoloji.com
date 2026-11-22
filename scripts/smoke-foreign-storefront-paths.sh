#!/usr/bin/env bash
# Live SEO smoke: foreign storefront probes must be 410 Gone (not a Shopify shop).
set -euo pipefail
PUBLIC_URL="${1:-https://patygoteknoloji.com}"
PUBLIC_URL="${PUBLIC_URL%/}"

prod="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL}/products/seo-probe-not-a-product")"
[ "$prod" = "410" ] || { echo "/products/ probe HTTP $prod (expected 410 Gone)"; exit 1; }

coll="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL}/collections/seo-probe-not-a-collection")"
[ "$coll" = "410" ] || { echo "/collections/ probe HTTP $coll (expected 410 Gone)"; exit 1; }

echo "foreign storefront paths: 410 OK"
