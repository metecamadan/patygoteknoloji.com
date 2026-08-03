const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.resolve(__dirname, "..");
const products = JSON.parse(
  fs.readFileSync(path.join(root, "assets", "data", "products.json"), "utf8")
);
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "assets", "js", "admin.js"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const checkoutJs = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");

test("demo products each have at least 5 gallery images on disk", () => {
  products.forEach((product) => {
    assert.ok(Array.isArray(product.images), product.id + " missing images[]");
    assert.ok(product.images.length >= 5, product.id + " needs >=5 images");
    product.images.forEach((url) => {
      assert.match(url, /^\/assets\/img\/products\//);
      assert.ok(fs.existsSync(path.join(root, url.replace(/^\//, ""))), url + " missing");
    });
  });
});

test("admin and server enforce minimum 5 product images", () => {
  assert.match(adminHtml, /en az 5, en fazla 10/);
  assert.match(adminHtml, /id="imageCountHint"/);
  assert.match(adminHtml, /id="saveProductBtn"/);
  assert.match(adminHtml, /Manuel ürün eklerken/);
  assert.match(adminHtml, /id="pBarcode"/);
  assert.match(adminHtml, /id="pManufacturerCode"/);
  assert.match(adminHtml, /id="pMainCategory"/);
  assert.match(adminHtml, /id="pStock"/);
  assert.match(adminJs, /MIN_PRODUCT_IMAGES\s*=\s*5/);
  assert.match(adminJs, /assertManualProductsHaveGallery/);
  assert.match(adminJs, /syncSaveButtonState/);
  assert.match(adminJs, /CATEGORY_FEED_DEFAULTS/);
  assert.match(adminJs, /panelden manuel/);
  assert.match(serverJs, /MIN_PRODUCT_IMAGES\s*=\s*5/);
  assert.match(serverJs, /images\.length < MIN_PRODUCT_IMAGES/);
  assert.match(serverJs, /validateManualFeedFields/);
  assert.match(checkoutJs, /has-image/);
  assert.match(checkoutJs, /product\.images/);
});

test("PUT /api/admin/products rejects products with fewer than 5 images", async (t) => {
  const password = "test-min-images";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };

  const tooFew = await fetch(baseUrl + "/api/admin/products", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      products: [
        {
          id: "short-gallery",
          brand: "TEST",
          name: "Eksik Galeri",
          price: 1000,
          vatPercent: 20,
          category: "bilgisayar",
          images: ["/assets/img/products/macbook-air-m3.svg"],
        },
      ],
    }),
  });
  assert.equal(tooFew.status, 422);
  const tooFewBody = await tooFew.json();
  assert.match(String(tooFewBody.error || ""), /en az 5/i);

  const listed = await fetch(baseUrl + "/api/products");
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.ok(
    (catalog.products || []).every((p) => p.id !== "short-gallery"),
    "rejected product must not be saved"
  );
});
