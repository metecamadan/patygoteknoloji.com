const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  TR_PROVINCES,
  TR_DISTRICTS,
  canonicalDistrict,
  normalizeAddress,
  normalizeInvoiceIdentity,
  isValidTckn,
} = require("../lib/checkout-billing");
const { buildSalesInvoicePayload } = require("../lib/bizimhesap");

const root = path.resolve(__dirname, "..");

test("TR_PROVINCES lists all 81 provinces once and odeme.html offers the same options", () => {
  assert.equal(TR_PROVINCES.length, 81);
  assert.equal(new Set(TR_PROVINCES).size, 81);
  const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
  const select = html.match(/<select id="faturaIl"[\s\S]*?<\/select>/);
  assert.ok(select, "fatura il seçimi olmalı");
  const options = Array.from(select[0].matchAll(/<option value="([^"]+)">/g)).map((m) => m[1]);
  assert.deepEqual(options.slice().sort(), TR_PROVINCES.slice().sort());
  assert.match(html, /<select id="teslimatIl"/);
});

test("TR_DISTRICTS covers every province with 973 districts and the ilçe fields are province-bound selects", () => {
  assert.deepEqual(Object.keys(TR_DISTRICTS).sort(), TR_PROVINCES.slice().sort());
  const total = Object.values(TR_DISTRICTS).reduce((n, names) => n + names.length, 0);
  assert.equal(total, 973);
  Object.entries(TR_DISTRICTS).forEach(([city, names]) => {
    assert.ok(names.length > 0, city + " ilçesiz olmamalı");
    assert.equal(new Set(names).size, names.length, city + " ilçeleri tekrarsız olmalı");
  });
  assert.equal(TR_DISTRICTS["İstanbul"].length, 39);
  assert.ok(TR_DISTRICTS["İstanbul"].includes("Gaziosmanpaşa"));

  const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
  assert.match(html, /<select id="faturaIlce" name="faturaIlce" required disabled data-district-for="faturaIl"/);
  assert.match(html, /<select id="teslimatIlce" name="teslimatIlce" disabled data-district-for="teslimatIl"/);
  assert.doesNotMatch(html, /<input[^>]+id="(fatura|teslimat)Ilce"/);
  const js = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
  assert.match(js, /\/assets\/geo\/tr-districts\.json/);
  assert.match(js, /bindDistrictSelects\(\)/);
});

test("normalizeAddress accepts only districts of the chosen province and stores the official spelling", () => {
  const base = { line: "Mevlana Mah. 911 Sk. No:19", city: "İstanbul" };
  assert.equal(normalizeAddress(Object.assign({}, base, { district: "gaziosmanpaşa" })).value.district, "Gaziosmanpaşa");
  assert.equal(normalizeAddress(Object.assign({}, base, { district: "ŞİŞLİ" })).value.text, "Mevlana Mah. 911 Sk. No:19, Şişli / İstanbul");
  assert.match(normalizeAddress(Object.assign({}, base, { district: "Çankaya" })).error, /İstanbul ilçeleri listesinden/);
  assert.match(normalizeAddress(Object.assign({}, base, { district: "Uydurma" }), "Teslimat adresi").error, /^Teslimat adresi: ilçeyi/);
  assert.equal(canonicalDistrict("Ankara", "Çankaya"), "Çankaya");
  assert.equal(canonicalDistrict("Ağrı", "merkez"), "Merkez");
  assert.equal(canonicalDistrict("Paris", "Kadıköy"), "");
});

test("normalizeAddress builds the order address line and rejects incomplete parts", () => {
  const ok = normalizeAddress({ line: "Bağdat Cad. No:45 D:3", district: "Kadıköy", city: "İstanbul", postalCode: "34710" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.text, "Bağdat Cad. No:45 D:3, Kadıköy / İstanbul 34710");
  assert.equal(normalizeAddress({ line: "Bağdat Cad. No:45", district: "Kadıköy", city: "İstanbul" }).value.text,
    "Bağdat Cad. No:45, Kadıköy / İstanbul");
  assert.match(normalizeAddress({ line: "No:1", district: "Kadıköy", city: "İstanbul" }).error, /açık adres/);
  assert.match(normalizeAddress({ line: "Bağdat Cad. No:45", district: "", city: "İstanbul" }).error, /ilçe/);
  assert.match(normalizeAddress({ line: "Bağdat Cad. No:45", district: "Kadıköy", city: "Paris" }).error, /il seçin/);
  assert.match(
    normalizeAddress({ line: "Bağdat Cad. No:45", district: "Kadıköy", city: "İstanbul", postalCode: "99000" }, "Teslimat adresi").error,
    /^Teslimat adresi: posta kodu/
  );
});

test("isValidTckn checks the official checksum", () => {
  assert.equal(isValidTckn("10000000146"), true);
  assert.equal(isValidTckn("10000000147"), false);
  assert.equal(isValidTckn("01234567890"), false);
  assert.equal(isValidTckn("1000000014"), false);
});

test("normalizeInvoiceIdentity separates individual and corporate invoices", () => {
  assert.deepEqual(normalizeInvoiceIdentity({ customerType: "bireysel", taxId: "", company: "" }).value, {
    customerType: "bireysel",
    taxId: "",
    company: "",
    taxOffice: "",
  });
  assert.equal(normalizeInvoiceIdentity({ customerType: "bireysel", taxId: "10000000146" }).ok, true);
  assert.match(normalizeInvoiceIdentity({ customerType: "bireysel", taxId: "12345678901" }).error, /T\.C\./);

  const corp = normalizeInvoiceIdentity({
    customerType: "kurumsal",
    company: "Örnek Bilişim Ltd. Şti.",
    taxOffice: "Kadıköy",
    taxId: "123 456 7890",
  });
  assert.equal(corp.ok, true);
  assert.equal(corp.value.taxId, "1234567890");
  assert.equal(normalizeInvoiceIdentity({ customerType: "kurumsal", company: "A", taxOffice: "Kadıköy", taxId: "1234567890" }).ok, false);
  assert.match(normalizeInvoiceIdentity({ customerType: "kurumsal", company: "Örnek", taxOffice: "", taxId: "1234567890" }).error, /vergi dairesi/);
  assert.equal(normalizeInvoiceIdentity({ customerType: "kurumsal", company: "Örnek", taxOffice: "Kadıköy", taxId: "10000000146" }).ok, true);
});

test("BizimHesap invoice uses company title, tax id and tax office from checkout", () => {
  const payload = buildSalesInvoicePayload(
    {
      id: "PTY-1",
      subtotal: 100,
      vat: 20,
      total: 120,
      customer: {
        name: "Ayşe Yılmaz",
        customerType: "kurumsal",
        company: "Örnek Bilişim Ltd. Şti.",
        taxId: "1234567890",
        taxOffice: "Kadıköy",
        email: "a@example.com",
        billingAddress: "Bağdat Cad. No:45, Kadıköy / İstanbul",
      },
      items: [{ productId: "p1", name: "Ürün", qty: 1, line: 100, lineVat: 20, vatPercent: 20 }],
    },
    { BIZIMHESAP_FIRM_ID: "f" }
  );
  assert.equal(payload.customer.title, "Örnek Bilişim Ltd. Şti.");
  assert.equal(payload.customer.taxNo, "1234567890");
  assert.equal(payload.customer.taxOffice, "Kadıköy");
});

test("checkout form validates phone live and hides the order number until the bank step", () => {
  const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
  assert.doesNotMatch(js, /function makeOrderId/);
  assert.match(html, /id="orderIdRow" hidden/);
  assert.match(html, /name="customerType" value="bireysel" checked/);
  assert.match(html, /name="customerType" value="kurumsal"/);
  assert.match(html, /id="vergiDairesi"/);
  assert.match(html, /id="faturaIlce"/);
  assert.match(html, /id="faturaPosta"/);
  assert.match(html, /id="tel-error"/);
  assert.match(js, /bindLiveValidation/);
  assert.match(js, /aria-invalid/);
  assert.match(js, /customerType/);
  assert.match(js, /billing: billing/);
});
