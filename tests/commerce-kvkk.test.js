const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("kvkk page publishes retention schedule table", () => {
  const html = fs.readFileSync(path.join(root, "kvkk.html"), "utf8");
  assert.match(html, /Saklama Süresi/);
  assert.match(html, /10 yıl/);
  assert.match(html, /info-table/);
  assert.match(html, /Kart numarası/);
});

test("checkout requires KVKK consent and addresses", () => {
  const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
  const boxes = html.match(/<input type="checkbox" id="onay\w+"/g) || [];
  assert.deepEqual(boxes, ['<input type="checkbox" id="onaySozlesmeler"'], "one checkbox for all contracts");
  const label = (html.match(/<label for="onaySozlesmeler">([\s\S]*?)<\/label>/) || [])[1] || "";
  for (const href of ["/on-bilgilendirme-formu", "/mesafeli-satis-sozlesmesi", "/iade-ve-cayma", "/kvkk"]) {
    assert.match(label, new RegExp('href="' + href + '"'), "label links " + href);
  }
  // KVKK: aydınlatma okundu beyanı; açık rıza sözleşme onayına bağlanmaz.
  assert.doesNotMatch(label, /işlenmesini kabul/);
  assert.match(js, /onaySozlesmeler\?\.checked/);
  assert.doesNotMatch(js, /onayOnBilgi|onayMesafeli|onayIade|onayKvkk/);
  assert.match(html, /id="faturaAdres"/);
  assert.match(html, /id="teslimatAdres"/);
  assert.match(html, /customer-identity\.js/);
  assert.match(js, /PatygoCustomerIdentity/);
  assert.match(js, /kvkkAccepted/);
  assert.match(js, /billing: billing/);
});

test("sqlite commerce plan doc exists", () => {
  const doc = fs.readFileSync(path.join(root, "docs", "plan-commerce-db-kvkk.md"), "utf8");
  assert.match(doc, /SQLite/);
  assert.match(doc, /consent_events/);
  assert.match(doc, /Faz 1/);
  assert.match(doc, /Faz 2/);
  assert.match(doc, /anonymize|Anonimleştir/i);
  assert.match(doc, /retention/i);
});
