const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const products = JSON.parse(
  fs.readFileSync(path.join(root, "assets", "data", "products.json"), "utf8")
);

test("demo products include image files and richer descriptions", () => {
  assert.ok(Array.isArray(products) && products.length >= 6);
  products.forEach((product) => {
    assert.ok(product.image, product.id + " missing image");
    assert.match(product.image, /^\/assets\/img\/products\/.+\.svg$/);
    assert.ok(
      fs.existsSync(path.join(root, product.image.replace(/^\//, ""))),
      product.image + " file missing"
    );
    assert.ok(String(product.description || "").length >= 40, product.id + " short description");
    assert.ok(String(product.details || "").length >= 80, product.id + " short details");
  });
});
