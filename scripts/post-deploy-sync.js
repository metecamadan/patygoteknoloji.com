#!/usr/bin/env node
/**
 * Deploy sırasında npm ci sonrası çalışır; sunucu .env içindeki eski admin şifresini günceller.
 * Workflow dosyası değiştirmeden ADMIN_PASSWORD senkronu sağlar.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const legacy = "patygo-admin";
const target = "1234";

if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== legacy) {
  process.exit(0);
}

if (!fs.existsSync(envPath)) {
  process.exit(0);
}

const content = fs.readFileSync(envPath, "utf8");
if (!new RegExp(`^ADMIN_PASSWORD=${legacy}\\s*$`, "m").test(content)) {
  process.exit(0);
}

fs.writeFileSync(
  envPath,
  content.replace(new RegExp(`^ADMIN_PASSWORD=${legacy}\\s*$`, "m"), `ADMIN_PASSWORD=${target}`),
  "utf8"
);
console.log(`postinstall: ADMIN_PASSWORD ${legacy} -> ${target}`);
