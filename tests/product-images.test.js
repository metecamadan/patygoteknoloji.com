const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterSupplierGalleryImages,
  supplierImageFullUrl,
  isSupplierThumbnailUrl,
} = require("../lib/product-images");
const { toPublicProduct } = require("../lib/catalog");

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
