const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const consentJs = read("assets/js/consent.js");
const GA_ID = "G-ZW8V1C7EL0";

/** Just enough DOM for consent.js: element tree, data-* lookups, click delegation, cookies. */
function fakeBrowser(stored) {
  const listeners = [];
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.parent = null;
      this.dataset = {};
      this.attrs = {};
      this.hidden = false;
      this.textContent = "";
      this.handlers = {};
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    }
    addEventListener(type, fn) {
      this.handlers[type] = fn;
    }
    focus() {}
    closest(selector) {
      const key = selector.match(/^\[data-([a-z-]+)\]$/)[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      for (let el = this; el; el = el.parent) if (el.dataset && key in el.dataset) return el;
      return null;
    }
    all() {
      return this.children.flatMap((c) => (c instanceof El ? [c].concat(c.all()) : []));
    }
    querySelector(selector) {
      const m = selector.match(/^input\[data-consent="(\w+)"\]$/);
      return this.all().find((el) => el.tagName === "INPUT" && el.dataset.consent === m[1]) || null;
    }
  }
  const store = new Map(stored ? [["patygo_consent_v1", JSON.stringify(stored)]] : []);
  const jar = new Map([["_ga", "GA1.1.1"], ["_ga_ZW8V1C7EL0", "GS1"], ["_gcl_au", "1.1"], ["sepet", "x"]]);
  const document = {
    readyState: "complete",
    head: new El("head"),
    body: new El("body"),
    createElement: (tag) => new El(tag),
    createTextNode: (text) => ({ text }),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.push(fn),
    get cookie() {
      return [...jar].map(([k, v]) => k + "=" + v).join("; ");
    },
    set cookie(value) {
      const [pair] = value.split(";");
      const name = pair.split("=")[0].trim();
      if (/expires=Thu, 01 Jan 1970/.test(value)) jar.delete(name);
      else jar.set(name, pair.split("=")[1]);
    },
  };
  const window = {
    document,
    location: { hostname: "patygoteknoloji.com", pathname: "/" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  };
  window.window = window;
  vm.runInNewContext(consentJs, window);
  const banner = () => document.body.children.find((el) => el.className === "consent-banner") || null;
  return {
    window,
    store,
    jar,
    banner,
    gaScripts: () => document.head.children.filter((el) => el.tagName === "SCRIPT"),
    // dataLayer objects come from the vm realm; JSON makes them comparable with deepEqual.
    calls: () => JSON.parse(JSON.stringify((window.dataLayer || []).map((args) => Array.from(args)))),
    click(action) {
      const actions = banner().all().find((el) => el.className === "consent-actions");
      const target = actions.all().find((el) => el.dataset.consentAction === action);
      assert.ok(target, action + " düğmesi");
      actions.handlers.click({ target });
    },
    labels: () => banner().all().filter((el) => el.tagName === "BUTTON").map((el) => el.textContent),
    box: (key) => banner().querySelector('input[data-consent="' + key + '"]'),
    check(key, on) {
      banner().querySelector('input[data-consent="' + key + '"]').checked = on;
    },
  };
}

const DENIED = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
const GRANTED = { analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" };

test("no answer yet: the tag loads cookieless (all denied) and events still reach Google", () => {
  const b = fakeBrowser(null);
  assert.ok(b.banner(), "onay penceresi açılır");
  assert.deepEqual(b.labels(), ["Özelleştir", "Kabul et"]);
  const scripts = b.gaScripts();
  assert.equal(scripts.length, 1, "gelişmiş izin modu: betik herkese yüklenir");
  assert.equal(scripts[0].src, "https://www.googletagmanager.com/gtag/js?id=" + GA_ID);
  const calls = b.calls();
  assert.deepEqual(calls[0], ["consent", "default", DENIED], "onay gelmeden önce çerez yok");
  assert.ok(calls.some((c) => c[0] === "set" && c[1] === "ads_data_redaction" && c[2] === true));
  assert.ok(calls.some((c) => c[0] === "config" && c[1] === GA_ID && c[2].allow_google_signals === false));
  b.window.PatygoGa.event("view_item", { items: [] });
  assert.ok(b.calls().some((c) => c[0] === "event" && c[1] === "view_item"), "çerezsiz sinyal gider");
  assert.equal(b.jar.has("_ga"), true, "cevap yokken mevcut çerezlere dokunulmaz");
});

test("accepting grants consent on the already loaded tag and turns ad signals on", () => {
  const b = fakeBrowser(null);
  b.click("accept");
  assert.equal(b.banner(), null, "pencere kapanır");
  assert.equal(b.gaScripts().length, 1, "betik ikinci kez eklenmez");
  const calls = b.calls();
  assert.deepEqual(calls.find((c) => c[0] === "consent" && c[1] === "update"), ["consent", "update", GRANTED]);
  assert.ok(calls.some((c) => c[0] === "set" && c[1].allow_google_signals === true));
  assert.deepEqual(calls[calls.length - 1], ["set", "ads_data_redaction", false]);
  const saved = JSON.parse(b.store.get("patygo_consent_v1"));
  assert.equal(saved.analytics, true);
  assert.equal(saved.ads, true);
});

test("Özelleştir opens unticked choices with reject, save and accept-all", () => {
  const b = fakeBrowser(null);
  b.click("customize");
  assert.deepEqual(b.labels(), ["Tümünü reddet", "Seçimi kaydet", "Tümünü kabul et"]);
  assert.equal(b.box("analytics").checked, false, "önceden işaretli kutu onay sayılmaz");
  assert.equal(b.box("ads").checked, false);
  assert.equal(b.box("required").disabled, true);
  assert.equal(b.calls().some((c) => c[1] === "update"), false, "Özelleştir tek başına onay değildir");
});

test("rejecting keeps consent denied, deletes Google cookies; events stay cookieless", () => {
  const b = fakeBrowser(null);
  b.click("customize");
  b.click("reject");
  b.window.PatygoGa.event("add_to_cart", {});
  const calls = b.calls();
  assert.deepEqual(calls.find((c) => c[0] === "consent" && c[1] === "update"), ["consent", "update", DENIED]);
  assert.equal(calls.some((c) => JSON.stringify(c).includes("granted")), false);
  assert.ok(calls.some((c) => c[0] === "event" && c[1] === "add_to_cart"));
  assert.equal(b.jar.has("_ga"), false);
  assert.equal(b.jar.has("_ga_ZW8V1C7EL0"), false);
  assert.equal(b.jar.has("_gcl_au"), false);
  assert.equal(b.jar.has("sepet"), true, "zorunlu çerezlere dokunulmaz");
});

test("statistics only: analytics granted, ad signals denied", () => {
  const b = fakeBrowser(null);
  b.click("customize");
  b.check("analytics", true);
  b.check("ads", false);
  b.click("save");
  const update = b.calls().find((c) => c[0] === "consent" && c[1] === "update");
  assert.equal(update[2].analytics_storage, "granted");
  assert.equal(update[2].ad_storage, "denied");
  assert.equal(update[2].ad_personalization, "denied");
  assert.ok(b.calls().some((c) => c[0] === "set" && c[1].allow_google_signals === false));
  assert.equal(b.jar.has("_gcl_au"), false, "reklam çerezi silinir");
  assert.equal(b.jar.has("_ga"), true, "istatistik çerezi kalır");
});

test("a stored answer sets the default consent without asking again; it expires after a year", () => {
  const recent = fakeBrowser({ analytics: true, ads: true, at: new Date().toISOString() });
  assert.equal(recent.banner(), null);
  assert.deepEqual(recent.calls()[0], ["consent", "default", GRANTED]);
  const refused = fakeBrowser({ analytics: false, ads: false, at: new Date().toISOString() });
  assert.equal(refused.banner(), null);
  assert.deepEqual(refused.calls()[0], ["consent", "default", DENIED]);
  assert.equal(refused.jar.has("_ga"), false, "reddedenin eski çerezleri açılışta silinir");
  const old = fakeBrowser({ analytics: true, ads: true, at: new Date(Date.now() - 400 * 864e5).toISOString() });
  assert.ok(old.banner(), "12 aydan eski onay yeniden sorulur");
  assert.deepEqual(old.calls()[0], ["consent", "default", DENIED]);
});

test("purchase is sent once per order with VAT-inclusive prices and no customer details", () => {
  const b = fakeBrowser({ analytics: true, ads: false, at: new Date().toISOString() });
  const order = {
    id: "D2A0C2",
    total: 1399,
    shippingFee: 199,
    coupon: { code: "HOSGELDIN", discount: 0 },
    customer: { email: "musteri@example.com" },
    items: [{ productId: "sup-1", name: "Logitech M240", brand: "Logitech", qty: 2, line: 500, lineVat: 100 }],
  };
  b.window.PatygoGa.purchase(order);
  b.window.PatygoGa.purchase(order);
  const purchases = b.calls().filter((c) => c[0] === "event" && c[1] === "purchase");
  assert.equal(purchases.length, 1, "sayfa yenilense de bir kez");
  const params = purchases[0][2];
  assert.equal(params.transaction_id, "D2A0C2");
  assert.equal(params.currency, "TRY");
  assert.equal(params.value, 1399);
  assert.equal(params.shipping, 199);
  assert.equal(params.items[0].price, 300);
  assert.equal(params.items[0].quantity, 2);
  assert.doesNotMatch(JSON.stringify(params), /musteri@example\.com/);
});

test("catalog items carry the VAT-inclusive price the shopper sees", () => {
  const b = fakeBrowser(null);
  const row = b.window.PatygoGa.item({ id: "p1", name: "Toner", brand: "HP", price: 1000, vatPercent: 20, category: "kartus-toner" }, 3);
  assert.equal(row.price, 1200);
  assert.equal(row.quantity, 3);
  assert.equal(row.item_category, "kartus-toner");
  assert.equal(b.window.PatygoGa.itemsValue([row]), 3600);
});

test("every storefront page loads consent.js before the other scripts; the admin panel never loads it", () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html"));
  let storefront = 0;
  for (const file of pages) {
    const html = read(file);
    if (!html.includes("/assets/js/main.js")) {
      assert.doesNotMatch(html, /consent\.js|googletagmanager/, file);
      continue;
    }
    storefront += 1;
    const consentAt = html.indexOf('<script defer src="/assets/js/consent.js?v=');
    assert.ok(consentAt > 0, file + " consent.js yükler");
    const firstOther = html.search(/<script (defer )?src="\/assets\/js\/(?!consent\.js)/);
    assert.ok(consentAt < firstOther, file + ": consent.js ilk betik");
    assert.doesNotMatch(html, /googletagmanager\.com\/gtag/, file + ": Google betiği onaysız sayfaya gömülmez");
  }
  assert.ok(storefront >= 18);
  assert.doesNotMatch(read("admin.html"), /consent\.js|googletagmanager/);
  // The server injects the catalog bootstrap before this exact tag.
  assert.match(read("urunler.html"), /<script defer src="\/assets\/js\/cart\.js"><\/script>/);
});

test("funnel events reach GA: product view, search, add to cart, checkout, purchase", () => {
  assert.match(read("assets/js/urun-detay.js"), /PatygoGa\.event\("view_item"/);
  assert.match(read("assets/js/urun-detay.js"), /gaViewedId !== product\.id/, "ürün başına tek görüntüleme");
  assert.match(read("assets/js/main.js"), /PatygoGa\.event\("search", \{ search_term: searchTerm \}\)/);
  assert.match(read("assets/js/main.js"), /!\/@\|\\d\{7,\}\/\.test/, "e-posta/telefon arama terimi gönderilmez");
  assert.match(read("assets/js/cart.js"), /PatygoGa\.event\("add_to_cart"/);
  assert.match(read("assets/js/checkout.js"), /!booted && window\.PatygoGa[\s\S]{0,200}"begin_checkout"/);
  assert.match(read("assets/js/checkout.js"), /if \(paid && window\.PatygoGa\) window\.PatygoGa\.purchase\(order\)/);
});

test("CSP lets the Google tag load and report, everywhere the storefront CSP is set", () => {
  const sources = {
    "server.js": read("server.js"),
    "deploy/nginx-patygoteknoloji.com.conf": read("deploy/nginx-patygoteknoloji.com.conf"),
    "scripts/ensure-product-shell-nginx.sh": read("scripts/ensure-product-shell-nginx.sh"),
  };
  for (const [file, text] of Object.entries(sources)) {
    assert.doesNotMatch(text, /script-src 'self';/, file + ": eski CSP kalmadı");
    assert.match(text, /script-src 'self' https:\/\/\*\.googletagmanager\.com;/, file);
    assert.match(text, /connect-src 'self' https:\/\/\*\.google-analytics\.com https:\/\/\*\.analytics\.google\.com/, file);
  }
});

test("legal pages disclose Google Analytics, consent and transfer abroad", () => {
  const cerez = read("cerez.html");
  assert.match(cerez, /Google Analytics/);
  assert.match(cerez, /_ga_ZW8V1C7EL0/);
  assert.match(cerez, /yurt dışına aktarılması/);
  assert.match(cerez, /data-consent-open/, "çerez sayfasından tercih değiştirilebilir");
  assert.match(cerez, /Onay vermezseniz çerez kullanılmaz; Google’a yalnızca çerezsiz/);
  assert.doesNotMatch(cerez, /Google Analytics yüklenmez|veri gönderimi durur/, "eski onaysız-yüklenmez iddiası kalmadı");
  const kvkk = read("kvkk.html");
  assert.match(kvkk, /Google Ireland Limited \/ Google LLC/);
  assert.match(kvkk, /Onay vermezseniz Google Analytics çerez kullanmadan çalışır/);
  assert.doesNotMatch(kvkk, /Google Analytics yüklenmez/);
  assert.match(read("gizlilik.html"), /Google Analytics/);
});
