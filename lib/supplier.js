const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { XMLParser } = require("fast-xml-parser");

const MAX_XML_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
}

function canonicalKey(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isPrivateIp(address) {
  if (!net.isIP(address)) return true;
  if (address.includes(":")) {
    const ip = address.toLowerCase();
    const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mappedIpv4) return isPrivateIp(mappedIpv4[1]);
    return (
      ip === "::1" ||
      ip === "::" ||
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb")
    );
  }
  const parts = address.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

async function validateSupplierUrl(rawUrl, allowedHosts, dependencies) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch (_) {
    throw new Error("Geçerli bir XML bağlantısı girin.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("XML bağlantısı HTTP veya HTTPS olmalıdır.");
  }
  if (url.username || url.password) {
    throw new Error("Kullanıcı adı ve parolayı URL adres bölümünde kullanmayın.");
  }
  const hosts = (allowedHosts || []).map((host) => String(host).toLowerCase());
  if (!hosts.length || !hosts.includes(url.hostname.toLowerCase())) {
    throw new Error("Bu tedarikçi alan adına izin verilmemiş.");
  }
  const lookup = (dependencies && dependencies.lookup) || dns.lookup;
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error("XML bağlantısı özel veya yerel bir IP adresine yönlenemez.");
  }
  return url;
}

async function fetchSupplierXml(url, options) {
  const settings = options || {};
  const timeoutMs = Number(settings.timeoutMs) || FETCH_TIMEOUT_MS;
  const maxBytes = Number(settings.maxBytes) || MAX_XML_BYTES;
  const fetchImpl = settings.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
        "User-Agent": "Patygo-Catalog-Sync/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Tedarikçi XML sunucusu " + response.status + " yanıtı verdi.");
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > maxBytes) throw new Error("XML dosyası boyut sınırını aşıyor.");

    const reader = response.body && response.body.getReader();
    if (!reader) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        throw new Error("XML dosyası boyut sınırını aşıyor.");
      }
      return text;
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("XML dosyası boyut sınırını aşıyor.");
      }
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("Tedarikçi XML bağlantısı zaman aşımına uğradı.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return scalar(value[0]);
  if (typeof value === "object") {
    if ("#text" in value) return scalar(value["#text"]);
    const first = Object.values(value).find(
      (item) => typeof item === "string" || typeof item === "number"
    );
    return scalar(first);
  }
  return "";
}

function field(record, aliases) {
  const entries = Object.entries(record || {});
  const wanted = new Set(aliases.map(canonicalKey));
  const match = entries.find(([key]) => wanted.has(canonicalKey(key)));
  return match ? scalar(match[1]) : "";
}

function parseNumber(value) {
  let text = String(value || "").replace(/[^\d.,-]/g, "");
  if (!text) return 0;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma > dot) text = text.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) text = text.replace(/,/g, "");
  else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\./g, "");
  const number = Number(text);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function findRecords(root) {
  const candidates = [];
  function visit(value, depth) {
    if (depth > 8 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
      if (objects.length) {
        const keys = Object.keys(objects[0]).map(canonicalKey);
        const score =
          keys.some((key) => /stok|stock|code|kod|sku|id/.test(key)) * 3 +
          keys.some((key) => /urun|product|name|title|ad/.test(key)) * 3 +
          keys.some((key) => /fiyat|price/.test(key)) * 2 +
          Math.min(objects.length, 20) / 20;
        candidates.push({ records: objects, score });
      }
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).map(canonicalKey);
      const score =
        keys.some((key) => /stok|stock|code|kod|sku|id/.test(key)) * 3 +
        keys.some((key) => /urun|product|name|title|ad/.test(key)) * 3 +
        keys.some((key) => /fiyat|price/.test(key)) * 2;
      if (score >= 6) candidates.push({ records: [value], score });
      Object.values(value).forEach((item) => visit(item, depth + 1));
    }
  }
  visit(root, 0);
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || candidates[0].score < 3) {
    throw new Error("XML içinde ürün listesi tespit edilemedi.");
  }
  return candidates[0].records;
}

function mapCategory(raw) {
  const value = canonicalKey(raw);
  if (/yazici|printer|tarayici|scanner|baski/.test(value)) return "yazici";
  if (/beyazesya|buzdolabi|camasir|bulasik|ankastre|klima/.test(value)) return "beyaz-esya";
  if (/ev|mutfak|supurge|kahve|kisiselbakim/.test(value)) return "kucuk-ev";
  return "bilgisayar";
}

function normalizeImage(raw, baseUrl) {
  if (!raw) return "";
  try {
    const url = new URL(raw, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href.slice(0, 700) : "";
  } catch (_) {
    return "";
  }
}

function normalizeSupplierRecord(record, index, baseUrl) {
  const sku =
    field(record, [
      "stockCode",
      "stokKodu",
      "stok_kodu",
      "sku",
      "productCode",
      "urunKodu",
      "code",
      "model",
      "id",
    ]) || "row-" + (index + 1);
  const name = field(record, ["productName", "urunAdi", "urun_adi", "name", "title", "baslik"]);
  const brand = field(record, ["brand", "marka", "manufacturer", "uretici"]) || "MARKASIZ";
  const costPrice = parseNumber(
    field(record, [
      "price",
      "fiyat",
      "bayiFiyati",
      "bayi_fiyati",
      "salePrice",
      "satisFiyati",
      "netFiyat",
    ])
  );
  const stockRaw = field(record, [
    "stock",
    "stok",
    "stockAmount",
    "stokAdedi",
    "quantity",
    "miktar",
  ]);
  const stockQty = stockRaw === "" ? null : Math.max(0, Math.floor(parseNumber(stockRaw)));
  const rawCategory = field(record, ["category", "kategori", "categoryName", "kategoriAdi"]);
  const image = normalizeImage(
    field(record, ["image", "imageUrl", "resim", "resimUrl", "picture", "picture1"]),
    baseUrl
  );
  const barcode = field(record, ["barcode", "barkod", "ean", "gtin"]);
  const description = field(record, ["description", "aciklama", "detail", "detay"]);
  const hash = crypto.createHash("sha1").update(sku).digest("hex").slice(0, 8);
  return {
    supplierSku: sku.slice(0, 120),
    id: "sup-" + (slugify(sku) || "urun") + "-" + hash,
    barcode: barcode.slice(0, 40),
    brand: brand.trim().toUpperCase().slice(0, 60),
    name: name.trim().slice(0, 180),
    description: description.trim().slice(0, 2000),
    costPrice,
    stockQty,
    supplierCategory: rawCategory.slice(0, 160),
    category: mapCategory(rawCategory),
    image,
  };
}

function parseSupplierXml(xml, baseUrl) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
    parseTagValue: false,
    processEntities: false,
  });
  const parsed = parser.parse(xml);
  return findRecords(parsed)
    .map((record, index) => normalizeSupplierRecord(record, index, baseUrl))
    .filter((item) => item.name && item.costPrice > 0);
}

function maskUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol + "//" + url.host + "/••••••";
  } catch (_) {
    return "••••••";
  }
}

function createSupplierStore(root, options) {
  options = options || {};
  const runtimeDir = path.join(root, ".runtime");
  const filePrefix = /^[a-z0-9-]+$/i.test(options.filePrefix || "")
    ? options.filePrefix
    : "supplier";
  const files = {
    config: path.join(runtimeDir, filePrefix + "-config.json"),
    cache: path.join(runtimeDir, filePrefix + "-cache.json"),
    overrides: path.join(runtimeDir, filePrefix + "-overrides.json"),
    settings: path.join(runtimeDir, filePrefix + "-settings.json"),
  };
  fs.mkdirSync(runtimeDir, { recursive: true });
  const envMargin = Number(options.defaultMarginPercent);
  const validateUrl =
    options.validateUrl ||
    ((rawUrl) => validateSupplierUrl(rawUrl, options.allowedHosts));
  const xmlFetcher = options.fetchXml || fetchSupplierXml;

  function getConfig() {
    const saved = readJson(files.config, {});
    return {
      url: String(saved.url || options.envUrl || "").trim(),
      name: String(saved.name || options.defaultName || "XML Kaynağı").trim().slice(0, 60),
    };
  }

  function getSettings() {
    const saved = readJson(files.settings, {});
    return {
      globalMarginPercent: Number.isFinite(Number(saved.globalMarginPercent))
        ? Math.max(0, Math.min(500, Number(saved.globalMarginPercent)))
        : Number.isFinite(envMargin)
          ? Math.max(0, Math.min(500, envMargin))
          : 15,
      lastFetchAt: saved.lastFetchAt || null,
      lastFetchStatus: saved.lastFetchStatus || "never",
      lastError: saved.lastError || "",
      itemCount: Number(saved.itemCount) || 0,
      durationMs: Number(saved.durationMs) || 0,
    };
  }

  function saveSettings(patch) {
    const next = Object.assign({}, getSettings(), patch || {});
    atomicWriteJson(files.settings, next);
    return next;
  }

  function getOverrides() {
    const value = readJson(files.overrides, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function getCache() {
    const value = readJson(files.cache, []);
    return Array.isArray(value) ? value : [];
  }

  async function saveUrl(rawUrl, name) {
    const url = await validateUrl(rawUrl);
    const current = getConfig();
    const safeName = String(name || current.name || options.defaultName || "XML Kaynağı")
      .trim()
      .slice(0, 60);
    atomicWriteJson(files.config, {
      url: url.href,
      name: safeName,
      savedAt: new Date().toISOString(),
    });
    return {
      configured: true,
      maskedUrl: maskUrl(url.href),
      host: url.hostname,
      name: safeName,
    };
  }

  function status() {
    const config = getConfig();
    const settings = getSettings();
    return Object.assign({}, settings, {
      configured: Boolean(config.url),
      maskedUrl: maskUrl(config.url),
      host: config.url ? new URL(config.url).hostname : "",
      name: config.name,
    });
  }

  async function refresh() {
    const config = getConfig();
    if (!config.url) throw new Error("Önce tedarikçi XML bağlantısını kaydedin.");
    const started = Date.now();
    try {
      const url = await validateUrl(config.url);
      const xml = await xmlFetcher(url);
      const products = parseSupplierXml(xml, url);
      if (!products.length) throw new Error("XML içinde fiyatı ve adı geçerli ürün bulunamadı.");
      atomicWriteJson(files.cache, products);
      saveSettings({
        lastFetchAt: new Date().toISOString(),
        lastFetchStatus: "ok",
        lastError: "",
        itemCount: products.length,
        durationMs: Date.now() - started,
      });
      return { itemCount: products.length, durationMs: Date.now() - started };
    } catch (err) {
      saveSettings({
        lastFetchAt: new Date().toISOString(),
        lastFetchStatus: "error",
        lastError: String(err && err.message ? err.message : "XML alınamadı").slice(0, 300),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  function setGlobalMargin(value) {
    const margin = Number(value);
    if (!Number.isFinite(margin) || margin < 0 || margin > 500) {
      throw new Error("Kâr oranı 0 ile 500 arasında olmalıdır.");
    }
    return saveSettings({ globalMarginPercent: margin });
  }

  function updateOverrides(updates) {
    const current = getOverrides();
    for (const update of updates || []) {
      const sku = String(update.supplierSku || "").trim().slice(0, 120);
      if (!sku) continue;
      const previous = current[sku] || {};
      const next = Object.assign({}, previous);
      if (typeof update.active === "boolean") next.active = update.active;
      if (update.salePrice === null || update.salePrice === "") delete next.salePrice;
      else if (update.salePrice !== undefined) {
        const price = Number(update.salePrice);
        if (!Number.isFinite(price) || price < 0) throw new Error("Özel fiyat geçersiz.");
        next.salePrice = price;
      }
      if (update.marginPercent === null || update.marginPercent === "") delete next.marginPercent;
      else if (update.marginPercent !== undefined) {
        const margin = Number(update.marginPercent);
        if (!Number.isFinite(margin) || margin < 0 || margin > 500) {
          throw new Error("Ürün kâr oranı geçersiz.");
        }
        next.marginPercent = margin;
      }
      if (update.category) next.category = String(update.category).slice(0, 40);
      next.updatedAt = new Date().toISOString();
      current[sku] = next;
    }
    atomicWriteJson(files.overrides, current);
    return current;
  }

  function listProducts() {
    const settings = getSettings();
    const overrides = getOverrides();
    return getCache().map((item) => {
      const override = overrides[item.supplierSku] || {};
      const marginPercent = Number.isFinite(Number(override.marginPercent))
        ? Number(override.marginPercent)
        : settings.globalMarginPercent;
      const computed = item.costPrice * (1 + marginPercent / 100);
      const salePrice = Number.isFinite(Number(override.salePrice))
        ? Number(override.salePrice)
        : Math.round(computed * 100) / 100;
      return Object.assign({}, item, {
        active: override.active === true,
        marginPercent,
        marginOverride:
          override.marginPercent !== undefined ? Number(override.marginPercent) : null,
        salePriceOverride: override.salePrice !== undefined ? Number(override.salePrice) : null,
        salePrice,
        category: override.category || item.category,
      });
    });
  }

  return {
    saveUrl,
    status,
    refresh,
    setGlobalMargin,
    updateOverrides,
    listProducts,
    parseSupplierXml,
  };
}

module.exports = {
  atomicWriteJson,
  createSupplierStore,
  fetchSupplierXml,
  parseSupplierXml,
  validateSupplierUrl,
  isPrivateIp,
};
