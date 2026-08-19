const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeCatalogProducts, productHasStorefrontImage, toPublicProduct } = require("../lib/catalog");
const { TEST_SITE_CATEGORIES } = require("./helpers/site-categories");

const IMG = "https://cdn.example/product.jpg";
const SITE = "https://patygoteknoloji.com";

function supplierBase(overrides) {
  return Object.assign(
    {
      id: "sup-1",
      supplierSku: "SUP-1",
      name: "Görsel Test",
      brand: "DEVELOP",
      salePrice: 100,
      stockQty: 5,
      category: "kartus-toner",
      image: IMG,
      images: [IMG],
      active: true,
      siteParent: "oem-cevre-birimleri",
      siteChild: "notebook",
      lastSuccessfulFetchAt: new Date().toISOString(),
    },
    overrides || {}
  );
}

test("mergeCatalogProducts drops products without any image URL", () => {
  const result = mergeCatalogProducts(
    [
      {
        id: "manual-no-img",
        name: "Görselsiz",
        brand: "PATYGO",
        price: 50,
        category: "kartus-toner",
        active: true,
      },
    ],
    [supplierBase({ id: "sup-no-img", image: "", images: [] })],
    { categories: TEST_SITE_CATEGORIES }
  );
  assert.equal(result.length, 0);
});

test("supplier products require mirrored image when mirror index is populated", () => {
  const mirrorIndex = {
    [IMG]: { publicPath: "/media/catalog/abc.jpg", file: "abc.jpg" },
  };
  const withMirror = mergeCatalogProducts([], [supplierBase()], {
    categories: TEST_SITE_CATEGORIES,
    mirrorIndex,
    siteBaseUrl: SITE,
  });
  assert.equal(withMirror.length, 1);
  assert.equal(withMirror[0].source, "supplier");

  const withoutMirror = mergeCatalogProducts([], [supplierBase({ id: "sup-2" })], {
    categories: TEST_SITE_CATEGORIES,
    mirrorIndex: { [IMG + "/missing"]: { publicPath: "/media/catalog/other.jpg", file: "other.jpg" } },
    siteBaseUrl: SITE,
  });
  assert.equal(withoutMirror.length, 0);
});

test("toPublicProduct serves mirrored catalog media URLs", () => {
  const mirrorIndex = {
    [IMG]: { publicPath: "/media/catalog/abc.jpg", file: "abc.jpg" },
  };
  const pub = toPublicProduct(
    Object.assign({ source: "supplier", price: 100, category: "kartus-toner" }, supplierBase()),
    { mirrorIndex, siteBaseUrl: SITE }
  );
  assert.equal(pub.image, SITE + "/media/catalog/abc.jpg");
  assert.deepEqual(pub.images, [SITE + "/media/catalog/abc.jpg"]);
});

test("productHasStorefrontImage accepts manual products with HTTPS image", () => {
  assert.equal(
    productHasStorefrontImage(
      {
        id: "manual-1",
        source: "manual",
        image: "https://patygoteknoloji.com/media/manual.jpg",
        images: ["https://patygoteknoloji.com/media/manual.jpg"],
      },
      { mirrorIndex: {}, siteBaseUrl: SITE }
    ),
    true
  );
});
