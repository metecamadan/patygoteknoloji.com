const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findDueScheduleKey,
  getNextScheduledAt,
  scheduleSummary,
  SCHEDULE_MINUTES,
  buildScheduleMinutes,
} = require("../lib/supplier-schedule");
const { analyzeAkakceProducts } = require("../lib/akakce");

test("supplier schedule defaults to 08:00 every 180 minutes", () => {
  assert.deepEqual(SCHEDULE_MINUTES, [8 * 60, 11 * 60, 14 * 60, 17 * 60, 20 * 60]);
  const summary = scheduleSummary();
  assert.match(summary.summary, /08:00/);
  assert.match(summary.summary, /20:00/);
  assert.equal(summary.intervalMinutes, 180);
  assert.equal(summary.dailyPullCount, 5);
});

test("custom interval builds schedule until 20:00", () => {
  assert.deepEqual(buildScheduleMinutes(8 * 60, 120), [
    8 * 60,
    10 * 60,
    12 * 60,
    14 * 60,
    16 * 60,
    18 * 60,
    20 * 60,
  ]);
});

test("findDueScheduleKey matches exact Istanbul schedule minute", () => {
  const due = findDueScheduleKey(new Date("2026-08-13T05:00:00.000Z"));
  assert.equal(due, "2026-08-13 08:00");
  assert.equal(findDueScheduleKey(new Date("2026-08-13T05:01:00.000Z")), "");
});

test("getNextScheduledAt returns later slot same day", () => {
  const next = getNextScheduledAt(new Date("2026-08-13T05:00:00.000Z"));
  assert.equal(next.label, "13.08.2026 11:00");
});

test("daily quota error detector recognizes supplier limit messages", () => {
  const { isDailyQuotaError, sameIstanbulDay } = require("../lib/supplier-schedule");
  assert.equal(
    isDailyQuotaError("Günlük erişim sınırınız aşılmış. Lütfen ertesi gün tekrar deneyin."),
    true
  );
  assert.equal(isDailyQuotaError("zaman aşımı"), false);
  assert.equal(
    sameIstanbulDay("2026-08-14T08:30:00.000Z", new Date("2026-08-14T10:17:00.000Z")),
    true
  );
});

test("critical stock threshold excludes supplier products from Akakce feed", () => {
  const analysis = analyzeAkakceProducts(
    [
      {
        id: "s1",
        source: "supplier",
        active: true,
        supplierSku: "SKU-1",
        name: "Test",
        brand: "Patygo",
        price: 100,
        image: "https://cdn.example/a.jpg",
        mainCategory: "A",
        midCategory: "B",
        subCategory: "C",
        barcode: "123",
        manufacturerCode: "M1",
        gtipCode: "G1",
        vatPercent: 20,
        currency: "TRY",
        unit: "ADET",
        stockQty: 3,
        criticalStockQty: 5,
      },
    ],
    { siteBaseUrl: "https://patygoteknoloji.com" }
  );
  assert.equal(analysis.eligible.length, 0);
  assert.match(analysis.excluded[0].reasons.join(", "), /Stok yok/);
});
