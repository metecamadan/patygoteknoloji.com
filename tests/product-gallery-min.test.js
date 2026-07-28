const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const products = JSON.parse(
  fs.readFileSync(path.join(root, "assets", "data", "products.json"), "utf8")
);
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "assets", "js", "admin.js"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const checkoutJs = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Test sunucusu erken kapandı.");
    try {
      const response = await fetch(baseUrl + "/api/products");
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Test sunucusu zamanında başlamadı.");
}

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
  assert.match(adminJs, /MIN_PRODUCT_IMAGES\s*=\s*5/);
  assert.match(adminJs, /en az " \+ MIN_PRODUCT_IMAGES \+ " görsel/);
  assert.match(serverJs, /MIN_PRODUCT_IMAGES\s*=\s*5/);
  assert.match(serverJs, /images\.length < MIN_PRODUCT_IMAGES/);
  assert.match(checkoutJs, /has-image/);
  assert.match(checkoutJs, /product\.images/);
});
test("PUT /api/admin/products rejects products with fewer than 5 images", async (t) => {
  const port = await getFreePort();
  const password = "test-min-images";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      ADMIN_PASSWORD: password,
      SITE_BASE_URL: `http://127.0.0.1:${port}`,
    }),
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

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
          category: "bilgisayar",
          images: ["/assets/img/products/macbook-air-m3.svg"],
        },
      ],
    }),
  });
  assert.equal(tooFew.status, 422);
  const tooFewBody = await tooFew.json();
  assert.match(String(tooFewBody.error || ""), /en az 5/i);

  // Confirm catalog was not replaced by the rejected payload
  const listed = await fetch(baseUrl + "/api/products");
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.ok(
    (catalog.products || []).every((p) => p.id !== "short-gallery"),
    "rejected product must not be saved"
  );
});
