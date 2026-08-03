const test = require("node:test");
const assert = require("node:assert/strict");
const { hmacSha512Base64 } = require("../lib/akbank-pos");
const { spawnTestServer } = require("./helpers/spawn-server");

test("payment APIs start hosted form and verify callback", async (t) => {
  const secret = "test-akbank-secret";
  const { baseUrl } = await spawnTestServer(t, {
    ADMIN_PASSWORD: "test-admin-password",
    AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
    AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
    AKBANK_SECRET_KEY: secret,
    AKBANK_TEST_MODE: "true",
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });

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
        billingAddress: "Mevlana Mah. Test Sk. No:1 Gaziosmanpaşa / İstanbul",
        shippingAddress: "Mevlana Mah. Test Sk. No:1 Gaziosmanpaşa / İstanbul",
      },
      contractsAccepted: true,
      kvkkAccepted: true,
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

  const form = new URLSearchParams(callbackPayload);
  const callback = await fetch(baseUrl + "/api/payment/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });
  assert.equal(callback.status, 303);
  assert.match(callback.headers.get("location") || "", /payment=success/);

  const order = await fetch(baseUrl + "/api/payment/order?orderId=" + startBody.orderId);
  assert.equal(order.status, 200);
  const orderBody = await order.json();
  assert.equal(orderBody.ok, true);
  assert.equal(orderBody.order.paymentStatus, "paid");
  assert.equal(orderBody.order.paymentTaken, true);
  assert.equal(orderBody.order.status, "paid");
});
