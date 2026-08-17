import re
import urllib.request

url = "https://patygoteknoloji.com/api/feeds/akakce.xml"
req = urllib.request.Request(url, headers={"User-Agent": "patygo-smoke"})
with urllib.request.urlopen(req, timeout=60) as res:
    body = res.read().decode("utf-8", errors="replace")
print("status", res.status)
print("bytes", len(body))
print("bilgisayarim_leak", bool(re.search(r"bilgisayarim", body, re.I)))
print("patygo_media", body.count("/media/catalog/"))
print("urun_count", body.count("<Urun>"))
m = re.search(r"<GorselBuyuk>([^<]+)</GorselBuyuk>", body)
if m:
    print("sample_image", m.group(1)[:120])
