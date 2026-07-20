const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { hmacSha512Base64 } = require("../lib/akbank-pos");

const root = path.resolve(__dirname, "..");

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
      const response = await fetch(baseUrl + "/api/payment/status");
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Test sunucusu zamanında başlamadı.");
}

test("payment APIs start hosted form and verify callback", async (t) => {
  const port = await getFreePort();
  const secret = "test-akbank-secret";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      ADMIN_PASSWORD: "test-admin-password",
      SITE_BASE_URL: `http://127.0.0.1:${port}`,
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: secret,
      AKBANK_TEST_MODE: "true",
      SUPPLIER_ALLOWED_HOSTS: "supplier.example",
    }),
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

  const status = await fetch(baseUrl + "/api/payment/status");
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.enabled, true);
  assert.equal(statusBody.testMode, true);

  const productsRes = await fetch(baseUrl + "/api/products");
  const productsBody = await productsRes.json();
  const product = (productsBody.products || []).find((row) => row.active !== false);
  assert.ok(product, "Test için en az bir ürün gerekli");

  const start = await fetch(baseUrl + "/api/payment/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1 }],
      customer: {
        name: "Test Musteri",
        email: "test@example.com",
        phone: "05555555555",
      },
      contractsAccepted: true,
    }),
  });
  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.equal(startBody.ok, true);
  assert.match(startBody.orderId, /^PTY-/);
  assert.equal(startBody.action, "https://virtualpospaymentgatewaypre.akbank.com/payhosting");
  assert.equal(startBody.fields.paymentModel, "3D_PAY_HOSTING");
  assert.ok(startBody.fields.hash);

  const callbackPayload = {
    orderId: startBody.orderId,
    responseCode: "VPS-0000",
    responseMessage: "Success",
    amount: startBody.fields.amount,
    hashParams: "orderId+responseCode+amount",
  };
  callbackPayload.hash = hmacSha512Base64(
    callbackPayload.orderId + callbackPayload.responseCode + callbackPayload.amount,
    secret
  );

  const callback = await fetch(baseUrl + "/api/payment/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(callbackPayload).toString(),
    redirect: "manual",
  });
  assert.ok(callback.status === 303 || callback.status === 302);
  const location = callback.headers.get("location") || "";
  assert.match(location, /payment=success/);
  assert.match(location, new RegExp(startBody.orderId));

  const order = await fetch(baseUrl + "/api/payment/order?orderId=" + encodeURIComponent(startBody.orderId));
  assert.equal(order.status, 200);
  const orderBody = await order.json();
  assert.equal(orderBody.order.paymentTaken, true);
  assert.equal(orderBody.order.paymentStatus, "paid");
  assert.equal(orderBody.order.bankResponse.responseCode, "VPS-0000");
  assert.equal(orderBody.order.bankResponse.hashOk, true);
});
