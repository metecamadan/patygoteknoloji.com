const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "markalar.html");
const fragPath = path.join(__dirname, "markalar-brands.fragment.html");

const html = fs.readFileSync(htmlPath, "utf8");
const frag = fs.readFileSync(fragPath, "utf8");
const start = html.indexOf('<div class="brand-cat reveal">');
const end = html.indexOf('<p style="text-align:center;color:var(--muted)');
if (start < 0 || end < 0) {
  console.error("markers not found", { start, end });
  process.exit(1);
}
const out = html.slice(0, start) + frag + "\n\n        " + html.slice(end);
fs.writeFileSync(htmlPath, out);
console.log("markalar.html updated");
