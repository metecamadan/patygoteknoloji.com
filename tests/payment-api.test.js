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
  assert.match(serverJs, /sendOrderStatusMail\(updated, "paid"[\s\S]{0,300}transferOrderToBizimHesap\(updated\.id, "payment"\)/);

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
  assert.ok(orderBody.order.bankResponse);
  assert.equal(orderBody.order.bankResponse.responseCode, "VPS-0000");
  assert.equal(orderBody.order.bankResponse.hashOk, true);
  assert.ok(orderBody.order.paymentEventCount >= 1);
  assert.equal(typeof orderBody.order.mailEnabled, "boolean");
  assert.ok("deliveryArea" in orderBody.order);
  assert.equal(orderBody.order.customer, undefined, "başarı ekranına müşteri kişisel verisi dönmez");

  // Başarılı ödeme sonrası başarısız banka cevabı paid'i bozamaz
  const failAfterPay = {
    orderId: startBody.orderId,
    responseCode: "VPS-0001",
    responseMessage: "Declined",
    amount: startBody.fields.amount,
    authCode: "AUTH99",
    hostRefNum: "HOSTREF99",
    hashParams: "orderId+responseCode+amount",
  };
  failAfterPay.hash = hmacSha512Base64(
    failAfterPay.orderId + failAfterPay.responseCode + failAfterPay.amount,
    secret
  );
  const failCb = await fetch(baseUrl + "/api/payment/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(failAfterPay).toString(),
    redirect: "manual",
  });
  assert.equal(failCb.status, 303);
  assert.match(failCb.headers.get("location") || "", /payment=success/);
  const stillPaid = await (
    await fetch(
      baseUrl +
        "/api/payment/order?orderId=" +
        encodeURIComponent(startBody.orderId) +
        "&token=" +
        encodeURIComponent(startBody.orderAccessToken)
    )
  ).json();
  assert.equal(stillPaid.order.paymentTaken, true);
  assert.equal(stillPaid.order.paymentStatus, "paid");
  assert.ok(stillPaid.order.paymentEventCount >= 2);
  assert.ok(!orderBody.order.customer, "genel sipariş bakışında müşteri PII olmamalı");
});

test("paid order is transferred to BizimHesap once, without mailing the customer an invoice", async (t) => {
  const http = require("node:http");
  const calls = [];
  const abstractRows = [];
  const fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") {
        calls.push({ path: req.url, method: "GET" });
        const data =
          req.url === "/customers"
            ? { customers: [{ id: "C-9", code: "test@example.com", email: "test@example.com" }] }
            : { abstract: abstractRows };
        res.end(JSON.stringify({ resultCode: 1, errorText: "", data }));
        return;
      }
      calls.push({ path: req.url, body: raw ? JSON.parse(raw) : null });
      res.end(JSON.stringify({ error: "", guid: "BH-GUID-1", url: "http://127.0.0.1/invoice.pdf" }));
    });
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  t.after(() => fake.close());

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
      BIZIMHESAP_FIRM_ID: "FIRM-TEST",
      BIZIMHESAP_API_KEY: "KEY-TEST",
      BIZIMHESAP_API_TOKEN: "TOKEN-TEST",
      BIZIMHESAP_API_BASE: "http://127.0.0.1:" + fake.address().port,
    },
    {
      products: [
        {
          id: "bh-test-item",
          brand: "TEST",
          name: "BizimHesap Test Ürünü",
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

  const start = await fetch(baseUrl + "/api/payment/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ productId: "bh-test-item", qty: 1 }],
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
  const startBody = await start.json();
  assert.equal(startBody.ok, true);
  assert.equal(calls.length, 0, "ödeme onayından önce aktarım yok");

  const payload = {
    orderId: startBody.orderId,
    responseCode: "VPS-0000",
    responseMessage: "Success",
    amount: startBody.fields.amount,
    hashParams: "orderId+responseCode+amount",
  };
  payload.hash = hmacSha512Base64(payload.orderId + payload.responseCode + payload.amount, secret);
  const post = () =>
    fetch(baseUrl + "/api/payment/callback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString(),
      redirect: "manual",
    });
  assert.equal((await post()).status, 303);
  for (let i = 0; i < 50 && !calls.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await post()).status, 303);
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(calls.length, 1, "aynı sipariş bir kez aktarılır");
  assert.equal(calls[0].path, "/addinvoice");
  assert.equal(calls[0].body.firmId, "FIRM-TEST");
  assert.equal(calls[0].body.invoiceNo, startBody.orderId);
  assert.equal(calls[0].body.invoiceType, 3);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-admin-password" }),
  });
  const headers = { Authorization: "Bearer " + (await login.json()).token, "Content-Type": "application/json" };
  const invoiceUrl = baseUrl + "/api/admin/orders/" + encodeURIComponent(startBody.orderId) + "/bizimhesap-invoice";
  const postInvoice = (body) => fetch(invoiceUrl, { method: "POST", headers, body: JSON.stringify(body) });

  abstractRows.push({ type: "Satış", trxdate: "07.10.2026", note: startBody.orderId + " nolu sipariş" });
  const draft = await (await postInvoice({ action: "sync" })).json();
  assert.equal(draft.result.reason, "not_issued");
  assert.equal(draft.integration.payload.invoiceNo, undefined);
  assert.ok(draft.integration.payload.invoiceCheckedAt);
  const listSummary = async () => {
    const list = await (await fetch(baseUrl + "/api/admin/orders", { headers })).json();
    return list.orders.find((o) => o.id === startBody.orderId).invoiceSummary;
  };
  assert.deepEqual(await listSummary(), {
    invoiceNo: null,
    checkedAt: draft.integration.payload.invoiceCheckedAt,
    cancelled: false,
  });

  abstractRows.push({ type: "Tahsilat", trxdate: "07.10.2026", note: startBody.orderId + " EFT2026000000051" });
  const issued = await (await postInvoice({ action: "sync" })).json();
  assert.equal(issued.result.found, true);
  assert.equal(issued.integration.guid, "BH-GUID-1");
  assert.equal(issued.integration.payload.invoiceNo, "EFT2026000000051");
  assert.equal(issued.integration.payload.invoiceDate, "07.10.2026");
  assert.deepEqual(
    calls.filter((c) => c.method === "GET").map((c) => c.path),
    ["/customers", "/abstract/C-9", "/customers", "/abstract/C-9"]
  );
  const detail = await (await fetch(baseUrl + "/api/admin/orders/" + encodeURIComponent(startBody.orderId), { headers })).json();
  assert.equal(detail.bizimhesap.payload.invoiceNo, "EFT2026000000051");
  assert.equal((await listSummary()).invoiceNo, "EFT2026000000051");
  const recut = await postInvoice({ force: true });
  assert.equal(recut.status, 409, "faturası kesilmiş sipariş yeniden aktarılmaz");
  assert.equal(calls.filter((c) => c.path === "/addinvoice").length, 1);

  const serverJs = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  const transferFn = serverJs.slice(serverJs.indexOf("async function transferOrderToBizimHesap"));
  const fnEnd = transferFn.search(/\r?\n\}\r?\n/);
  assert.ok(fnEnd > 0);
  assert.doesNotMatch(transferFn.slice(0, fnEnd), /sendOrderStatusMail|deliverSimpleMail/);
});

test("payment start rejects invalid customer identity", async (t) => {
  const { baseUrl } = await spawnTestServer(
    t,
    {
      ADMIN_PASSWORD: "test-admin-password",
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: "test-akbank-secret",
      AKBANK_TEST_MODE: "true",
      SUPPLIER_ALLOWED_HOSTS: "supplier.example",
    },
    {
      products: [
        {
          id: "pay-id-item",
          brand: "TEST",
          name: "Kimlik Test Ürünü",
          price: 50,
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

  async function tryStart(customer) {
    return fetch(baseUrl + "/api/payment/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: product.id, qty: 1 }],
        customer: {
          name: "Mehmet Yılmaz",
          email: "test@example.com",
          phone: "05555555555",
          billingAddress: "Mevlana Mah. Test Sk. No:1 Gaziosmanpaşa / İstanbul",
          shippingAddress: "Mevlana Mah. Test Sk. No:1 Gaziosmanpaşa / İstanbul",
          ...customer,
        },
        contractsAccepted: true,
        kvkkAccepted: true,
      }),
    });
  }

  for (const name of ["asdasdasd", "axax<zx", "Ali"]) {
    const res = await tryStart({ name });
    assert.notEqual(res.status, 200, `"${name}" reddedilmeli`);
    const body = await res.json();
    assert.equal(body.ok, false);
  }

  const badPhone = await tryStart({ phone: "0555" });
  assert.notEqual(badPhone.status, 200);
  const badPhoneBody = await badPhone.json();
  assert.equal(badPhoneBody.ok, false);

  const billing = { line: "Mevlana Mah. Test Sk. No:1", district: "Gaziosmanpaşa", city: "İstanbul", postalCode: "34245" };
  const structured = await tryStart({ billing, customerType: "bireysel" });
  assert.equal(structured.status, 200);
  assert.equal((await structured.json()).ok, true);

  const rejected = [
    { billing: Object.assign({}, billing, { city: "Gotham" }) },
    { billing: Object.assign({}, billing, { district: "" }) },
    { billing, shipping: Object.assign({}, billing, { line: "kısa" }) },
    { billing, customerType: "bireysel", taxId: "12345678901" },
    { billing, customerType: "kurumsal", company: "Örnek Ltd", taxOffice: "", taxId: "1234567890" },
    { billing, customerType: "kurumsal", company: "Örnek Ltd", taxOffice: "Kadıköy", taxId: "123" },
  ];
  for (const customer of rejected) {
    const res = await tryStart(customer);
    assert.notEqual(res.status, 200, JSON.stringify(customer) + " reddedilmeli");
    assert.equal((await res.json()).ok, false);
  }

  const corporate = await tryStart({
    billing,
    customerType: "kurumsal",
    company: "Örnek Bilişim Ltd. Şti.",
    taxOffice: "Kadıköy",
    taxId: "1234567890",
  });
  assert.equal(corporate.status, 200);
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
