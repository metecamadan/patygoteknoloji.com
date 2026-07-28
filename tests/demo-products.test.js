const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { XMLParser } = require("fast-xml-parser");

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
      Array.isArray(product.images) && product.images.length >= 5,
      product.id + " needs at least 5 images"
    );
    assert.ok(
      fs.existsSync(path.join(root, product.image.replace(/^\//, ""))),
      product.image + " file missing"
    );
    product.images.forEach((url) => {
      assert.ok(fs.existsSync(path.join(root, url.replace(/^\//, ""))), url + " missing");
    });
    assert.ok(String(product.description || "").length >= 40, product.id + " short description");
    assert.ok(String(product.details || "").length >= 80, product.id + " short details");
  });
});

test("product SVG demos are valid UTF-8 XML for <img> decode", () => {
  const parser = new XMLParser({ ignoreAttributes: false });
  products.forEach((product) => {
    product.images.forEach((url) => {
      const file = path.join(root, url.replace(/^\//, ""));
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.includes(0xf6), false, url + " has Latin-1 bytes");
      const text = bytes.toString("utf8");
      assert.match(text, /encoding=["']UTF-8["']/i);
      assert.doesNotThrow(() => parser.parse(text), url + " invalid XML");
    });
  });
});
