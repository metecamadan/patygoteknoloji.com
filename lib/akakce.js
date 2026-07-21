function xmlEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteUrl(value, siteBaseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, siteBaseUrl + "/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
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
    if (!code) reasons.push("Stok kodu eksik");
    if (!String(product.name || "").trim()) reasons.push("Ürün adı eksik");
    if (!String(product.brand || "").trim()) reasons.push("Marka eksik");
    if (!String(product.category || "").trim()) reasons.push("Kategori eksik");
    if (!Number.isFinite(price) || price <= 0) reasons.push("Fiyat geçersiz");
    if (!imageUrl) reasons.push("Görsel eksik");
    if (product.source === "supplier") {
      if (!Number.isFinite(Number(product.stockQty))) reasons.push("Stok bilgisi eksik");
      else if (Number(product.stockQty) <= 0) reasons.push("Stok yok");
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
  const vatRate = Number(options.vatRate) || 0;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const analysis = analyzeAkakceProducts(products, { siteBaseUrl });
  const rows = analysis.eligible
    .map((product) => {
      const stock =
        product.source === "supplier" && Number.isFinite(Number(product.stockQty))
          ? Math.max(0, Number(product.stockQty))
          : 1;
      const vatIncludedPrice =
        Math.round(Number(product.price || 0) * (1 + vatRate) * 100) / 100;
      const productUrl =
        siteBaseUrl + "/urun-detay?id=" + encodeURIComponent(product.id);
      const imageUrl = absoluteUrl(product.image, siteBaseUrl);
      return [
        "  <product>",
        `    <stockCode>${xmlEscape(product.supplierSku || product.id)}</stockCode>`,
        `    <productName>${xmlEscape(product.name)}</productName>`,
        `    <brand>${xmlEscape(product.brand)}</brand>`,
        `    <category>${xmlEscape(product.category)}</category>`,
        `    <price>${vatIncludedPrice.toFixed(2)}</price>`,
        "    <currency>TRY</currency>",
        `    <stock>${xmlEscape(stock)}</stock>`,
        `    <barcode>${xmlEscape(product.barcode || "")}</barcode>`,
        `    <description>${xmlEscape(product.description || product.details || "")}</description>`,
        `    <productUrl>${xmlEscape(productUrl)}</productUrl>`,
        `    <imageUrl>${xmlEscape(imageUrl)}</imageUrl>`,
        "  </product>",
      ].join("\n");
    });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<products generatedAt="' +
    xmlEscape(generatedAt) +
    '">\n' +
    rows.join("\n") +
    "\n</products>"
  );
}

module.exports = {
  analyzeAkakceProducts,
  buildAkakceFeedSummary,
  buildAkakceXml,
  xmlEscape,
};
