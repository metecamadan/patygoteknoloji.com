const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "assets", "img", "brands");
fs.mkdirSync(dir, { recursive: true });

/** [slug, displayName, color] — aktif marka seti */
const brands = [
  // Bilgisayar & BT
  ["apple", "Apple", "#111111"],
  ["lenovo", "Lenovo", "#E2231A"],
  ["hp", "HP", "#0096D6"],
  ["dell", "Dell", "#007DB8"],
  ["asus", "ASUS", "#111111"],
  ["acer", "acer", "#83B81A"],
  ["microsoft", "Microsoft", "#5E5E5E"],
  ["huawei", "HUAWEI", "#CF0A2C"],
  ["msi", "MSI", "#FF0000"],
  ["gigabyte", "GIGABYTE", "#F47920"],
  ["intel", "intel", "#0071C5"],
  ["amd", "AMD", "#ED1C24"],
  ["logitech", "Logitech", "#00B8FC"],
  ["razer", "RAZER", "#44D62C"],
  ["corsair", "CORSAIR", "#111111"],
  ["kingston", "KINGSTON", "#C8102E"],
  ["casper", "Casper", "#E30613"],
  ["monster", "Monster", "#111111"],
  ["toshiba", "TOSHIBA", "#CC0000"],
  ["fujitsu", "FUJITSU", "#E60012"],
  ["benq", "BenQ", "#FF6600"],
  ["viewsonic", "ViewSonic", "#D71920"],
  ["tplink", "TP-Link", "#4ACBD6"],
  ["cisco", "CISCO", "#049FD9"],

  // Mobil & Tüketici
  ["samsung", "SAMSUNG", "#1428A0"],
  ["xiaomi", "Xiaomi", "#FF6900"],
  ["lg", "LG", "#A50034"],
  ["sony", "SONY", "#111111"],
  ["jbl", "JBL", "#FF6600"],
  ["philips", "PHILIPS", "#0B5CAB"],
  ["oppo", "OPPO", "#1BA784"],
  ["vivo", "vivo", "#415FFF"],
  ["honor", "HONOR", "#111111"],
  ["oneplus", "OnePlus", "#F5010C"],
  ["google", "Google", "#4285F4"],
  ["duracell", "Duracell", "#000000"],
  ["dji", "DJI", "#111111"],
  ["panasonic", "Panasonic", "#013B81"],
  ["gopro", "GoPro", "#111111"],
  ["garmin", "Garmin", "#007CC3"],
  ["bose", "BOSE", "#111111"],
  ["beats", "Beats", "#E01F3D"],
  ["anker", "Anker", "#00A9E0"],
  ["marshall", "Marshall", "#111111"],
  ["nikon", "Nikon", "#FFE100"],
  ["braun", "Braun", "#111111"],

  // Beyaz eşya & ev
  ["arcelik", "Arçelik", "#E30613"],
  ["beko", "beko", "#00A9E0"],
  ["vestel", "VESTEL", "#E30613"],
  ["bosch", "BOSCH", "#E20015"],
  ["siemens", "SIEMENS", "#009999"],
  ["dyson", "dyson", "#1A1A1A"],
  ["korkmaz", "KORKMAZ", "#C8102E"],
  ["profilo", "Profilo", "#E30613"],
  ["altus", "Altus", "#0033A0"],
  ["regal", "Regal", "#E30613"],
  ["grundig", "GRUNDIG", "#111111"],
  ["electrolux", "Electrolux", "#003DA5"],
  ["whirlpool", "Whirlpool", "#111111"],
  ["miele", "Miele", "#E2001A"],
  ["hotpoint", "Hotpoint", "#E30613"],
  ["indesit", "Indesit", "#E30613"],
  ["tefal", "Tefal", "#E30613"],
  ["fakir", "FAKIR", "#C8102E"],
  ["homend", "Homend", "#E30613"],
  ["schafer", "Schafer", "#C8102E"],
  ["rowenta", "Rowenta", "#E30613"],
  ["arzum", "Arzum", "#E30613"],
  ["smeg", "SMEG", "#E30613"],
  ["kitchenaid", "KitchenAid", "#C8102E"],

  // Yazıcı & çevre
  ["epson", "EPSON", "#003399"],
  ["canon", "Canon", "#C8102E"],
  ["brother", "Brother", "#0096D6"],
  ["xerox", "Xerox", "#DA291C"],
  ["kyocera", "KYOCERA", "#E60012"],
  ["ricoh", "RICOH", "#E60012"],
  ["lexmark", "Lexmark", "#C8102E"],
  ["seagate", "Seagate", "#6EBE4A"],
  ["oki", "OKI", "#E60012"],
  ["konica", "Konica Minolta", "#0033A0"],
  ["zebra", "ZEBRA", "#111111"],
  ["wd", "Western Digital", "#00529B"],
  ["honeywell", "Honeywell", "#E30613"],
  ["dymo", "DYMO", "#0033A0"],
  ["sandisk", "SanDisk", "#ED1C24"],
  ["kodak", "KODAK", "#FFD100"],
  ["fujifilm", "FUJIFILM", "#E60012"],
  ["3m", "3M", "#E30613"],
  ["logitech-print", "Logitech", "#00B8FC"],
  ["hp-print", "HP", "#0096D6"],
  ["samsung-print", "SAMSUNG", "#1428A0"],
  ["nikon-print", "Nikon", "#111111"],
  ["fujitsu-scan", "FUJITSU", "#E60012"],
  ["energizer", "Energizer", "#E30613"],
];

const keep = new Set(brands.map(([s]) => s));
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".svg")) continue;
  const slug = file.replace(/\.svg$/, "");
  if (!keep.has(slug)) {
    fs.unlinkSync(path.join(dir, file));
    console.log("removed", file);
  }
}

const seen = new Set();
for (const [slug, name, color] of brands) {
  if (seen.has(slug)) throw new Error("duplicate slug " + slug);
  seen.add(slug);
  const fsSize = name.length > 12 ? 13 : name.length > 9 ? 15 : name.length > 6 ? 18 : 22;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 72" role="img" aria-label="${name}">
  <text x="110" y="44" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fsSize}" font-weight="700" fill="${color}" letter-spacing="0.02em">${name}</text>
</svg>
`;
  fs.writeFileSync(path.join(dir, `${slug}.svg`), svg);
}
console.log("wrote", brands.length, "logos");
