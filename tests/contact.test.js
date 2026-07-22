"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  normalizeContactPayload,
  validateContactPayload,
  buildMailText,
  createContactStore,
  deliverContactMail,
  smtpConfigured,
} = require("../lib/contact");

test("normalize and validate contact payload", () => {
  const data = normalizeContactPayload({
    firma: "  Acme A.Ş. ",
    vkn: "1234567890",
    email: "a@b.com",
    tel: "0555 507 07 24",
    mesaj: "10 adet laptop",
    spam: "ignore",
  });
  assert.equal(data.firma, "Acme A.Ş.");
  assert.equal(data.spam, undefined);
  const ok = validateContactPayload(data);
  assert.equal(ok.ok, true);
  assert.equal(ok.spam, false);
});

test("honeypot marks spam without failing", () => {
  const check = validateContactPayload({
    firma: "Acme",
    vkn: "1234567890",
    email: "a@b.com",
    tel: "05555070724",
    mesaj: "Merhaba test",
    _honey: "bot",
  });
  assert.equal(check.ok, true);
  assert.equal(check.spam, true);
});

test("invalid vkn rejected", () => {
  const check = validateContactPayload({
    firma: "Acme",
    vkn: "12",
    email: "a@b.com",
    tel: "05555070724",
    mesaj: "Merhaba test",
  });
  assert.equal(check.ok, false);
});

test("contact store appends leads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-contact-"));
  const store = createContactStore(dir);
  store.append({ id: "LEAD-1", firma: "Acme" });
  const all = store.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "LEAD-1");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildMailText includes core fields", () => {
  const text = buildMailText({
    firma: "Acme",
    vkn: "1234567890",
    email: "a@b.com",
    tel: "0555",
    mesaj: "Merhaba",
  });
  assert.match(text, /Acme/);
  assert.match(text, /1234567890/);
  assert.match(text, /Merhaba/);
});

test("deliverContactMail uses formsubmit fallback", async () => {
  assert.equal(smtpConfigured({}), false);
  let called = false;
  const result = await deliverContactMail(
    {
      firma: "Acme",
      vkn: "1234567890",
      email: "a@b.com",
      tel: "05555070724",
      mesaj: "Merhaba test mesaj",
      _subject: "Test",
    },
    {
      env: {},
      fetchImpl: async (url, opts) => {
        called = true;
        assert.match(String(url), /formsubmit\.co\/ajax\/info@patygoteknoloji\.com/);
        const body = JSON.parse(opts.body);
        assert.equal(body.email, "a@b.com");
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      },
    }
  );
  assert.equal(called, true);
  assert.equal(result.channel, "formsubmit");
  assert.equal(result.to, "info@patygoteknoloji.com");
});
