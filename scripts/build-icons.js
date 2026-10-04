#!/usr/bin/env node
// Regenerates favicon.ico, apple-touch-icon, manifest icons and the default og image
// from assets/img/favicon.svg + patygo-logo.png. Run after a logo change: node scripts/build-icons.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const img = (name) => path.join(root, "assets", "img", name);
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function squareIcon(size, padding) {
  const inner = Math.round(size * (1 - padding * 2));
  const mark = await sharp(img("favicon.svg"), { density: 1200 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
}

function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function main() {
  fs.writeFileSync(img("apple-touch-icon.png"), await squareIcon(180, 0.14));
  fs.writeFileSync(img("icon-192.png"), await squareIcon(192, 0.14));
  fs.writeFileSync(img("icon-512.png"), await squareIcon(512, 0.14));
  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, data: await squareIcon(size, 0.06) });
  fs.writeFileSync(path.join(root, "favicon.ico"), icoFromPngs(ico));

  const logo = await sharp(img("patygo-logo.png")).resize({ width: 640, kernel: "lanczos3" }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: WHITE } })
    .composite([{ input: logo, gravity: "centre" }])
    .flatten({ background: WHITE })
    .png()
    .toFile(img("og-default.png"));
  console.log("icons written");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
