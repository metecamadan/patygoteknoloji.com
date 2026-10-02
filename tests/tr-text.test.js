const test = require("node:test");
const assert = require("node:assert/strict");
const { trLowerCase } = require("../lib/tr-text");

test("trLowerCase matches toLocaleLowerCase tr-TR including dotted/dotless I", () => {
  const samples = [
    "",
    "Lenovo IdeaPad",
    "İŞLEMCİ",
    "ışık IŞIK",
    "Intel Core I7 1355U",
    "I\u0307stanbul",
    "ĞÜŞÖÇ ğüşöç",
    "ǅ ΣΑΣ Straße ﬃ",
    "SSD 512GB M.2 NVMe",
  ];
  for (const value of samples) {
    assert.equal(trLowerCase(value), value.toLocaleLowerCase("tr-TR"), JSON.stringify(value));
  }
  assert.equal(trLowerCase(null), "");
  assert.equal(trLowerCase(undefined), "");
  assert.equal(trLowerCase(42), "42");
});
