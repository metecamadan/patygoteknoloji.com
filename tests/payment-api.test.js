const test = require("node:test");
const assert = require("node:assert/strict");
const { hmacSha512Base64 } = require("../lib/akbank-pos");
const { spawnTestServer } = require("./helpers/spawn-server");

test("payment APIs start hosted form and verify callback", async (t) => {
  const secret = "test-akbank-secret";
  const { baseUrl } = await spawnTestServer(
    t,
    {
      ADMIN_PASSWORD: "test-admin-password",
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: secret,
      AKBANK_TEST_MODE: "true",
      SUPPLIER_ALLOWED_HOSTS: "supplier.example",
    },
    {
      products: [
        {
          id: "pay-test-item",
          brand: "TEST",
          name: "Ödeme Test Ürünü",
          price: 199,
          vatPercent: 20,
          category: "oem-cevre-birimleri",
          featured: false,
          active: true,
          image: "/assets/img/products/macbook-air-m3.svg",
          images: ["/assets/img/products/macbook-air-m3.svg"],
          stockQty: 10,
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );

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
  assert.match(startBody.orderAccessToken, /^[a-f0-9]{48}$/);
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
  assert.match(await callback.text(), /Sipariş özetine git/);

  const getCallback = await fetch(
    baseUrl + "/api/payment/callback?orderId=" + encodeURIComponent(startBody.orderId),
    { redirect: "manual" }
  );
  assert.equal(getCallback.status, 303);
  assert.match(getCallback.headers.get("location") || "", /payment=success/);

  const serverJs = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /setImmediate\(\(\) => \{\s*sendOrderStatusMail/);

  const order = await fetch(
    baseUrl +
      "/api/payment/order?orderId=" +
      encodeURIComponent(startBody.orderId) +
      "&token=" +
      encodeURIComponent(startBody.orderAccessToken)
  );
  assert.equal(order.status, 200);
  const orderBody = await order.json();
  assert.equal(orderBody.ok, true);
  assert.equal(orderBody.order.paymentStatus, "paid");
  assert.equal(orderBody.order.paymentTaken, true);
  assert.equal(orderBody.order.status, "paid");
  assert.ok(!orderBody.order.customer, "genel sipariş bakışında müşteri PII olmamalı");
});

test("unsigned callback and amount mismatch cannot mark order paid or failed", async (t) => {
  const secret = "test-akbank-secret";
  const { baseUrl } = await spawnTestServer(
    t,
    {
      ADMIN_PASSWORD: "test-admin-password",
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: secret,
      AKBANK_TEST_MODE: "true",
      SUPPLIER_ALLOWED_HOSTS: "supplier.example",
    },
    {
      products: [
        {
          id: "pay-sec-item",
          brand: "TEST",
          name: "Ödeme Güvenlik Ürünü",
          price: 80,
          vatPercent: 20,
          category: "oem-cevre-birimleri",
          featured: false,
          active: true,
          image: "/assets/img/products/macbook-air-m3.svg",
          images: ["/assets/img/products/macbook-air-m3.svg"],
          stockQty: 10,
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );

  const productsRes = await fetch(baseUrl + "/api/products");
  const productsBody = await productsRes.json();
  const product = (productsBody.products || []).find((row) => row.active !== false);

  async function startOrder() {
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
    const body = await start.json();
    assert.equal(body.ok, true);
    return body;
  }

  const unsigned = await startOrder();
  const unsignedGet = await fetch(
    baseUrl + "/api/payment/callback?orderId=" + encodeURIComponent(unsigned.orderId),
    { redirect: "manual" }
  );
  assert.equal(unsignedGet.status, 303);
  const pending = await (
    await fetch(
      baseUrl +
        "/api/payment/order?orderId=" +
        encodeURIComponent(unsigned.orderId) +
        "&token=" +
        encodeURIComponent(unsigned.orderAccessToken)
    )
  ).json();
  assert.equal(pending.order.paymentStatus, "pending");
  assert.equal(pending.order.paymentTaken, false);
  const denied = await fetch(
    baseUrl + "/api/payment/order?orderId=" + encodeURIComponent(unsigned.orderId)
  );
  assert.equal(denied.status, 403);

  const mismatch = await startOrder();
  const badPayload = {
    orderId: mismatch.orderId,
    responseCode: "VPS-0000",
    responseMessage: "Success",
    amount: "1.00",
    hashParams: "orderId+responseCode+amount",
  };
  badPayload.hash = hmacSha512Base64(
    badPayload.orderId + badPayload.responseCode + badPayload.amount,
    secret
  );
  const badCb = await fetch(baseUrl + "/api/payment/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(badPayload).toString(),
    redirect: "manual",
  });
  assert.equal(badCb.status, 303);
  assert.match(badCb.headers.get("location") || "", /payment=failed/);
  const afterMismatch = await (
    await fetch(
      baseUrl +
        "/api/payment/order?orderId=" +
        encodeURIComponent(mismatch.orderId) +
        "&token=" +
        encodeURIComponent(mismatch.orderAccessToken)
    )
  ).json();
  assert.equal(afterMismatch.order.paymentTaken, false);
  assert.notEqual(afterMismatch.order.paymentStatus, "paid");
});
