const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveOpsHealth } = require("../lib/ops-health");

test("ops health stays empty when XML is clean and live POS is on", () => {
  assert.equal(
    resolveOpsHealth({
      slots: [{ lastFetchStatus: "ok" }],
      pos: { enabled: true, testMode: false },
    }),
    null
  );
});

test("ops health prefers yesterday XML quota over POS", () => {
  const health = resolveOpsHealth({
    yesterdayAlert: {
      headline: "Dün XML kotası doldu; otomatik okumalar atlandı.",
      quotaCount: 3,
    },
    pos: { enabled: false, testMode: true },
  });
  assert.equal(health.tone, "err");
  assert.equal(health.label, "Dün XML kotası");
  assert.equal(health.action, "xml");
});

test("ops health flags today's XML quota and generic XML errors", () => {
  const quota = resolveOpsHealth({
    slots: [
      {
        lastFetchStatus: "error",
        lastError: "Günlük erişim sınırınız aşıldı.",
      },
    ],
    pos: { enabled: true, testMode: false },
  });
  assert.equal(quota.label, "XML kotası doldu");
  assert.equal(quota.tone, "err");

  const fail = resolveOpsHealth({
    slots: [{ lastFetchStatus: "error", lastError: "IP adresiniz tanımlı değil" }],
    pos: { enabled: true, testMode: false },
  });
  assert.equal(fail.label, "XML hatası");
  assert.match(fail.title, /IP/);
});

test("ops health warns when POS is off or in test mode", () => {
  const off = resolveOpsHealth({
    slots: [],
    pos: { enabled: false, testMode: true },
  });
  assert.equal(off.label, "POS kapalı");
  assert.equal(off.tone, "warn");
  assert.equal(off.action, "overview");

  const testMode = resolveOpsHealth({
    slots: [],
    pos: { enabled: true, testMode: true },
  });
  assert.equal(testMode.label, "POS test modu");
});

test("ops health never reports a fake ready/online state", () => {
  const rows = [
    resolveOpsHealth({ slots: [], pos: { enabled: false } }),
    resolveOpsHealth({
      slots: [{ lastFetchStatus: "error", lastError: "timeout" }],
      pos: { enabled: true },
    }),
    resolveOpsHealth({
      yesterdayAlert: { headline: "Dün XML otomatik okumaları başarısız oldu." },
      pos: { enabled: true, testMode: false },
    }),
  ];
  rows.forEach((row) => {
    assert.ok(row);
    assert.doesNotMatch(row.label, /hazır|online|canlı sistem/i);
  });
});
