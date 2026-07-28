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
      fs.existsSync(path.join(root, product.image.replace(/^\//, ""))),
      product.image + " file missing"
    );
    assert.ok(String(product.description || "").length >= 40, product.id + " short description");
    assert.ok(String(product.details || "").length >= 80, product.id + " short details");
  });
});

test("product SVG demos are valid UTF-8 XML for <img> decode", () => {
  const parser = new XMLParser({ ignoreAttributes: false });
  products.forEach((product) => {
    const file = path.join(root, product.image.replace(/^\//, ""));
    const bytes = fs.readFileSync(file);
    // Latin-1 ö (0xF6) breaks Chrome img decode when UTF-8 is assumed
    assert.equal(bytes.includes(0xf6), false, product.image + " has Latin-1 bytes");
    const text = bytes.toString("utf8");
    assert.match(text, /encoding=["']UTF-8["']/i);
    assert.doesNotThrow(() => parser.parse(text), product.image + " invalid XML");
  });
});
