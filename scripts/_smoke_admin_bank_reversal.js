/**
 * Admin akışı smoke: login → sipariş detayı → dryRun preview → confirm kapısı
 * Gerçek banka API çağrısı yok.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const password = "admin-reversal-smoke";

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

async function waitFor(baseUrl, child) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Sunucu kapandı");
    try {
      const res = await fetch(baseUrl + "/api/payment/status");
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("Sunucu başlamadı");
}

async function main() {
  const port = await getFreePort();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-admin-smoke-"));
  const productsDir = path.join(dataRoot, "assets", "data");
  fs.mkdirSync(productsDir, { recursive: true });
  fs.writeFileSync(path.join(productsDir, "products.json"), "[]", "utf8");

  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      PATYGO_DATA_ROOT: dataRoot,
      SITE_BASE_URL: baseUrl,
      ADMIN_PASSWORD: password,
      SMTP_HOST: "",
      AKBANK_BANK_REVERSAL_ENABLED: "false",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const cleanup = () => {
    child.kill();
    try {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    } catch (_) {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  await waitFor(baseUrl, child);

  const { createOrderStore } = require(path.join(root, "lib", "orders"));
  const { resetDbForTests } = require(path.join(root, "lib", "db"));
  resetDbForTests();
  const store = createOrderStore(dataRoot);
  store.save({
    id: "PTY-ADMIN-SMOKE-REV",
    total: 1299.9,
    currency: "TRY",
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    paidAt: new Date().toISOString(),
    customer: { name: "Smoke Müşteri", email: "smoke@example.com", phone: "05551234567" },
    items: [{ productId: "p1", name: "Test Ürün", qty: 1, line: 1299.9, lineVat: 0 }],
    bankResponse: { responseCode: "VPS-0000", hashOk: true, amountOk: true },
    paymentEvents: [],
    createdAt: new Date().toISOString(),
  });

  const loginRes = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (loginRes.status !== 200) throw new Error("Admin login başarısız: " + loginRes.status);
  const session = await loginRes.json();
  const headers = {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };

  const meRes = await fetch(baseUrl + "/api/admin/me", { headers });
  const me = await meRes.json();
  console.log("1. Admin login OK, token alındı");

  const detailRes = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-SMOKE-REV", { headers });
  const detail = await detailRes.json();
  if (!detail.bankReversal || !detail.bankReversal.ok) {
    throw new Error("Sipariş detayında bankReversal önizlemesi yok");
  }
  console.log(
    "2. Sipariş detayı OK — plan:",
    detail.bankReversal.plan.tryVoid ? "void" : "-",
    detail.bankReversal.plan.tryRefund ? "refund" : "-",
    "tutar:",
    detail.bankReversal.plan.amount
  );

  const previewRes = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-SMOKE-REV/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ dryRun: true, action: "auto" }),
  });
  const preview = await previewRes.json();
  if (previewRes.status !== 200 || !preview.dryRun) {
    throw new Error("Planı doğrula (dryRun) başarısız");
  }
  console.log("3. Planı doğrula (dryRun) OK — banka çağrısı yapılmadı");

  const execRes = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-SMOKE-REV/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirm: true, action: "auto" }),
  });
  const execBody = await execRes.json();
  if (execRes.status !== 503) {
    throw new Error("Kapalı API ile confirm 503 bekleniyordu, gelen: " + execRes.status);
  }
  console.log("4. Banka iadesi/iptal (confirm) doğru şekilde engellendi:", execBody.error.slice(0, 60) + "…");

  const adminJs = fs.readFileSync(path.join(root, "assets", "js", "admin-panel.js"), "utf8");
  const checks = [
    "renderBankReversalBlock",
    "adminOrderBankReversalPreview",
    "adminOrderBankReversalExec",
    "/bank-reversal",
  ];
  for (const needle of checks) {
    if (!adminJs.includes(needle)) throw new Error("admin-panel.js UI eksik: " + needle);
  }
  console.log("5. Panel JS — butonlar ve API bağlantısı mevcut");

  console.log("\nAdmin smoke tamam (API + panel kodu). Tarayıcı tıklaması bu scriptte yok.");
  cleanup();
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err.message || err);
  process.exit(1);
});
