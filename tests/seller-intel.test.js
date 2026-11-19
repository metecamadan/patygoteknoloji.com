const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dedupeSellers,
  extractProductLinks,
  extractStoreLinks,
  parseStorePage,
  refuseOffer,
  summarizeSellers,
} = require("../lib/seller-intel");
const { collectMapSellers } = require("../lib/seller-intel/maps");
const { priceListHtml, runTour } = require("../lib/seller-intel/tour");

const CATEGORY = `
  <a title="Vatan" href="/magaza/vatan.html">Vatan</a>
  <a href="/laptop-notebook/en-ucuz-ornek-notebook-fiyati,1.html">ürün</a>
  <a title="Gratis" href="/magaza/gratis.html">Gratis</a>
`;

const PRODUCT = `
  <section class="pl_v9">
    <a title="Vatan Bilgisayar" href="/magaza/vatan.html">Vatan Bilgisayar</a>
    <a title="Teknosa" href="/magaza/teknosacom.html">Teknosa</a>
  </section>
  <a title="Gratis" href="/magaza/gratis.html">Gratis</a>
  <p>Tüm Satıcılar</p>
`;

test("category page yields notebook products, not the footer store list", () => {
  assert.deepEqual(extractProductLinks(CATEGORY, "laptop-notebook"), [
    "/laptop-notebook/en-ucuz-ornek-notebook-fiyati,1.html",
  ]);
  assert.equal(extractStoreLinks(CATEGORY).length, 2);
});

test("product price list ignores the footer stores", () => {
  const slice = priceListHtml(PRODUCT);
  assert.deepEqual(
    extractStoreLinks(slice).map((row) => row.ad),
    ["Vatan Bilgisayar", "Teknosa"]
  );
});

test("store page keeps the published name and mailto only", () => {
  const row = parseStorePage(
    `<h1>Teknosa</h1> İç ve Dış Ticaret A.Ş. <a href="mailto:info@teknosa.com">yaz</a> <a href="https://www.teknosa.com/iletisim">site</a>`,
    "https://www.akakce.com/magaza/teknosacom.html",
    "Dizüstü bilgisayar"
  );
  assert.equal(row.ad, "Teknosa");
  assert.equal(row.eposta, "info@teknosa.com");
  assert.equal(row.site, "https://www.teknosa.com/iletisim");
  assert.equal(row.kanal, "pazaryeri");
});

test("same phone or trade name collapses to one seller", () => {
  const merged = dedupeSellers([
    { ad: "Vatan", telefon: "0212 000 00 00", site: "https://www.akakce.com/magaza/vatan.html" },
    { ad: "Vatan Bilgisayar", telefon: "+90 212 000 00 00", site: "https://vatan.com" },
    { ad: "Başka", telefon: "", site: "" },
  ]);
  assert.equal(merged.kayitlar.length, 2);
  assert.equal(merged.mukerrer, 1);
});

test("summary counts complete contacts and stays in phase 1", () => {
  const summary = summarizeSellers([
    { ad: "A", sehir: "İstanbul", kanal: "pazaryeri", telefon: "02120000000", eposta: "a@a.com", site: "https://a.com" },
    { ad: "B", sehir: "", kanal: "pazaryeri", telefon: "", eposta: "", site: "https://www.akakce.com/magaza/b.html" },
  ]);
  assert.equal(summary.tam, 1);
  assert.equal(summary.eksik, 1);
  assert.equal(summary.faz2, "kapali");
  assert.throws(refuseOffer, /Faz 2 kapalı/);
});

test("map collection does not call the network without a key and drops non-TR places", async () => {
  let calls = 0;
  const empty = await collectMapSellers({ fetchImpl: () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.deepEqual(empty.atlanan.map((row) => row.kaynak), ["google", "yandex"]);
  const fetched = await collectMapSellers({
    googleKey: "test-key",
    yandexKey: "",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        places: [
          { displayName: { text: "Yurt dışı" }, addressComponents: [{ shortText: "DE", types: ["country"] }] },
          {
            displayName: { text: "Ankara Elektronik" },
            nationalPhoneNumber: "0312 000 00 00",
            websiteUri: "https://ornek.example",
            addressComponents: [{ shortText: "TR", types: ["country"] }],
            location: { latitude: 39.9, longitude: 32.8 },
          },
        ],
      }),
    }),
  });
  assert.deepEqual(fetched.kayitlar.map((row) => row.ad), ["Ankara Elektronik"]);
  assert.equal(fetched.kayitlar[0].kanal, "harita");
});

test("a tour reads one electronics category and does not send an offer", async () => {
  const pages = {
    "https://www.akakce.com/laptop-notebook.html": CATEGORY,
    "https://www.akakce.com/laptop-notebook/en-ucuz-ornek-notebook-fiyati,1.html": PRODUCT,
    "https://www.akakce.com/magaza/vatan.html": `<h1>Vatan</h1> Bilgisayar <a href="mailto:destek@vatan.example">m</a>`,
    "https://www.akakce.com/magaza/teknosacom.html": `<h1>Teknosa</h1> A.Ş.`,
  };
  const result = await runTour({
    limit: 2,
    delayMs: 0,
    fetchImpl: async (url) => {
      const body = pages[url];
      if (!body) return { ok: false, status: 404, text: async () => "" };
      return { ok: true, status: 200, text: async () => body };
    },
  });
  assert.deepEqual(result.kayitlar.map((row) => row.ad).sort(), ["Teknosa", "Vatan"]);
  assert.equal(result.kayitlar.some((row) => row.ad === "Gratis"), false);
  assert.equal(result.kayitlar.find((row) => row.ad === "Vatan").eposta, "destek@vatan.example");
  assert.equal(result.ozet.faz2, "kapali");
  assert.ok(result.ozet.gidilmeyenKategori.includes("Cep telefonu"));
  assert.equal(result.ozet.haritaAtlanan.length, 2);
});
