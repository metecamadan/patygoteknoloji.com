const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "assets", "img", "brands");
fs.mkdirSync(dir, { recursive: true });

const brands = [
  ["apple", "Apple", "#111111"],
  ["samsung", "SAMSUNG", "#1428A0"],
  ["arcelik", "Arçelik", "#E30613"],
  ["beko", "beko", "#00A9E0"],
  ["vestel", "VESTEL", "#E30613"],
  ["philips", "PHILIPS", "#0B5CAB"],
  ["bosch", "BOSCH", "#E20015"],
  ["siemens", "SIEMENS", "#009999"],
  ["lenovo", "Lenovo", "#E2231A"],
  ["hp", "HP", "#0096D6"],
  ["dell", "Dell", "#007DB8"],
  ["asus", "ASUS", "#111111"],
  ["acer", "acer", "#83B81A"],
  ["xiaomi", "Xiaomi", "#FF6900"],
  ["huawei", "HUAWEI", "#CF0A2C"],
  ["lg", "LG", "#A50034"],
  ["sony", "SONY", "#111111"],
  ["epson", "EPSON", "#003399"],
  ["canon", "Canon", "#C8102E"],
  ["dyson", "dyson", "#1A1A1A"],
  ["microsoft", "Microsoft", "#5E5E5E"],
  ["korkmaz", "KORKMAZ", "#C8102E"],
  ["jbl", "JBL", "#FF6600"],
  ["brother", "Brother", "#0096D6"],
];

for (const [slug, name, color] of brands) {
  const fsSize = name.length > 9 ? 15 : name.length > 6 ? 17 : 20;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 64" role="img" aria-label="${name}">
  <text x="100" y="40" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fsSize}" font-weight="700" fill="${color}" letter-spacing="0.03em">${name}</text>
</svg>
`;
  fs.writeFileSync(path.join(dir, `${slug}.svg`), svg);
}
console.log("wrote", brands.length, "logos to", dir);
