const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "markalar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("markalar brand tiles show a sized logo and the brand name", () => {
  const tiles = html.match(/<article class="brand-tile">[\s\S]*?<\/article>/g) || [];
  assert.equal(tiles.length, 97);
  let realLogos = 0;
  for (const tile of tiles) {
    const img = tile.match(/<img src="\/assets\/img\/(brand-logos|brands)\/([a-z0-9-]+)\.(svg|png)"(?: srcset="([^"]+)")? alt="([^"]+)" width="(\d+)" height="(\d+)"/);
    assert.ok(img, tile);
    const [, dir, file, ext, srcset, alt, width, height] = img;
    const filePath = path.join(root, "assets", "img", dir, `${file}.${ext}`);
    assert.ok(fs.existsSync(filePath), file);
    assert.ok(tile.includes(`<strong class="brand-tile-name" aria-hidden="true">${alt}</strong>`), alt);
    if (dir === "brand-logos") {
      realLogos += 1;
      assert.ok(Number(width) <= 150 && Number(height) <= 44, file);
      if (ext === "svg") {
        const head = fs.readFileSync(filePath, "utf8").match(/<svg\b[^>]*>/)[0];
        assert.ok(head.includes(`width="${width}"`) && head.includes(`height="${height}"`), file);
      } else {
        assert.equal(srcset, `/assets/img/brand-logos/${file}.png 2x`, file);
        const png = fs.readFileSync(filePath);
        assert.equal(png.readUInt32BE(16), Number(width) * 2, file);
        assert.equal(png.readUInt32BE(20), Number(height) * 2, file);
      }
    } else {
      assert.equal(ext, "svg", file);
    }
  }
  assert.ok(realLogos >= 95);
  const logoRule = css.match(/\n\.brand-tile \.logo img \{([^}]*)\}/);
  assert.ok(logoRule);
  assert.doesNotMatch(logoRule[1], /(width|height):\s*auto/);
  assert.match(css, /\.brand-tile-name \{/);
  assert.match(html, /<p class="brand-credits">[^<]*Korkmaz logosu: Krkmz20[\s\S]*?CC BY-SA 4\.0<\/a>\.<\/p>/);
});

test("markalar why section uses left-aligned copy and spaced metrics", () => {
  assert.match(html, /section-head--start/);
  assert.match(html, /class="metrics"/);
  assert.match(html, /<strong>43\+<\/strong><span>Marka portföyü<\/span>/);
  assert.match(html, /<strong>%100<\/strong><span>Faturalı satış<\/span>/);
  assert.match(html, /<strong>B2B<\/strong><span>Kurumsal odak<\/span>/);
  assert.match(html, /<strong>TR<\/strong><span>Yerel tedarik<\/span>/);
  assert.doesNotMatch(html, /<strong>100%<\/strong>/);
  assert.doesNotMatch(html, /43\+Marka|100%Faturalı|B2BKurumsal|TRYerel/);
  assert.match(css, /\.metrics\s*\{/);
  assert.match(css, /\.metric\s*\{/);
  assert.match(css, /\.section-head--start/);
});

test("homepage dark stats use Turkish percent order", () => {
  assert.match(indexHtml, /<strong>%100<\/strong><span>Faturalı satış<\/span>/);
  assert.doesNotMatch(indexHtml, /<strong>100%<\/strong>/);
});
