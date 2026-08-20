const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCustomerName,
  validateCustomerPhone,
  normalizeTrMobilePhone,
  formatTrMobilePhone,
} = require("../lib/customer-identity");

test("validateCustomerName rejects junk and invalid input", () => {
  const bad = [
    "",
    "Ali",
    "asdasdasd",
    "axax<zx",
    "a b",
    "123 456",
    "Test Test",
  ];
  for (const value of bad) {
    const result = validateCustomerName(value);
    assert.equal(result.ok, false, `"${value}" reddedilmeli`);
  }
});

test("validateCustomerName accepts real Turkish names", () => {
  const good = [
    "Ahmet Yılmaz",
    "Mehmet Demir",
    "Ayşe Kaya",
    "Ali Veli",
    "Jean-Pierre Dupont",
  ];
  for (const value of good) {
    const result = validateCustomerName(value);
    assert.equal(result.ok, true, `"${value}" kabul edilmeli`);
    assert.equal(result.value, value.replace(/\s+/g, " ").trim());
  }
});

test("validateCustomerPhone normalizes Turkish mobile numbers", () => {
  assert.equal(normalizeTrMobilePhone("0555 555 55 55"), "5555555555");
  assert.equal(normalizeTrMobilePhone("+90 555 555 55 55"), "5555555555");
  assert.equal(formatTrMobilePhone("5555555555"), "0555 555 55 55");

  assert.equal(validateCustomerPhone("05555555555").ok, true);
  assert.equal(validateCustomerPhone("5555555555").ok, true);
  assert.equal(validateCustomerPhone("0555").ok, false);
  assert.equal(validateCustomerPhone("02121234567").ok, false);
  assert.equal(validateCustomerPhone("").ok, false);
});
