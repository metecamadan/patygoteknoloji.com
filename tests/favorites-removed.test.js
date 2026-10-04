const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

// Üyelik yok: tarayıcıya bağlı favori/karşılaştırma listesi müşteriye geri dönmez, vitrinde yer almaz.
test("favorites and compare feature is fully removed from the storefront", () => {
  for (const file of ["favoriler.html", "assets/js/favorites.js", "assets/js/favoriler.js"]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  const pages = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /\/favoriler|favorites\.js|data-fav-count|fav-link/, page);
  }
  for (const file of ["assets/js/catalog.js", "assets/js/urun-detay.js"]) {
    assert.doesNotMatch(read(file), /PatygoFavorites|createFavButton|createCompareButton|\/favoriler/, file);
  }
  assert.doesNotMatch(read("assets/css/style.css"), /\.fav-(link|toggle|grid|title|empty|note|section)|\.compare-(table|toggle|section|product|remove)|\.detail-shortlist|\.detail-compare-link/);
});
