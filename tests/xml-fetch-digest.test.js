const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createXmlFetchDigestStore } = require("../lib/xml-fetch-digest");

test("xml fetch digest exposes yesterday alert after failed attempts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-xml-digest-"));
  const store = createXmlFetchDigestStore(root);
  store.recordAttempt({
    at: "2026-08-18T05:00:00.000Z",
    slotId: "supplier-1",
    dueKey: "2026-08-18 08:00",
    ok: false,
    quota: true,
    error: "Günlük erişim sınırınız aşılmış.",
  });
  const alert = store.getYesterdayAlert(new Date("2026-08-19T05:00:00.000Z"));
  assert.ok(alert);
  assert.equal(alert.failureCount, 1);
  assert.match(alert.headline, /kota/i);
  store.dismissAlert(alert.date);
  assert.equal(store.getYesterdayAlert(new Date("2026-08-19T05:00:00.000Z")), null);
  fs.rmSync(root, { recursive: true, force: true });
});
