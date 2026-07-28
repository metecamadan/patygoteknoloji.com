const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const imgDir = path.join(root, "assets", "img");
const styleCss = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("logo assets use brand colors and transparent light SVG", () => {
  const light = fs.readFileSync(path.join(imgDir, "patygo-logo.svg"), "utf8");
  const dark = fs.readFileSync(path.join(imgDir, "patygo-logo-on-dark.svg"), "utf8");
  const fav = fs.readFileSync(path.join(imgDir, "favicon.svg"), "utf8");

  assert.match(light, /#2563eb/);
  assert.match(light, /#64748b/);
  assert.match(light, /color-interpolation="sRGB"/);
  assert.doesNotMatch(light, /<rect[^>]*width="132\.9"[^>]*fill="#fff"/i);
  assert.match(light, /mask id="mark"/);

  assert.match(dark, /#ffffff/);
  assert.match(dark, /#94a3b8/);
  assert.match(fav, /#2563eb/);
});

test("header and footer use matching SVG logos without CSS invert", () => {
  assert.match(indexHtml, /class="brand"[\s\S]*patygo-logo\.svg/);
  assert.match(indexHtml, /footer-brand[\s\S]*patygo-logo-on-dark\.svg/);
  assert.doesNotMatch(styleCss, /footer-brand img[\s\S]{0,200}filter:\s*brightness\(0\)\s*invert\(1\)/);
  assert.doesNotMatch(styleCss, /content:\s*url\("\.\.\/img\/patygo-logo\.svg"\)/);
});

test("PNG logo fallback is transparent sRGB brand blue", () => {
  const data = fs.readFileSync(path.join(imgDir, "patygo-logo.png"));
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

  let offset = 8;
  const chunks = new Map();
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const payload = data.subarray(offset + 8, offset + 8 + length);
    chunks.set(type, Buffer.concat([chunks.get(type) || Buffer.alloc(0), payload]));
    offset += 12 + length;
    if (type === "IEND") break;
  }

  assert.equal(chunks.has("gAMA"), false, "gAMA causes OS/browser gamma mismatches");
  assert.equal(chunks.has("iCCP"), false);

  const ihdr = chunks.get("IHDR");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const raw = zlib.inflateSync(chunks.get("IDAT"));
  const stride = width * 4;
  const rows = [];
  let idx = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[idx];
    idx += 1;
    const row = Buffer.from(raw.subarray(idx, idx + stride));
    idx += stride;
    if (filter === 1) {
      for (let x = 0; x < stride; x += 1) {
        row[x] = (row[x] + (x >= 4 ? row[x - 4] : 0)) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x += 1) row[x] = (row[x] + prev[x]) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? row[x - 4] : 0;
        row[x] = (row[x] + ((left + prev[x]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc) return a;
        if (pb <= pc) return b;
        return c;
      };
      for (let x = 0; x < stride; x += 1) {
        const a = x >= 4 ? row[x - 4] : 0;
        const b = prev[x];
        const c = x >= 4 ? prev[x - 4] : 0;
        row[x] = (row[x] + paeth(a, b, c)) & 255;
      }
    } else if (filter !== 0) {
      assert.fail("unsupported PNG filter " + filter);
    }
    rows.push(row);
    prev = row;
  }

  assert.equal(rows[0][3], 0, "corner must be transparent");
  let brandHits = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const o = x * 4;
      const r = rows[y][o];
      const g = rows[y][o + 1];
      const b = rows[y][o + 2];
      const a = rows[y][o + 3];
      if (a > 240 && r === 37 && g === 99 && b === 235) brandHits += 1;
      assert.notEqual(r === 255 && g === 255 && b === 255 && a === 255, true);
    }
  }
  assert.ok(brandHits > 100, "expected brand #2563eb pixels");
});
