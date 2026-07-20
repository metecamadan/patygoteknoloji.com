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

function buildAkakceXml(products, options) {
  const siteBaseUrl = String(options.siteBaseUrl || "").replace(/\/+$/, "");
  const vatRate = Number(options.vatRate) || 0;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const rows = (products || [])
    .filter((product) => product && product.active !== false)
    .map((product) => {
      const stock =
        product.source === "supplier" && Number.isFinite(Number(product.stockQty))
          ? Math.max(0, Number(product.stockQty))
          : 1;
      const vatIncludedPrice =
        Math.round(Number(product.price || 0) * (1 + vatRate) * 100) / 100;
      const productUrl =
        siteBaseUrl + "/urun-detay.html?id=" + encodeURIComponent(product.id);
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

module.exports = { buildAkakceXml, xmlEscape };
