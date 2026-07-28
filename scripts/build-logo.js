const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");

const fontCandidates = [
  process.env.PATYGO_LOGO_FONT,
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "C:/Windows/Fonts/segoeuib.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
].filter(Boolean);

const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
if (!fontPath) {
  throw new Error(
    "Logo fontu bulunamadı. PATYGO_LOGO_FONT ile bold TTF yolu verin."
  );
}

const font = opentype.loadSync(fontPath);

const word = "atygo";
const sub = "teknoloji.com";
const wordSize = 30;
const subSize = 11;

const wordPath = font.getPath(word, 0, 0, wordSize);
const subPath = font.getPath(sub, 0, 0, subSize);
const wb = wordPath.getBoundingBox();
const sb = subPath.getBoundingBox();

const markSize = 42;
const gap = 11;
const pad = 2;
const wordBaseline = 28;
const subBaseline = 46;
const wordX = markSize + gap - wb.x1;
const subX = markSize + gap + 1 - sb.x1;
const right = Math.max(wordX + wb.x2, subX + sb.x2) + pad;
const top = 2;
const bottom = Math.max(4 + markSize, subBaseline + sb.y2) + 2;
const height = bottom - top;

/* P cutout — transparent so light and dark backgrounds both read correctly */
const pCut =
  "M14.2 14.2h9.4c5 0 8.3 2.95 8.3 7.4 0 3.65-2.1 6.25-5.5 7.1v.15c2.25.55 3.65 2.45 3.65 5.25V35.6h-5.6v-5.7c0-1.9-1-2.95-2.95-2.95h-2.7V35.6h-5.6V14.2zm5.6 4.5v5.25h3.15c2.1 0 3.35-1.1 3.35-2.7s-1.25-2.55-3.35-2.55H19.8z";

function build(variant) {
  const brand = variant === "dark" ? "#ffffff" : "#2563eb";
  const muted = variant === "dark" ? "#94a3b8" : "#64748b";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${right.toFixed(1)} ${height.toFixed(1)}" role="img" aria-label="Patygo Teknoloji" color-interpolation="sRGB">
  <title>Patygo Teknoloji</title>
  <defs>
    <mask id="mark" maskUnits="userSpaceOnUse" x="0" y="4" width="${markSize}" height="${markSize}">
      <rect x="0" y="4" width="${markSize}" height="${markSize}" rx="11" fill="#fff"/>
      <path fill="#000" d="${pCut}"/>
    </mask>
  </defs>
  <rect x="0" y="4" width="${markSize}" height="${markSize}" rx="11" fill="${brand}" mask="url(#mark)"/>
  <g fill="${brand}" transform="translate(${wordX.toFixed(2)} ${wordBaseline})">
    <path d="${wordPath.toPathData(2)}"/>
  </g>
  <g fill="${muted}" transform="translate(${subX.toFixed(2)} ${subBaseline})">
    <path d="${subPath.toPathData(2)}"/>
  </g>
</svg>
`;
}

const outDir = path.join(__dirname, "..", "assets", "img");
fs.writeFileSync(path.join(outDir, "patygo-logo.svg"), build("light"));
fs.writeFileSync(path.join(outDir, "patygo-logo-on-dark.svg"), build("dark"));
console.log("wrote logo SVGs", `viewBox 0 ${top} ${right.toFixed(1)} ${height.toFixed(1)}`);

const fav = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" color-interpolation="sRGB">
  <defs>
    <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" rx="16" fill="#fff"/>
      <path fill="#000" transform="translate(2.5 2.5) scale(1.45)" d="${pCut}"/>
    </mask>
  </defs>
  <rect width="64" height="64" rx="16" fill="#2563eb" mask="url(#m)"/>
</svg>
`;
fs.writeFileSync(path.join(outDir, "favicon.svg"), fav);
console.log("wrote favicon");
