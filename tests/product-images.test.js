const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterSupplierGalleryImages,
  supplierImageFullUrl,
  isSupplierThumbnailUrl,
  mirrorIndexHasEntries,
} = require("../lib/product-images");
const { toPublicProduct } = require("../lib/catalog");

test("mirrorIndexHasEntries handles empty, null and filled indexes", () => {
  assert.equal(mirrorIndexHasEntries(null), false);
  assert.equal(mirrorIndexHasEntries(undefined), false);
  assert.equal(mirrorIndexHasEntries({}), false);
  assert.equal(mirrorIndexHasEntries({ "https://x/1.jpg": { publicPath: "/m/1.jpg" } }), true);
});

test("mirrorIndexHasEntries stays fast on large mirror indexes (catalog startup)", () => {
  const index = {};
  for (let i = 0; i < 20000; i += 1) index["https://resim.example/" + i + ".jpg"] = { file: i + ".jpg" };
  const started = Date.now();
  for (let i = 0; i < 100000; i += 1) mirrorIndexHasEntries(index);
  assert.ok(Date.now() - started < 1000, "per-product checks must not enumerate all keys");
});

test("filterSupplierGalleryImages removes _th when full image exists", () => {
  const images = filterSupplierGalleryImages([
    "https://resim.example/115392.jpg",
    "https://resim.example/115392_th.jpg",
  ]);
  assert.deepEqual(images, ["https://resim.example/115392.jpg"]);
});

test("filterSupplierGalleryImages upgrades lone thumbnail to full URL", () => {
  assert.equal(
    supplierImageFullUrl("https://resim.example/91095_th.jpg"),
    "https://resim.example/91095.jpg"
  );
  assert.deepEqual(filterSupplierGalleryImages(["https://resim.example/91095_th.jpg"]), [
    "https://resim.example/91095.jpg",
  ]);
});

test("filterSupplierGalleryImages keeps unrelated small image filenames", () => {
  assert.equal(isSupplierThumbnailUrl("https://resim.example/th.jpg"), false);
  assert.deepEqual(
    filterSupplierGalleryImages([
      "https://resim.example/big.jpg",
      "https://resim.example/th.jpg",
    ]),
    ["https://resim.example/big.jpg", "https://resim.example/th.jpg"]
  );
});

test("toPublicProduct strips cached _th duplicates from API output", () => {
  const pub = toPublicProduct({
    id: "p1",
    name: "WD Disk",
    price: 100,
    images: [
      "http://resim.example/115392.jpg",
      "http://resim.example/115392_th.jpg",
    ],
  });
  assert.deepEqual(pub.images, ["https://resim.example/115392.jpg"]);
  assert.equal(pub.image, "https://resim.example/115392.jpg");
});
