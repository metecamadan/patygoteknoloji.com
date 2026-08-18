const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("storefront and admin copy has no fake stats or self-report health", () => {
  const indexHtml = read("index.html");
  const markalarHtml = read("markalar.html");
  const adminHtml = read("admin.html");
  const adminJs = read("assets/js/admin.js");
  const mainJs = read("assets/js/main.js");
  const server = read("server.js");

  assert.doesNotMatch(indexHtml, /43\+/);
  assert.doesNotMatch(indexHtml, /7\/24/);
  assert.doesNotMatch(indexHtml, /binlerce ürün/i);
  assert.doesNotMatch(indexHtml, /Arçelik|Korkmaz/);
  assert.doesNotMatch(indexHtml, /partners-track/);
  assert.match(indexHtml, /KDV dahil/);
  assert.match(indexHtml, /3D Secure/);
  assert.match(indexHtml, /Pzt–Cmt destek|Pzt-Cmt destek/);

  assert.doesNotMatch(markalarHtml, /43\+/);
  assert.match(markalarHtml, /<strong>%100<\/strong><span>Faturalı satış<\/span>/);

  assert.doesNotMatch(adminHtml, /Sistem hazır/);
  assert.doesNotMatch(adminHtml, /id="dashServerStatus"/);
  assert.doesNotMatch(adminHtml, /e-posta gider/);
  assert.doesNotMatch(adminHtml, /FormSubmit başarılı/);
  assert.match(adminHtml, /id="dashSmtp"/);
  assert.match(adminHtml, /data-smtp-mail-help/);

  assert.doesNotMatch(adminJs, /apiReachable/);
  assert.doesNotMatch(adminJs, /API yanıt verdi/);
  assert.doesNotMatch(adminJs, /Sistem hazır/);
  assert.match(adminJs, /applySmtpMailHelp/);

  assert.doesNotMatch(mainJs, /adresine iletildi/);
  assert.match(mainJs, /Talebiniz alındı/);

  assert.doesNotMatch(server, /apiReachable/);
  assert.match(server, /smtpConfigured: smtpConfigured\(process\.env\)/);
});
