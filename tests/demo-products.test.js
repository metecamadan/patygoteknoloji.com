const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { XMLParser } = require("fast-xml-parser");

const root = path.resolve(__dirname, "..");
const products = JSON.parse(
  fs.readFileSync(path.join(root, "assets", "data", "products.json"), "utf8")
);

test("seed catalog has no demo products; storefront uses supplier catalog", () => {
  assert.ok(Array.isArray(products));
  assert.equal(products.length, 0);
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverJs, /path\.join\(DATA_ROOT, ["']assets["'], ["']data["'], ["']products\.json["']\)/);
});

test("legacy product SVG assets stay valid UTF-8 XML for <img> decode", () => {
  const dir = path.join(root, "assets", "img", "products");
  if (!fs.existsSync(dir)) return;
  const parser = new XMLParser({ ignoreAttributes: false });
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".svg"));
  assert.ok(files.length >= 1, "product SVG assets should remain on disk");
  files.forEach((name) => {
    const file = path.join(dir, name);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.includes(0xf6), false, name + " has Latin-1 bytes");
    const text = bytes.toString("utf8");
    assert.match(text, /encoding=["']UTF-8["']/i);
    assert.doesNotThrow(() => parser.parse(text), name + " invalid XML");
  });
});
