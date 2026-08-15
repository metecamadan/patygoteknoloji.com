const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseTcmbXml,
  convertCostToTry,
  writeCachedRates,
  readCachedRates,
  normalizeCurrencyCode,
} = require("../lib/fx");

test("TCMB xml yields USD and EUR selling rates", () => {
  const xml = `<?xml version="1.0"?>
    <Tarih_Date>
      <Currency Kod="USD"><ForexSelling>40,1234</ForexSelling></Currency>
      <Currency Kod="EUR"><ForexSelling>46,5000</ForexSelling></Currency>
    </Tarih_Date>`;
  const rates = parseTcmbXml(xml);
  assert.equal(rates.USD, 40.1234);
  assert.equal(rates.EUR, 46.5);
});

test("convertCostToTry keeps TRY/TL and converts USD/EUR", () => {
  const rates = { USD: 40, EUR: 46 };
  assert.equal(convertCostToTry(70, "USD", rates), 2800);
  assert.equal(convertCostToTry(10, "EUR", rates), 460);
  assert.equal(convertCostToTry(100, "TL", rates), 100);
  assert.equal(convertCostToTry(100, "TRY", null), 100);
  assert.equal(convertCostToTry(70, "USD", null), null);
  assert.equal(normalizeCurrencyCode("tl"), "TRY");
});

test("fx cache roundtrip", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-fx-"));
  writeCachedRates(root, { USD: 41, EUR: 47, fetchedAt: "2026-08-15T00:00:00.000Z" });
  const cached = readCachedRates(root);
  assert.equal(cached.USD, 41);
  assert.equal(cached.EUR, 47);
  fs.rmSync(root, { recursive: true, force: true });
});
