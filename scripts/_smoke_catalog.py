import json
import urllib.request

for path in ("/urunler", "/api/catalog-bootstrap"):
    req = urllib.request.Request(
        "https://patygoteknoloji.com" + path,
        headers={"User-Agent": "patygo-smoke"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        print(path, res.status)
        body = res.read().decode("utf-8", errors="replace")
        if path == "/urunler":
            print("loading_text", "Ürünler yükleniyor" in body)
            print("infinite", "data-catalog-infinite" in body)
        else:
            data = json.loads(body)
            print("products", len(data.get("products", [])))
            print("total", data.get("total"))
