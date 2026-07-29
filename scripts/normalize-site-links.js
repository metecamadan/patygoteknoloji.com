#!/usr/bin/env node
/** Normalize public page footers, root-absolute assets, and a few link fixes. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const CONTACT_SVG_PHONE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.8 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CONTACT_SVG_MAIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const FOOTER_GRID = `
      <div class="footer-grid">
        <div class="footer-brand">
          <img src="/assets/img/patygo-logo.png" alt="Patygo Teknoloji" />
          <p>Patygo Teknoloji ve Bilişim Ltd. Şti. — Elektronik marka ürünlerin kurumsal temin, tedarik ve satışı.</p>
        </div>
        <div class="footer-col">
          <h4>Kurumsal</h4>
          <a href="/kurumsal">Hakkımızda</a>
          <a href="/kurumsal#bilgiler">Şirket Bilgileri</a>
          <a href="/urunler">Ürünler</a>
          <a href="/markalar">Markalar</a>
          <a href="/hizmetler">Kurumsal Tedarik</a>
          <a href="/iletisim">İletişim</a>
        </div>
        <div class="footer-col">
          <h4>Yasal</h4>
          <a href="/on-bilgilendirme-formu">Ön Bilgilendirme</a>
          <a href="/mesafeli-satis-sozlesmesi">Mesafeli Satış Sözleşmesi</a>
          <a href="/iade-ve-cayma">İade ve Cayma</a>
          <a href="/hizmet-sozlesmesi">Satış Sözleşmesi</a>
          <a href="/kvkk">KVKK</a>
        </div>
        <div class="footer-col">
          <h4>İletişim</h4>
          <a class="footer-contact" href="tel:+905555070724">${CONTACT_SVG_PHONE} 0555 507 07 24</a>
          <a class="footer-contact" href="mailto:info@patygoteknoloji.com">${CONTACT_SVG_MAIL} info@patygoteknoloji.com</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; <span data-year>2026</span> Patygo Teknoloji ve Bilişim Ltd. Şti.</span>
        <div class="legal-links">
          <a href="/kvkk">KVKK</a>
          <a href="/gizlilik">Gizlilik</a>
          <a href="/cerez">Çerez</a>
          <a href="/kullanim-kosullari">Kullanım Koşulları</a>
          <a href="/admin" rel="nofollow">Yönetim</a>
        </div>
      </div>`.trim();

function absolutizeAssets(html) {
  return html
    .replace(/(href|src)=(["'])assets\//g, "$1=$2/assets/")
    .replace(/(href|src)=(["'])\.\/assets\//g, "$1=$2/assets/");
}

function replaceFooter(html) {
  const re = /<div class="footer-grid">[\s\S]*?<div class="footer-bottom">[\s\S]*?<\/div>\s*<\/div>/;
  if (!re.test(html)) return { html, changed: false };
  return { html: html.replace(re, FOOTER_GRID), changed: true };
}

const skip = new Set(["admin.html", "404.html"]);
const files = fs.readdirSync(root).filter((f) => f.endsWith(".html") && !skip.has(f));

for (const file of files) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, "utf8");
  const before = html;
  html = absolutizeAssets(html);
  const foot = replaceFooter(html);
  html = foot.html;
  if (file === "odeme.html") {
    html = html.replace('href="/#urunler"', 'href="/urunler"');
  }
  if (html !== before) {
    fs.writeFileSync(full, html);
    console.log("updated", file, foot.changed ? "(footer)" : "");
  } else {
    console.log("unchanged", file);
  }
}

// 404 + admin assets
for (const file of ["404.html", "admin.html"]) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, "utf8");
  const next = absolutizeAssets(html);
  if (next !== html) {
    fs.writeFileSync(full, next);
    console.log("updated", file, "(assets)");
  }
}

console.log("done");
