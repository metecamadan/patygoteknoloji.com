const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mirrorPaths } = require("../lib/product-image-mirror");
const { loadSharp, thumbUrlFor, generateMissingThumbnails, THUMB_SIZE } = require("../lib/product-thumbnails");
const { toPublicProduct } = require("../lib/catalog");

const root = path.resolve(__dirname, "..");
const sharp = loadSharp();
const KEY = "a".repeat(28);

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patygo-thumb-"));
}

test("sharp is installed so card previews can be generated", () => {
  assert.ok(sharp, "sharp optional dependency should install on CI and the VPS");
});

test("generateMissingThumbnails writes a 400px webp once and skips existing previews", { skip: !sharp }, async () => {
  const dataRoot = tempRoot();
  const { mediaDir } = mirrorPaths(dataRoot);
  fs.mkdirSync(mediaDir, { recursive: true });
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#3366cc" } })
    .jpeg()
    .toFile(path.join(mediaDir, KEY + ".jpg"));
  const index = {
    "https://cdn.example/a.jpg": { file: KEY + ".jpg", publicPath: "/media/catalog/" + KEY + ".jpg" },
    "https://cdn.example/missing.jpg": { file: "b".repeat(28) + ".jpg" },
    "https://cdn.example/placeholder.jpg": { file: "c".repeat(28) + ".jpg", placeholder: true },
  };

  const first = await generateMissingThumbnails(dataRoot, index);
  assert.deepEqual(first, { created: 1, failed: 0, unavailable: false });
  const thumbPath = path.join(mediaDir, "thumb", KEY + ".webp");
  const meta = await sharp(thumbPath).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, THUMB_SIZE);
  assert.equal(meta.height, 300);

  const second = await generateMissingThumbnails(dataRoot, index);
  assert.equal(second.created, 0);
});

test("thumbUrlFor maps mirrored images to existing previews only", () => {
  const dataRoot = tempRoot();
  const thumbDir = path.join(mirrorPaths(dataRoot).mediaDir, "thumb");
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.writeFileSync(path.join(thumbDir, KEY + ".webp"), "x");
  assert.equal(
    thumbUrlFor("https://patygoteknoloji.com/media/catalog/" + KEY + ".jpg", dataRoot),
    "https://patygoteknoloji.com/media/catalog/thumb/" + KEY + ".webp"
  );
  assert.equal(thumbUrlFor("https://patygoteknoloji.com/media/catalog/" + "d".repeat(28) + ".jpg", dataRoot), "");
  assert.equal(thumbUrlFor("/assets/img/products/macbook-air-m3.svg", dataRoot), "");
  assert.equal(thumbUrlFor("https://patygoteknoloji.com/media/catalog/" + KEY + ".jpg", ""), "");
});

test("compact public products carry the preview, full products keep only full-size images", () => {
  const dataRoot = tempRoot();
  const thumbDir = path.join(mirrorPaths(dataRoot).mediaDir, "thumb");
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.writeFileSync(path.join(thumbDir, KEY + ".webp"), "x");
  const product = {
    id: "p1",
    name: "Test Ürün",
    brand: "HP",
    price: 100,
    image: "https://patygoteknoloji.com/media/catalog/" + KEY + ".jpg",
    images: ["https://patygoteknoloji.com/media/catalog/" + KEY + ".jpg"],
  };
  const compact = toPublicProduct(product, { compact: true, dataRoot });
  assert.equal(compact.thumb, "https://patygoteknoloji.com/media/catalog/thumb/" + KEY + ".webp");
  assert.equal(compact.image, product.image);
  assert.equal(toPublicProduct(product, { dataRoot }).thumb, undefined);
});

test("storefront cards, search suggestions, cart and checkout prefer the preview image", () => {
  const read = (file) => fs.readFileSync(path.join(root, "assets", "js", file), "utf8");
  assert.match(read("catalog.js"), /\[product\.thumb\]/);
  assert.match(read("main.js"), /product\.thumb \|\| product\.image/);
  assert.match(read("sepet.js"), /product\.thumb \|\|/);
  assert.match(read("checkout.js"), /first\.thumb \|\|/);
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /scheduleThumbnailBackfill\(240000\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.optionalDependencies.sharp);
});
