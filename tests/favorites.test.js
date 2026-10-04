const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function loadFavorites() {
  const storage = new Map();
  const events = [];
  const document = {
    readyState: "complete",
    querySelectorAll: () => [],
    dispatchEvent: (ev) => events.push(ev.type),
    addEventListener() {},
  };
  const window = { addEventListener() {}, alert() {}, setTimeout };
  vm.runInNewContext(read("assets/js/favorites.js"), {
    window,
    document,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    CustomEvent: function CustomEvent(type) {
      this.type = type;
    },
  });
  return { api: window.PatygoFavorites, storage, events };
}

// vm results come from another realm; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("favorites toggle, persist in localStorage and notify the page", () => {
  const { api, storage, events } = loadFavorites();
  assert.deepEqual(plain(api.favorites.toggle("p1")), { added: true, full: false });
  api.favorites.toggle("p2");
  assert.deepEqual(plain(api.favorites.ids()), ["p2", "p1"]);
  assert.equal(api.favorites.has("p1"), true);
  assert.deepEqual(plain(api.favorites.toggle("p1")), { added: false, full: false });
  assert.equal(api.favorites.count(), 1);
  assert.equal(storage.get("patygo_favorites_v1"), JSON.stringify(["p2"]));
  assert.ok(events.includes("patygo:favorites"));
});

test("compare list is capped at 4 products", () => {
  const { api } = loadFavorites();
  ["a", "b", "c", "d"].forEach((id) => api.compare.toggle(id));
  assert.deepEqual(plain(api.compare.toggle("e")), { added: false, full: true });
  assert.equal(api.compare.count(), 4);
  api.compare.remove("b");
  assert.deepEqual(plain(api.compare.ids()), ["d", "c", "a"]);
});

test("every storefront page with a cart link has the favorites link and script", () => {
  const pages = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
  for (const page of pages) {
    const html = read(page);
    if (!html.includes('class="btn btn-outline cart-link"')) continue;
    assert.match(html, /<a href="\/favoriler" class="fav-link" aria-label="Favorilerim">/, page);
    assert.match(html, /<span data-fav-count hidden>0<\/span>/, page);
    assert.match(html, /src="\/assets\/js\/favorites\.js\?v=/, page);
    const favIdx = html.indexOf("/assets/js/favorites.js");
    const catalogIdx = html.indexOf("/assets/js/catalog.js");
    if (catalogIdx >= 0) assert.ok(favIdx < catalogIdx, page + ": favorites.js must load before catalog.js");
  }
});

test("favorites page is noindex and renders favorites + comparison", () => {
  const html = read("favoriler.html");
  assert.match(html, /<meta name="robots" content="noindex,follow" \/>/);
  assert.match(html, /id="favGrid"/);
  assert.match(html, /id="karsilastir"/);
  assert.match(html, /id="compareTable"/);
  const order = ["favorites.js", "catalog.js", "detail-specs.js", "favoriler.js"].map((name) =>
    html.indexOf("/assets/js/" + name)
  );
  assert.ok(order.every((idx, i) => idx > 0 && (i === 0 || idx > order[i - 1])), "script order");
  const js = read("assets/js/favoriler.js");
  assert.match(js, /\/api\/products\?ids=/);
  assert.match(js, /artık satışta olmadığı için listeden çıkarıldı/);
  assert.match(js, /parseProductDetailSpecTable/);
});

test("product cards and detail page expose favorite and compare buttons", () => {
  const catalog = read("assets/js/catalog.js");
  assert.match(
    catalog,
    /article\.appendChild\(body\);\s*if \(window\.PatygoFavorites && product\.id\) \{\s*article\.appendChild\(window\.PatygoFavorites\.createFavButton\(product\.id\)\);/
  );
  const detail = read("assets/js/urun-detay.js");
  assert.match(detail, /createCompareButton\(product\.id/);
  assert.match(detail, /\/favoriler#karsilastir/);
  assert.match(read("assets/css/style.css"), /\.fav-toggle\[aria-pressed="true"\] svg \{ fill: currentColor; \}/);
});
