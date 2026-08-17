import re
import urllib.request

html = urllib.request.urlopen("https://patygoteknoloji.com/urunler").read().decode()
print("bootstrap", "patygo-catalog-bootstrap" in html)
print("loading_text", "Ürünler yükleniyor" in html)
m = re.search(r'id="patygo-catalog-bootstrap">(\{.*?\})</script>', html)
if m:
    import json
    data = json.loads(m.group(1))
    print("products", len(data.get("products", [])))
    print("total", data.get("total"))
