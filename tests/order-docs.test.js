const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validateOrderDocInput,
  createOrderDocStore,
  createDocLinkSigner,
  DOC_LINK_TTL_MS,
  MAX_ORDER_DOC_BYTES,
} = require("../lib/order-docs");
const { createOrderStore } = require("../lib/orders");
const { spawnTestServer } = require("./helpers/spawn-server");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
const pdfInput = (extra) => Object.assign({ kind: "return", filename: "iade.pdf", dataBase64: PDF.toString("base64") }, extra);

test("order document input: kind, extension and real bytes must match", () => {
  assert.equal(validateOrderDocInput(pdfInput()).ok, true);
  assert.equal(validateOrderDocInput(pdfInput({ kind: "other" })).ok, false);
  assert.match(validateOrderDocInput(pdfInput({ filename: "iade.docx" })).error, /PDF, PNG veya JPG/);
  assert.match(validateOrderDocInput(pdfInput({ filename: "iade.png" })).error, /uzantısıyla uyuşmuyor/);
  assert.match(
    validateOrderDocInput(pdfInput({ dataBase64: Buffer.from("<html>").toString("base64") })).error,
    /uzantısıyla uyuşmuyor/
  );
  const big = Buffer.concat([PDF, Buffer.alloc(MAX_ORDER_DOC_BYTES)]);
  assert.match(validateOrderDocInput(pdfInput({ dataBase64: big.toString("base64") })).error, /10 MB/);
  assert.equal(validateOrderDocInput(pdfInput({ filename: "../../etc/fatura.pdf" })).filename, "fatura.pdf");
});

test("order document store keeps files per order and refuses path tricks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-docs-"));
  try {
    const store = createOrderDocStore(root);
    const input = validateOrderDocInput(pdfInput());
    const saved = store.add("PTY-1", input, { by: "u1" });
    assert.equal(saved.ok, true);
    assert.match(saved.doc.id, /^[a-f0-9]{16}$/);
    assert.equal(saved.doc.kind, "return");
    assert.deepEqual(store.list("PTY-1").map((d) => d.id), [saved.doc.id]);
    assert.deepEqual(store.read("PTY-1", saved.doc.id).content, PDF);
    assert.equal(store.list("PTY-2").length, 0);
    assert.equal(store.read("PTY-2", saved.doc.id), null, "başka siparişin belgesi okunmaz");
    assert.equal(store.add("../PTY-1", input).ok, false);
    assert.equal(store.read("PTY-1", "../index.json"), null);
    assert.deepEqual(fs.readdirSync(path.join(root, ".runtime", "order-docs", "PTY-1")).sort(), [saved.doc.id + ".pdf", "index.json"].sort());
    assert.equal(store.remove("PTY-1", saved.doc.id).id, saved.doc.id);
    assert.equal(store.list("PTY-1").length, 0);
    assert.equal(store.read("PTY-1", saved.doc.id), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("signed document links expire and are bound to one order and document", () => {
  const signer = createDocLinkSigner(Buffer.alloc(32, 7));
  const now = Date.parse("2026-10-07T18:00:00Z");
  const url = signer.link("PTY-1", "0123456789abcdef", now);
  const [, exp, sig] = /\?exp=(\d+)&sig=([a-f0-9]{64})$/.exec(url);
  assert.equal(signer.verify("PTY-1", "0123456789abcdef", exp, sig, now), true);
  assert.equal(signer.verify("PTY-1", "0123456789abcdef", exp, sig, now + DOC_LINK_TTL_MS + 1000), false, "30 dk sonra geçersiz");
  assert.equal(signer.verify("PTY-2", "0123456789abcdef", exp, sig, now), false);
  assert.equal(signer.verify("PTY-1", "0123456789abcdef", String(Number(exp) + 600), sig, now), false, "süre uzatılamaz");
  assert.equal(signer.verify("PTY-1", "0123456789abcdef", exp, "zz", now), false);
  assert.equal(createDocLinkSigner(Buffer.alloc(32, 8)).verify("PTY-1", "0123456789abcdef", exp, sig, now), false, "yeniden başlatınca eski bağlantılar düşer");
});

test("admin uploads, opens and deletes order documents; return upload closes the invoice warning", async (t) => {
  const { baseUrl } = await spawnTestServer(
    t,
    { ADMIN_PASSWORD: "test-admin-password" },
    {
      seed: (dataRoot) => {
        const store = createOrderStore(dataRoot);
        store.save({
          id: "PTY-DOC-1",
          total: 13.68,
          currency: "TRY",
          status: "refunded",
          paymentStatus: "refunded",
          paymentTaken: true,
          createdAt: "2026-10-06T10:00:00.000Z",
          customer: { name: "Belge Müşteri", email: "belge@example.com", phone: "0555" },
          items: [{ productId: "p1", name: "Ürün", qty: 1, line: 13.68, lineVat: 0 }],
          paymentEvents: [],
        });
        store.claimIntegration("PTY-DOC-1", "bizimhesap_invoice");
        store.saveIntegrationRef("PTY-DOC-1", "bizimhesap_invoice", {
          guid: "BH-DOC",
          url: "",
          invoiceNo: "EFT2026000000051",
          returns: [{ eventAt: "2026-10-07T14:10:01.432Z", type: "refund", amount: 13.68, fully: true }],
        });
      },
    }
  );
  const docsUrl = baseUrl + "/api/admin/orders/PTY-DOC-1/documents";
  assert.equal((await fetch(docsUrl, { method: "POST", body: "{}" })).status, 401, "oturumsuz yükleme yok");

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-admin-password" }),
  });
  const headers = { Authorization: "Bearer " + (await login.json()).token, "Content-Type": "application/json" };
  const upload = (body) => fetch(docsUrl, { method: "POST", headers, body: JSON.stringify(body) });

  const bad = await upload(pdfInput({ filename: "iade.png" }));
  assert.equal(bad.status, 400);

  const invoiceRes = await upload(pdfInput({ kind: "invoice", filename: "EFT2026000000051.pdf" }));
  assert.equal(invoiceRes.status, 200);
  const invoice = await invoiceRes.json();
  assert.equal(invoice.followupResolved, false, "fatura yüklemek iade uyarısını kapatmaz");

  const returned = await (await upload(pdfInput())).json();
  assert.equal(returned.followupResolved, true);
  assert.ok(returned.integration.payload.resolvedAt);
  assert.equal(returned.documents.length, 2);
  const again = await (await upload(pdfInput({ filename: "iade-2.pdf" }))).json();
  assert.equal(again.followupResolved, false, "açık iade yokken uyarı yeniden kapatılmaz");

  const detail = await (await fetch(baseUrl + "/api/admin/orders/PTY-DOC-1", { headers })).json();
  assert.deepEqual(detail.documents.map((d) => d.kind), ["invoice", "return", "return"]);

  assert.equal((await fetch(docsUrl + "/" + invoice.document.id)).status, 401, "oturumsuz belge açılmaz");
  const opened = await fetch(docsUrl + "/" + invoice.document.id, { headers });
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get("content-type"), "application/pdf");
  assert.match(opened.headers.get("content-disposition"), /^inline; filename\*=UTF-8''EFT2026000000051\.pdf$/);
  assert.equal(opened.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await opened.arrayBuffer()), PDF);
  assert.equal((await fetch(baseUrl + "/api/admin/orders/PTY-NOPE/documents/" + invoice.document.id, { headers })).status, 404);

  const viewUrl = detail.documents[0].viewUrl;
  assert.match(viewUrl, new RegExp("^/api/order-documents/PTY-DOC-1/" + invoice.document.id + "\\?exp=\\d+&sig=[a-f0-9]{64}$"));
  const signed = await fetch(baseUrl + viewUrl);
  assert.equal(signed.status, 200, "imzalı bağlantı oturum başlığı olmadan yeni sekmede açılır");
  assert.equal(signed.headers.get("content-type"), "application/pdf");
  assert.equal(signed.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await signed.arrayBuffer()), PDF);
  const tampered = viewUrl.replace(/sig=([a-f0-9])/, (m, c) => "sig=" + (c === "0" ? "1" : "0"));
  assert.equal((await fetch(baseUrl + tampered)).status, 403, "imzası bozulan bağlantı açılmaz");
  const otherDoc = viewUrl.replace(invoice.document.id, returned.document.id);
  assert.equal((await fetch(baseUrl + otherDoc)).status, 403, "imza başka belgeye taşınamaz");
  const expired = viewUrl.replace(/exp=\d+/, "exp=1000");
  assert.equal((await fetch(baseUrl + expired)).status, 403, "süresi dolan bağlantı açılmaz");

  const del = await fetch(docsUrl + "/" + again.document.id, { method: "DELETE", headers });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).documents.length, 2);
  assert.equal((await fetch(docsUrl + "/" + again.document.id, { headers })).status, 404);
});
