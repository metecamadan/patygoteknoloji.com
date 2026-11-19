const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildDailyMail, categoryForDay, runDaily, LINKEDIN_NOTE } = require("../lib/seller-intel/daily");
const { parseMerchantPage, sellerEmail } = require("../lib/seller-intel/hepsiburada");
const { dedupeSellers } = require("../lib/seller-intel/parse");

test("marketplace hosts do not collapse different sellers", () => {
  const merged = dedupeSellers([
    { ad: "Birinci", site: "https://www.hepsiburada.com/magaza/birinci", telefon: "" },
    { ad: "İkinci", site: "https://www.hepsiburada.com/magaza/ikinci", telefon: "" },
  ]);
  assert.equal(merged.kayitlar.length, 2);
});

test("hepsiburada page keeps the seller mail and drops the marketplace mail", () => {
  assert.equal(sellerEmail("destek@hepsiburada.com"), "");
  const row = parseMerchantPage(
    `<h1>Örnek Elektronik</h1>
     <div>Telefon</span><span>0212 111 22 33</span></div>
     <div>E-posta</span><span>info@ornek-elektronik.com</span></div>
     <a href="mailto:destek@hepsiburada.com">hb</a>`,
    "https://www.hepsiburada.com/magaza/ornek-elektronik",
    "Monitör"
  );
  assert.equal(row.ad, "Örnek Elektronik");
  assert.equal(row.telefon, "0212 111 22 33");
  assert.equal(row.eposta, "info@ornek-elektronik.com");
  assert.equal(row.kanal, "hepsiburada");
});

test("daily mail names the owner and does not claim a LinkedIn person was found", () => {
  const mail = buildDailyMail(
    {
      ozet: { gun: "2026-11-19", turKategori: "Monitör", buTurYeni: 1, bulunan: 1, tam: 0, eksik: 1 },
      yayin: [{ ad: "Örnek Elektronik", kanal: "hepsiburada", telefon: "0212 111 22 33", eposta: "info@ornek-elektronik.com" }],
    },
    "mete.camadan@patygoteknoloji.com"
  );
  assert.equal(mail.to, "mete.camadan@patygoteknoloji.com");
  assert.match(mail.text, /info@ornek-elektronik.com/);
  assert.match(mail.text, new RegExp(LINKEDIN_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(mail.text, /Faz 2 kapalı/);
  assert.doesNotMatch(mail.text, /linkedin\.com/i);
});

test("one Istanbul day sends one summary and does not call LinkedIn", async () => {
  const category = categoryForDay("2026-11-19");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seller-daily-"));
  const seen = [];
  const pages = {
    [`https://www.akakce.com${category.yol}`]: `<a href="${category.yol.replace(".html", "")}/en-ucuz-ornek-fiyati,1.html">ürün</a>`,
    [`https://www.akakce.com${category.yol.replace(".html", "")}/en-ucuz-ornek-fiyati,1.html`]:
      `<section class="pl_v9"><a title="Vatan" href="/magaza/vatan.html">Vatan</a></section>`,
    "https://www.akakce.com/magaza/vatan.html": `<h1>Vatan</h1> Bilgisayar`,
  };
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.startsWith("https://www.hepsiburada.com/ara")) {
      return {
        ok: true,
        status: 200,
        text: async () => `<a href="/magaza/ornek-elektronik">Örnek</a>`,
      };
    }
    if (href === "https://www.hepsiburada.com/magaza/ornek-elektronik") {
      return {
        ok: true,
        status: 200,
        text: async () =>
          `<h1>Örnek Elektronik</h1><div>E-posta</span><span>info@ornek-elektronik.com</span></div>`,
      };
    }
    const body = pages[href];
    if (!body) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
  const sent = [];
  const morning = new Date("2026-11-19T07:30:00Z");
  const early = await runDaily({
    now: new Date("2026-11-19T04:00:00Z"),
    dir,
    fetchImpl,
    sendImpl: async (mail) => sent.push(mail),
    env: {},
  });
  assert.equal(early.skipped, true);
  assert.equal(seen.length, 0);
  const first = await runDaily({
    now: morning,
    dir,
    fetchImpl,
    delayMs: 0,
    limit: 2,
    hepsiburadaLimit: 2,
    sendImpl: async (mail) => sent.push(mail),
    env: { SELLER_INTEL_TO: "mete.camadan@patygoteknoloji.com" },
  });
  assert.equal(first.skipped, false);
  assert.equal(first.ozet.mail, "gitti");
  assert.match(sent[0].text, /info@ornek-elektronik.com/);
  assert.equal(seen.some((url) => /linkedin/i.test(url)), false);
  const second = await runDaily({
    now: morning,
    dir,
    fetchImpl,
    sendImpl: async (mail) => sent.push(mail),
    env: {},
  });
  assert.equal(second.skipped, true);
  assert.equal(sent.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
