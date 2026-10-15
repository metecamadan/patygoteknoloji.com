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
  ensureRates,
  latestDailyCutoff,
  ratesDueForRefresh,
  ratesAreStale,
} = require("../lib/fx");

const TCMB_XML = `<?xml version="1.0"?>
    <Tarih_Date Tarih="15.10.2026" Date="10/15/2026" Bulten_No="2026/196">
      <Currency Kod="USD"><ForexSelling>49,4204</ForexSelling></Currency>
      <Currency Kod="EUR"><ForexSelling>55,4110</ForexSelling></Currency>
    </Tarih_Date>`;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patygo-fx-"));
}

function tcmbFetch(calls) {
  return async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => TCMB_XML };
  };
}

test("TCMB xml yields USD and EUR selling rates", () => {
  const xml = `<?xml version="1.0"?>
    <Tarih_Date>
      <Currency Kod="USD"><ForexSelling>40,1234</ForexSelling></Currency>
      <Currency Kod="EUR"><ForexSelling>46,5000</ForexSelling></Currency>
    </Tarih_Date>`;
  const rates = parseTcmbXml(xml);
  assert.equal(rates.USD, 40.1234);
  assert.equal(rates.EUR, 46.5);
  assert.equal(parseTcmbXml(TCMB_XML).rateDate, "15.10.2026");
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
  const root = tempRoot();
  writeCachedRates(root, { USD: 41, EUR: 47, fetchedAt: "2026-08-15T00:00:00.000Z", rateDate: "14.08.2026" });
  const cached = readCachedRates(root);
  assert.equal(cached.USD, 41);
  assert.equal(cached.EUR, 47);
  assert.equal(cached.rateDate, "14.08.2026");
  fs.rmSync(root, { recursive: true, force: true });
});

test("daily refresh is due once per TCMB publication (15:45 Istanbul)", () => {
  assert.equal(latestDailyCutoff(new Date("2026-10-15T13:00:00Z")).toISOString(), "2026-10-15T12:45:00.000Z");
  assert.equal(latestDailyCutoff(new Date("2026-10-15T09:00:00Z")).toISOString(), "2026-10-14T12:45:00.000Z");

  const morning = { USD: 49, EUR: 55, fetchedAt: "2026-10-15T06:00:00.000Z" };
  assert.equal(ratesDueForRefresh(morning, new Date("2026-10-15T10:00:00Z")), false, "yesterday's rate is still the latest");
  assert.equal(ratesDueForRefresh(morning, new Date("2026-10-15T13:00:00Z")), true, "today's rate is out");
  const afternoon = { USD: 49, EUR: 55, fetchedAt: "2026-10-15T12:50:00.000Z" };
  assert.equal(ratesDueForRefresh(afternoon, new Date("2026-10-15T20:00:00Z")), false);
  assert.equal(ratesDueForRefresh(null), true);
});

test("a rate older than a day and a bit is reported as stale", () => {
  const now = new Date("2026-10-15T13:00:00Z");
  assert.equal(ratesAreStale({ fetchedAt: "2026-10-14T13:00:00.000Z" }, now), false);
  assert.equal(ratesAreStale({ fetchedAt: "2026-08-15T13:00:00.000Z" }, now), true);
  assert.equal(ratesAreStale(null, now), true);
});

test("ensureRates refreshes an old cache instead of pricing with it", async () => {
  const root = tempRoot();
  try {
    writeCachedRates(root, { USD: 47.8066, EUR: 55.2385, fetchedAt: "2026-08-15T12:00:00.000Z" });
    const calls = [];
    const rates = await ensureRates(root, { fetchImpl: tcmbFetch(calls), allowStale: true });
    assert.equal(calls.length, 1);
    assert.equal(rates.USD, 49.4204);
    assert.equal(readCachedRates(root).USD, 49.4204);
    assert.equal(readCachedRates(root).rateDate, "15.10.2026");

    const again = await ensureRates(root, { fetchImpl: tcmbFetch(calls) });
    assert.equal(calls.length, 1, "a fresh cache is reused");
    assert.equal(again.USD, 49.4204);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ensureRates falls back to the old cache only when TCMB is unreachable", async () => {
  const root = tempRoot();
  try {
    writeCachedRates(root, { USD: 47.8066, EUR: 55.2385, fetchedAt: "2026-08-15T12:00:00.000Z" });
    const down = async () => ({ ok: false, status: 503, text: async () => "" });
    assert.equal((await ensureRates(root, { fetchImpl: down })).USD, 47.8066);
    await assert.rejects(ensureRates(root, { fetchImpl: down, allowStale: false }), /503/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
