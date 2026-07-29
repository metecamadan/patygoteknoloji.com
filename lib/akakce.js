function xmlEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const { normalizeVatPercent } = require("./product-fields");

function absoluteUrl(value, siteBaseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, siteBaseUrl + "/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function formatDecimal(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0," + "0".repeat(digits);
  return n.toFixed(digits).replace(".", ",");
}

function numericProductId(product) {
  const raw = String(product.urunId || product.supplierSku || product.id || "");
  if (/^\d+$/.test(raw)) return raw;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return String(100000 + (hash % 900000));
}

function productStock(product) {
  if (Number.isFinite(Number(product.stockQty))) {
    return Math.max(0, Math.floor(Number(product.stockQty)));
  }
  return product.source === "supplier" ? 0 : 1;
}

function analyzeAkakceProducts(products, options) {
  const siteBaseUrl = String((options && options.siteBaseUrl) || "").replace(/\/+$/, "");
  const eligible = [];
  const excluded = [];
  for (const product of products || []) {
    if (!product || product.active === false) continue;
    const reasons = [];
    const code = String(product.supplierSku || product.id || "").trim();
    const price = Number(product.price);
    const imageUrl = absoluteUrl(product.image, siteBaseUrl);
    const stock = productStock(product);
    if (!code) reasons.push("Stok kodu eksik");
    if (!String(product.name || "").trim()) reasons.push("Ürün adı eksik");
    if (!String(product.brand || "").trim()) reasons.push("Marka eksik");
    if (!String(product.mainCategory || product.category || "").trim()) {
      reasons.push("Ana kategori eksik");
    }
    if (!String(product.midCategory || "").trim()) reasons.push("Ara kategori eksik");
    if (!String(product.subCategory || "").trim()) reasons.push("Alt kategori eksik");
    if (!Number.isFinite(price) || price <= 0) reasons.push("Fiyat geçersiz");
    if (!imageUrl) reasons.push("Görsel eksik");
    if (!String(product.barcode || "").trim()) reasons.push("Barkod eksik");
    if (!String(product.manufacturerCode || "").trim()) reasons.push("Üretici kodu eksik");
    if (!String(product.gtipCode || "").trim()) reasons.push("GTIP kodu eksik");
    if (![1, 8, 10, 20].includes(Number(product.vatPercent))) reasons.push("KDV geçersiz");
    if (!String(product.currency || "").trim()) reasons.push("Döviz türü eksik");
    if (!String(product.unit || "").trim()) reasons.push("Birim eksik");
    if (!Number.isFinite(Number(product.stockQty)) && product.source === "manual") {
      reasons.push("Stok bilgisi eksik");
    } else if (product.source === "supplier" && stock <= 0) {
      reasons.push("Stok yok");
    }
    if (!siteBaseUrl) reasons.push("Site adresi eksik");
    if (reasons.length) {
      excluded.push({
        id: product.id || code,
        name: product.name || code,
        reasons,
      });
    } else {
      eligible.push(product);
    }
  }
  const reasonCounts = {};
  for (const item of excluded) {
    for (const reason of item.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  return {
    total: eligible.length + excluded.length,
    eligible,
    excluded,
    reasonCounts,
  };
}

function buildAkakceFeedSummary(products, options) {
  const siteBaseUrl = String((options && options.siteBaseUrl) || "").replace(/\/+$/, "");
  const analysis = analyzeAkakceProducts(products, { siteBaseUrl });
  return {
    path: "/api/feeds/akakce.xml",
    publicUrl: siteBaseUrl ? siteBaseUrl + "/api/feeds/akakce.xml" : "/api/feeds/akakce.xml",
    activeCount: analysis.eligible.length,
    excludedCount: analysis.excluded.length,
    catalogActiveCount: analysis.total,
    supplierActiveCount: analysis.eligible.filter((item) => item.source === "supplier").length,
    manualActiveCount: analysis.eligible.filter((item) => item.source === "manual").length,
    reasonCounts: analysis.reasonCounts,
    issues: analysis.excluded.slice(0, 20),
  };
}

function buildAkakceXml(products, options) {
  const siteBaseUrl = String(options.siteBaseUrl || "").replace(/\/+$/, "");
  const analysis = analyzeAkakceProducts(products, { siteBaseUrl });
  const rows = analysis.eligible.map((product) => {
    const stock = productStock(product);
    const images = Array.isArray(product.images)
      ? product.images.filter(Boolean)
      : product.image
        ? [product.image]
        : [];
    const small = absoluteUrl(images[0] || product.image, siteBaseUrl);
    const large = absoluteUrl(images[1] || images[0] || product.image, siteBaseUrl);
    const barcode = String(product.barcode || "").trim();
    const name = String(product.name || "").trim();
    const shortDesc = String(product.description || "").trim();
    const details = String(product.details || product.description || "").trim();
    const vat = normalizeVatPercent(product.vatPercent);
    const currency = String(product.currency || "TRY").trim().toUpperCase();
    const unit = String(product.unit || "ADET").trim().toUpperCase();
    return [
      "<Urun>",
      `<UrunKodu>${xmlEscape(product.supplierSku || product.id)}</UrunKodu>`,
      `<UrunAciklama>${xmlEscape(name)}</UrunAciklama>`,
      `<UrunAciklama2>${xmlEscape(shortDesc)}</UrunAciklama2>`,
      `<UrunAciklama3>${xmlEscape(name)}</UrunAciklama3>`,
      `<UrunAciklama4>${xmlEscape(name)}</UrunAciklama4>`,
      `<UrunID>${xmlEscape(numericProductId(product))}</UrunID>`,
      `<UreticiKodu>${xmlEscape(product.manufacturerCode)}</UreticiKodu>`,
      `<GtipCode>${xmlEscape(product.gtipCode)}</GtipCode>`,
      `<Durum>${stock > 0 ? "1" : "0"}</Durum>`,
      `<Marka>${xmlEscape(product.brand)}</Marka>`,
      `<OzelKod>${xmlEscape(product.specialCode || product.category || "")}</OzelKod>`,
      `<AnaKategori>${xmlEscape(product.mainCategory)}</AnaKategori>`,
      `<AraKategori>${xmlEscape(product.midCategory)}</AraKategori>`,
      `<AltKategori>${xmlEscape(product.subCategory)}</AltKategori>`,
      `<Fiyat>${formatDecimal(product.price, 4)}</Fiyat>`,
      `<KDV>${xmlEscape(vat)}</KDV>`,
      `<DovizTuru>${xmlEscape(currency)}</DovizTuru>`,
      `<Stok>${xmlEscape(stock)}</Stok>`,
      "<StokBalgat>0</StokBalgat>",
      "<StokMacun>0</StokMacun>",
      `<Birim>${xmlEscape(unit)}</Birim>`,
      `<Barkod>${xmlEscape(barcode)}</Barkod>`,
      "<BarkodListesi>",
      "<Barkod>",
      `<Kod>${xmlEscape(barcode)}</Kod>`,
      `<Birim>${xmlEscape(unit)}</Birim>`,
      "<Miktar>1</Miktar>",
      "</Barkod>",
      "</BarkodListesi>",
      `<GorselKucuk>${xmlEscape(small)}</GorselKucuk>`,
      `<GorselBuyuk>${xmlEscape(large)}</GorselBuyuk>`,
      `<UrunDetaylari>${xmlEscape(details)}</UrunDetaylari>`,
      `<UrunDetaylariGenel>${xmlEscape(details)}</UrunDetaylariGenel>`,
      "</Urun>",
    ].join("\n");
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    "<Urunler>\n" +
    rows.join("\n") +
    "\n</Urunler>"
  );
}

module.exports = {
  analyzeAkakceProducts,
  buildAkakceFeedSummary,
  buildAkakceXml,
  xmlEscape,
  absoluteUrl,
  formatDecimal,
  productStock,
};
