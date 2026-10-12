const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const yk = require("../lib/yurtici-kargo");
const { PATTERNS, encodeCode128B, code128Svg } = require("../lib/code128");
const { buildCargoLabelHtml } = require("../lib/cargo-label");
const { createCargoShipments, PROVIDER } = require("../lib/cargo-shipments");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");
const { buildOrderMail } = require("../lib/order-mail");

const ENV = { YURTICI_WS_USER: "YKTEST", YURTICI_WS_PASSWORD: "YK", YURTICI_MODE: "test" };

function order(overrides) {
  return Object.assign(
    {
      id: "PTY-261012-A1B2C3",
      status: "paid",
      paymentStatus: "paid",
      paymentTaken: true,
      total: 500,
      items: [{ productId: "p1", name: "Klavye", qty: 1, line: 400, lineVat: 80 }],
      customer: {
        name: "Ayşe Yılmaz",
        email: "ayse@example.com",
        phone: "0555 111 22 33",
        shippingAddress: "Mevlana Mah. 911. Sk. No: 19, Gaziosmanpaşa / İstanbul",
        shippingCity: "İstanbul",
        shippingDistrict: "Gaziosmanpaşa",
      },
      createdAt: new Date().toISOString(),
    },
    overrides || {}
  );
}

function soap(inner) {
  return (
    '<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>' +
    inner +
    "</S:Body></S:Envelope>"
  );
}

function fakeFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: String(init.body) });
    const text = responder(String(init.body), calls.length);
    return { ok: true, status: 200, text: async () => text };
  };
  impl.calls = calls;
  return impl;
}

const CREATE_OK = soap(
  '<ns2:createShipmentResponse xmlns:ns2="http://yurticikargo.com.tr/ShippingOrderDispatcherServices"><ShippingOrderResultVO>' +
    "<outFlag>0</outFlag><outResult>Başarılı</outResult><jobId>98765</jobId>" +
    "<shippingOrderDetailVO><cargoKey>PTY-261012-A1B2C3</cargoKey><errCode>0</errCode></shippingOrderDetailVO>" +
    "</ShippingOrderResultVO></ns2:createShipmentResponse>"
);

function queryResponse(details) {
  return soap(
    '<ns2:queryShipmentResponse xmlns:ns2="http://yurticikargo.com.tr/ShippingOrderDispatcherServices"><ShippingDeliveryVO>' +
      "<outFlag>0</outFlag><outResult>OK</outResult>" +
      details.join("") +
      "</ShippingDeliveryVO></ns2:queryShipmentResponse>"
  );
}

function detailXml(fields, item) {
  const tags = (obj) =>
    Object.keys(obj)
      .map((k) => "<" + k + ">" + obj[k] + "</" + k + ">")
      .join("");
  return (
    "<shippingDeliveryDetailVO>" +
    tags(fields) +
    (item ? "<shippingDeliveryItemDetailVO>" + tags(item) + "</shippingDeliveryItemDetailVO>" : "") +
    "</shippingDeliveryDetailVO>"
  );
}

test("yurtici config: test endpoint unless YURTICI_MODE=live; unconfigured without credentials", () => {
  assert.equal(yk.yurticiConfig({}).configured, false);
  assert.equal(yk.yurticiConfig(ENV).endpoint, yk.ENDPOINTS.test);
  assert.equal(yk.yurticiConfig(Object.assign({}, ENV, { YURTICI_MODE: "live" })).endpoint, yk.ENDPOINTS.live);
  assert.match(yk.ENDPOINTS.live, /^https:\/\/ws\.yurticikargo\.com\//);
});

test("cargo key is the order id, suffixed per retry, never over Yurtiçi's 20 chars", () => {
  assert.equal(yk.cargoKeyFor("PTY-261012-A1B2C3", 1), "PTY-261012-A1B2C3");
  assert.equal(yk.cargoKeyFor("PTY-261012-A1B2C3", 2), "PTY-261012-A1B2C3-2");
  assert.throws(() => yk.cargoKeyFor("PTY-261012-A1B2C3", 100), /20 karakter/);
});

test("phone becomes 10 digits without 0 / +90", () => {
  assert.equal(yk.normalizePhone("0555 111 22 33"), "5551112233");
  assert.equal(yk.normalizePhone("+90 (555) 111-22-33"), "5551112233");
  assert.equal(yk.normalizePhone("5551112233"), "5551112233");
  assert.throws(() => yk.normalizePhone("0555"), /10 haneli/);
});

test("shipping order VO: street without district/city, mandatory long fields as 0, WSDL order", () => {
  const vo = yk.buildShippingOrderVO(order(), { cargoKey: "PTY-261012-A1B2C3", desi: 2 });
  assert.equal(vo.receiverAddress, "Mevlana Mah. 911. Sk. No: 19");
  assert.equal(vo.cityName, "İstanbul");
  assert.equal(vo.townName, "Gaziosmanpaşa");
  assert.equal(vo.receiverPhone1, "5551112233");
  assert.equal(vo.invoiceKey, vo.cargoKey);
  assert.equal(vo.desi, 2);
  assert.equal(vo.kg, null, "unknown kg is omitted, never sent empty");
  for (const key of ["taxOfficeId", "ttDocumentId", "dcSelectedCredit", "dcCreditRule"]) assert.equal(vo[key], 0, key);
  const keys = Object.keys(vo);
  assert.ok(keys.indexOf("cargoKey") < keys.indexOf("receiverCustName"));
  assert.ok(keys.indexOf("emailAddress") < keys.indexOf("desi"));
  assert.ok(keys.indexOf("dcCreditRule") < keys.indexOf("description"));
  assert.throws(
    () => yk.buildShippingOrderVO(order({ customer: Object.assign({}, order().customer, { shippingCity: "" }) }), { cargoKey: "K" }),
    /il\/ilçe/
  );
});

test("createShipment posts a SOAP envelope to the test endpoint and returns the cargo key", async () => {
  const fetchImpl = fakeFetch(() => CREATE_OK);
  const res = await yk.createShipment(order(), { env: ENV, fetchImpl, cargoKey: "PTY-261012-A1B2C3", desi: 1 });
  assert.deepEqual(res, { cargoKey: "PTY-261012-A1B2C3", jobId: "98765", alreadyExisted: false, mode: "test" });
  const call = fetchImpl.calls[0];
  assert.equal(call.url, yk.ENDPOINTS.test);
  assert.match(call.body, /<ship:createShipment><wsUserName>YKTEST<\/wsUserName><wsPassword>YK<\/wsPassword><userLanguage>TR<\/userLanguage><ShippingOrderVO><cargoKey>PTY-261012-A1B2C3<\/cargoKey>/);
  assert.match(call.body, /<taxOfficeId>0<\/taxOfficeId>/);
  assert.doesNotMatch(call.body, /<kg>/);
});

test("createShipment: existing key counts as created, rejection and SOAP fault throw with Yurtiçi's text", async () => {
  const exists = soap(
    "<createShipmentResponse><ShippingOrderResultVO><outFlag>1</outFlag><outResult>Hata</outResult>" +
      "<shippingOrderDetailVO><errCode>60020</errCode><errMessage>Kargo anahtarı mevcut</errMessage></shippingOrderDetailVO>" +
      "</ShippingOrderResultVO></createShipmentResponse>"
  );
  const again = await yk.createShipment(order(), { env: ENV, fetchImpl: fakeFetch(() => exists), cargoKey: "PTY-261012-A1B2C3" });
  assert.equal(again.alreadyExisted, true);

  const rejected = soap(
    "<createShipmentResponse><ShippingOrderResultVO><outFlag>1</outFlag><outResult>Hata</outResult>" +
      "<shippingOrderDetailVO><errCode>82516</errCode><errMessage>Telefon geçersiz &amp; eksik</errMessage></shippingOrderDetailVO>" +
      "</ShippingOrderResultVO></createShipmentResponse>"
  );
  await assert.rejects(
    yk.createShipment(order(), { env: ENV, fetchImpl: fakeFetch(() => rejected), cargoKey: "K1" }),
    /Telefon geçersiz & eksik/
  );
  const fault = soap("<S:Fault><faultcode>S:Server</faultcode><faultstring>Yetkisiz IP</faultstring></S:Fault>");
  await assert.rejects(yk.createShipment(order(), { env: ENV, fetchImpl: fakeFetch(() => fault), cargoKey: "K1" }), /Yetkisiz IP/);
  const wsFault = soap(
    "<S:Fault><faultcode>S:Server</faultcode><faultstring>YurticikargoWSException</faultstring><detail>" +
      '<ns1:YurticikargoWSException xmlns:ns1="http://yurticikargo.com.tr/WSExceptions/"><errorCode>1</errorCode>' +
      "<errText>Kullanıcı yetkisiz</errText></ns1:YurticikargoWSException></detail></S:Fault>"
  );
  await assert.rejects(yk.createShipment(order(), { env: ENV, fetchImpl: fakeFetch(() => wsFault), cargoKey: "K1" }), /Kullanıcı yetkisiz/);
  await assert.rejects(yk.createShipment(order(), { env: {}, cargoKey: "K1" }), /tanımlı değil/);
});

test("queryShipments maps operation/return flags to store states and keeps only http(s) tracking links", async () => {
  const xml = queryResponse([
    detailXml({ cargoKey: "A", operationCode: "0", operationMessage: "Kargo İşlem Görmemiş" }),
    detailXml({ cargoKey: "B", operationCode: "1" }, { docId: "330011", trackingUrl: "https://selfservis.yurticikargo.com/x?d=1" }),
    detailXml({ cargoKey: "C", operationCode: "5" }, { docId: "330012", documentDelFlag: "1" }),
    detailXml({ cargoKey: "D", errCode: "82519", errMessage: "Bulunamadı" }),
    detailXml({ cargoKey: "E", operationCode: "1" }, { docId: "330013", returnStatus: "3" }),
    detailXml({ cargoKey: "F", operationCode: "3" }),
    detailXml({ cargoKey: "G", operationCode: "1" }, { docId: "330014", trackingUrl: "javascript:alert(1)" }),
  ]);
  const fetchImpl = fakeFetch(() => xml);
  const rows = await yk.queryShipments(["A", "B", "C", "D", "E", "F", "G"], { env: ENV, fetchImpl });
  const state = Object.fromEntries(rows.map((r) => [r.cargoKey, r.state]));
  assert.deepEqual(state, { A: "created", B: "in_transit", C: "delivered", D: "created", E: "returned", F: "cancelled", G: "in_transit" });
  assert.equal(rows[1].docId, "330011");
  assert.equal(rows[1].trackingUrl, "https://selfservis.yurticikargo.com/x?d=1");
  assert.equal(rows[6].trackingUrl, "");
  assert.match(fetchImpl.calls[0].body, /<wsLanguage>TR<\/wsLanguage><keys>A<\/keys><keys>B<\/keys>/);
  assert.match(fetchImpl.calls[0].body, /<keyType>0<\/keyType>/);
});

test("pingYurtici: 'key not found' proves credentials and IP; anything else is reported", async () => {
  const notFound = queryResponse([detailXml({ cargoKey: "PATYGO-PING", errCode: "82519", errMessage: "Kayıt bulunamadı" })]);
  const ok = await yk.pingYurtici({ env: ENV, fetchImpl: fakeFetch(() => notFound) });
  assert.deepEqual(ok, { ok: true, mode: "test", outFlag: "0", message: "Kayıt bulunamadı" });
  const denied = soap("<queryShipmentResponse><ShippingDeliveryVO><outFlag>1</outFlag><outResult>Kullanıcı adı veya şifre hatalı</outResult></ShippingDeliveryVO></queryShipmentResponse>");
  const bad = await yk.pingYurtici({ env: ENV, fetchImpl: fakeFetch(() => denied) });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /şifre hatalı/);
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "vps_set_yurtici.py"), "utf8");
  assert.match(script, /getpass\.getpass\("Yurtiçi şifre: "\)/);
  assert.match(script, /pm2 restart patygo --update-env/);
  assert.doesNotMatch(script, /print\(values|print\(.*PASSWORD/);
});

test("cancelShipment succeeds on CNL/ISC/already-cancelled and refuses a parcel already moving", async () => {
  const reply = (code) =>
    soap(
      "<cancelShipmentResponse><ShippingOrderResultVO><outFlag>0</outFlag><outResult>OK</outResult>" +
        "<shippingCancelDetailVO><cargoKey>K</cargoKey><operationCode>" +
        code +
        "</operationCode><operationMessage>m" +
        code +
        "</operationMessage></shippingCancelDetailVO></ShippingOrderResultVO></cancelShipmentResponse>"
    );
  const fetchImpl = fakeFetch(() => reply("3"));
  assert.equal((await yk.cancelShipment("K", { env: ENV, fetchImpl })).cancelled, true);
  assert.match(fetchImpl.calls[0].body, /<ship:cancelShipment><wsUserName>YKTEST<\/wsUserName><wsPassword>YK<\/wsPassword><userLanguage>TR<\/userLanguage><cargoKeys>K<\/cargoKeys><\/ship:cancelShipment>/);
  assert.equal((await yk.cancelShipment("K", { env: ENV, fetchImpl: fakeFetch(() => reply("4")) })).cancelled, true);
  const moving = await yk.cancelShipment("K", { env: ENV, fetchImpl: fakeFetch(() => reply("1")) });
  assert.equal(moving.cancelled, false);
  assert.equal(moving.message, "m1");
});

test("code128: standard table shape, start B / mod-103 check / stop", () => {
  assert.equal(PATTERNS.length, 107);
  PATTERNS.slice(0, 106).forEach((p, i) => {
    assert.equal(p.length, 6, "pattern " + i);
    assert.equal([...p].reduce((s, d) => s + Number(d), 0), 11, "pattern " + i);
  });
  assert.equal(PATTERNS[106], "2331112");
  assert.equal(new Set(PATTERNS).size, 107);
  const codes = encodeCode128B("PJJ123C");
  assert.equal(codes[0], 104);
  assert.equal(codes[codes.length - 1], 106);
  assert.equal(codes[codes.length - 2], 55);
  assert.throws(() => encodeCode128B("Ş"), /ASCII/);
  const svg = code128Svg("PTY-261012-A1B2C3", { width: "110mm" });
  const modules = 11 * ("PTY-261012-A1B2C3".length + 3) + 2 + 20;
  assert.match(svg, new RegExp('viewBox="0 0 ' + modules + " 60\""));
  assert.match(svg, /width="110mm"/);
});

test("A5 label: barcode of the cargo key, escaped customer text, test-mode tag", () => {
  const html = buildCargoLabelHtml(
    order({ customer: Object.assign({}, order().customer, { name: "<script>x</script> Ayşe" }) }),
    { cargoKey: "PTY-261012-A1B2C3", desi: 1, mode: "test", carrier: "Yurtiçi Kargo" }
  );
  assert.match(html, /@page\{size:A5 portrait/);
  assert.match(html, /aria-label="PTY-261012-A1B2C3"/);
  assert.match(html, /TEST ORTAMI/);
  assert.match(html, /Gaziosmanpaşa \/ İstanbul/);
  assert.match(html, /0555 111 22 33/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /<script src='\/assets\/js\/cargo-label\.js\?v=cargo-\d+'><\/script>/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets", "js", "cargo-label.js")));
});

test("shipped mail carries the Yurtiçi tracking link only for http(s) URLs", () => {
  const mail = buildOrderMail(order(), "shipped", {
    shippingCarrier: "Yurtiçi Kargo",
    trackingCode: "330011",
    trackingUrl: "https://selfservis.yurticikargo.com/x?d=1",
  });
  assert.match(mail.html, /Kargomu takip et/);
  assert.match(mail.text, /Kargo takibi: https:\/\/selfservis\.yurticikargo\.com/);
  const unsafe = buildOrderMail(order(), "shipped", { trackingCode: "1", trackingUrl: "javascript:alert(1)" });
  assert.doesNotMatch(unsafe.html, /Kargomu takip et/);
});

function storeWith(t, seed) {
  resetDbForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cargo-"));
  t.after(() => {
    resetDbForTests();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });
  const store = createOrderStore(dir);
  store.save(seed);
  return store;
}

test("cargo flow: create → branch scan marks shipped + mail → delivery marks delivered + review mail", async (t) => {
  const store = storeWith(t, order());
  const mails = [];
  const events = [];
  let clock = Date.parse("2026-10-12T19:00:00Z");
  let query = queryResponse([detailXml({ cargoKey: "PTY-261012-A1B2C3", errCode: "82519" })]);
  const fetchImpl = fakeFetch((body) => (/createShipment/.test(body) ? CREATE_OK : query));
  const cargo = createCargoShipments({
    orderStore: store,
    env: () => ENV,
    fetchImpl,
    now: () => clock,
    sendStatusMail: async (o, key, extra) => {
      mails.push({ key, extra, status: o.status });
      return { sent: true };
    },
    reviewUrlFor: () => "https://patygoteknoloji.com/degerlendir?x",
    onEvent: (e) => events.push(e.action),
  });

  await assert.rejects(cargo.create("PTY-261012-A1B2C3", { desi: "0" }), /Desi/);
  const created = await cargo.create("PTY-261012-A1B2C3", { desi: "2,5", actorId: "u1" });
  assert.equal(created.cargoKey, "PTY-261012-A1B2C3");
  assert.equal(created.desi, 2.5);
  assert.equal(created.state, "created");
  assert.equal(store.getIntegration("PTY-261012-A1B2C3", PROVIDER).guid, "PTY-261012-A1B2C3");
  await assert.rejects(cargo.create("PTY-261012-A1B2C3", {}), /zaten açık/);

  await cargo.sync();
  assert.equal(store.get("PTY-261012-A1B2C3").status, "paid", "not yet at a branch");
  assert.equal(mails.length, 0);

  query = queryResponse([
    detailXml({ cargoKey: "PTY-261012-A1B2C3", operationCode: "1" }, { docId: "330011", trackingUrl: "https://selfservis.yurticikargo.com/t" }),
  ]);
  clock += 31 * 60 * 1000;
  await cargo.sync();
  let o = store.get("PTY-261012-A1B2C3");
  assert.equal(o.status, "shipped");
  assert.equal(o.shippingCarrier, "Yurtiçi Kargo");
  assert.equal(o.trackingCode, "330011");
  assert.deepEqual(mails[0], {
    key: "shipped",
    extra: { shippingCarrier: "Yurtiçi Kargo", trackingCode: "330011", trackingUrl: "https://selfservis.yurticikargo.com/t" },
    status: "shipped",
  });
  await cargo.sync();
  assert.equal(mails.length, 1, "shipped mail is sent once");

  query = queryResponse([detailXml({ cargoKey: "PTY-261012-A1B2C3", operationCode: "5" }, { docId: "330011", documentDelFlag: "1" })]);
  await cargo.sync();
  o = store.get("PTY-261012-A1B2C3");
  assert.equal(o.status, "delivered");
  assert.equal(mails[1].key, "delivered");
  assert.equal(mails[1].extra.reviewUrl, "https://patygoteknoloji.com/degerlendir?x");
  const after = fetchImpl.calls.length;
  await cargo.sync();
  assert.equal(fetchImpl.calls.length, after, "delivered shipments are no longer polled");
  assert.deepEqual(events, ["order.cargo_created", "order.cargo_picked_up", "order.cargo_delivered"]);
});

test("cargo flow: cancel before pickup, retry gets a new key; unpaid and other-mode shipments are refused/skipped", async (t) => {
  const store = storeWith(t, order());
  const cancelOk = soap(
    "<cancelShipmentResponse><ShippingOrderResultVO><outFlag>0</outFlag><outResult>OK</outResult>" +
      "<shippingCancelDetailVO><operationCode>3</operationCode></shippingCancelDetailVO></ShippingOrderResultVO></cancelShipmentResponse>"
  );
  const fetchImpl = fakeFetch((body) => (/ship:cancelShipment/.test(body) ? cancelOk : CREATE_OK));
  let env = ENV;
  const cargo = createCargoShipments({ orderStore: store, env: () => env, fetchImpl });

  await cargo.create("PTY-261012-A1B2C3", {});
  const cancelled = await cargo.cancel("PTY-261012-A1B2C3");
  assert.equal(cancelled.state, "cancelled");
  const retry = await cargo.create("PTY-261012-A1B2C3", {});
  assert.equal(retry.cargoKey, "PTY-261012-A1B2C3-2");
  assert.deepEqual(retry.previousKeys, ["PTY-261012-A1B2C3"]);
  assert.match(fetchImpl.calls[fetchImpl.calls.length - 1].body, /<cargoKey>PTY-261012-A1B2C3-2<\/cargoKey>/);

  env = Object.assign({}, ENV, { YURTICI_MODE: "live" });
  const before = fetchImpl.calls.length;
  assert.deepEqual(await cargo.sync(), { checked: 0 });
  assert.equal(fetchImpl.calls.length, before, "test-mode keys are not queried on the live service");

  const unpaidStore = storeWith(t, order({ id: "PTY-261012-BBBBBB", status: "payment_pending", paymentStatus: "pending", paymentTaken: false }));
  const unpaid = createCargoShipments({ orderStore: unpaidStore, env: () => ENV, fetchImpl });
  await assert.rejects(unpaid.create("PTY-261012-BBBBBB", {}), /ödemesi alınmış/);

  const off = createCargoShipments({ orderStore: unpaidStore, env: () => ({}), fetchImpl });
  await assert.rejects(off.create("PTY-261012-BBBBBB", {}), (err) => err.status === 503);
  assert.deepEqual(await off.sync(), { checked: 0, skipped: "not_configured" });
});

test("failed create releases the claim so the panel can retry", async (t) => {
  const store = storeWith(t, order());
  const rejected = soap(
    "<createShipmentResponse><ShippingOrderResultVO><outFlag>1</outFlag><outResult>Hata</outResult>" +
      "<shippingOrderDetailVO><errCode>82515</errCode><errMessage>E-posta geçersiz</errMessage></shippingOrderDetailVO>" +
      "</ShippingOrderResultVO></createShipmentResponse>"
  );
  const cargo = createCargoShipments({ orderStore: store, env: () => ENV, fetchImpl: fakeFetch(() => rejected) });
  await assert.rejects(cargo.create("PTY-261012-A1B2C3", {}), /E-posta geçersiz/);
  assert.equal(store.getIntegration("PTY-261012-A1B2C3", PROVIDER), null);
});
