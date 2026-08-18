const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("admin does not self-report process health as site health", () => {
  const adminHtml = read("admin.html");
  const adminJs = read("assets/js/admin.js");
  const server = read("server.js");

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

  assert.doesNotMatch(server, /apiReachable/);
  assert.match(server, /smtpConfigured: smtpConfigured\(process\.env\)/);
});
