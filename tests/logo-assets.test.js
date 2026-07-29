const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const logoPng = path.join(root, "assets", "img", "patygo-logo.png");
const logoFooter = path.join(root, "assets", "img", "patygo-logo-footer.png");

function pngHasAlpha(filePath) {
  const buf = fs.readFileSync(filePath);
  const ihdr = buf.indexOf(Buffer.from("IHDR"));
  assert.notEqual(ihdr, -1, filePath + " missing IHDR");
  // IHDR data: width(4) height(4) bitDepth(1) colorType(1) ...
  const colorType = buf[ihdr + 13];
  return colorType === 4 || colorType === 6;
}

test("site and admin use the original PNG logo asset", () => {
  assert.ok(fs.existsSync(logoPng));
  assert.match(indexHtml, /class="brand"[\s\S]*patygo-logo\.png/);
  assert.match(adminHtml, /src="\/assets\/img\/patygo-logo\.png"/);
  assert.ok(pngHasAlpha(logoPng), "header logo should be RGBA with transparent background");
});

test("footer uses white transparent PNG derived from same logo", () => {
  assert.ok(fs.existsSync(logoFooter));
  assert.ok(pngHasAlpha(logoFooter), "footer logo should be RGBA with transparent background");
  assert.match(indexHtml, /footer-brand[\s\S]*src="\/assets\/img\/patygo-logo\.png"/);
  assert.match(
    styleCss,
    /footer-brand img[\s\S]{0,160}content:\s*url\("\.\.\/img\/patygo-logo-footer\.png"\)/
  );
  assert.doesNotMatch(styleCss, /footer-brand img[\s\S]{0,220}filter:\s*brightness\(0\)\s*invert\(1\)/);
});
