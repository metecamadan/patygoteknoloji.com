const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");

const fontBuf = fs.readFileSync("C:/Windows/Fonts/segoeuib.ttf");
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

const word = "Patygo";
const sub = "teknoloji.com";
const wordSize = 32;
const subSize = 11.5;

const wordPath = font.getPath(word, 0, 0, wordSize);
const subPath = font.getPath(sub, 0, 0, subSize);
const wb = wordPath.getBoundingBox();
const sb = subPath.getBoundingBox();

const markSize = 42;
const gap = 12;
const pad = 4;
const wordBaseline = 27;
const subBaseline = 48;
const wordX = markSize + gap - wb.x1;
const subX = markSize + gap + 1 - sb.x1;
const right = Math.max(wordX + wb.x2, subX + sb.x2) + pad;
const top = 2;
const bottom = Math.max(4 + markSize, subBaseline + sb.y2) + 2;
const height = bottom - top;

/* P cutout — transparent so header (white) and footer invert both look correct */
const pCut = "M14.2 14.2h9.4c5 0 8.3 2.95 8.3 7.4 0 3.65-2.1 6.25-5.5 7.1v.15c2.25.55 3.65 2.45 3.65 5.25V35.6h-5.6v-5.7c0-1.9-1-2.95-2.95-2.95h-2.7V35.6h-5.6V14.2zm5.6 4.5v5.25h3.15c2.1 0 3.35-1.1 3.35-2.7s-1.25-2.55-3.35-2.55H19.8z";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${right.toFixed(1)} ${height.toFixed(1)}" role="img" aria-label="Patygo Teknoloji">
  <title>Patygo Teknoloji</title>
  <defs>
    <mask id="mark" maskUnits="userSpaceOnUse" x="0" y="4" width="${markSize}" height="${markSize}">
      <rect x="0" y="4" width="${markSize}" height="${markSize}" rx="11" fill="#fff"/>
      <path fill="#000" d="${pCut}"/>
    </mask>
  </defs>
  <rect x="0" y="4" width="${markSize}" height="${markSize}" rx="11" fill="#2563eb" mask="url(#mark)"/>
  <g fill="#2563eb" transform="translate(${wordX.toFixed(2)} ${wordBaseline})">
    <path d="${wordPath.toPathData(2)}"/>
  </g>
  <g fill="#64748b" transform="translate(${subX.toFixed(2)} ${subBaseline})">
    <path d="${subPath.toPathData(2)}"/>
  </g>
</svg>
`;

const out = path.join(__dirname, "..", "assets", "img", "patygo-logo.svg");
fs.writeFileSync(out, svg);
console.log("wrote", out, `viewBox 0 ${top} ${right.toFixed(1)} ${height.toFixed(1)}`);
console.log("gap word→sub", (subBaseline + sb.y1 - (wordBaseline + wb.y2)).toFixed(1));

const fav = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" rx="16" fill="#fff"/>
      <path fill="#000" transform="translate(2.5 2.5) scale(1.45)" d="${pCut}"/>
    </mask>
  </defs>
  <rect width="64" height="64" rx="16" fill="#2563eb" mask="url(#m)"/>
</svg>
`;
fs.writeFileSync(path.join(__dirname, "..", "assets", "img", "favicon.svg"), fav);
console.log("wrote favicon");
