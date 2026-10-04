const test = require("node:test");
const assert = require("node:assert/strict");
const { formatBrandName } = require("../lib/brand-name");

test("uppercase supplier brands become title case without dotted-i artefacts", () => {
  assert.equal(formatBrandName("KINGSTON"), "Kingston");
  assert.equal(formatBrandName("LOGITECH"), "Logitech");
  assert.equal(formatBrandName("CASIO"), "Casio");
  assert.equal(formatBrandName("HIGH POWER"), "High Power");
  assert.equal(formatBrandName("FRİSBY"), "Frisby");
  assert.equal(formatBrandName("DELL"), "Dell");
});

test("Turkish brands keep Turkish letters", () => {
  assert.equal(formatBrandName("ARÇELİK"), "Arçelik");
  assert.equal(formatBrandName("ÇAYKUR"), "Çaykur");
});

test("acronyms and known stylings use the override table", () => {
  assert.equal(formatBrandName("HP"), "HP");
  assert.equal(formatBrandName("Hp"), "HP");
  assert.equal(formatBrandName("MSI"), "MSI");
  assert.equal(formatBrandName("Msı"), "MSI");
  assert.equal(formatBrandName("TP-LINK"), "TP-Link");
  assert.equal(formatBrandName("BENQ"), "BenQ");
});

test("mixed-case brands are kept as written", () => {
  assert.equal(formatBrandName("SanDisk"), "SanDisk");
  assert.equal(formatBrandName("PowerColor"), "PowerColor");
});

test("short unknown brands are uppercased", () => {
  assert.equal(formatBrandName("ttec"), "Ttec");
  assert.equal(formatBrandName("lg"), "LG");
  assert.equal(formatBrandName("abc"), "ABC");
});

test("empty input yields empty string", () => {
  assert.equal(formatBrandName(""), "");
  assert.equal(formatBrandName(null), "");
});
