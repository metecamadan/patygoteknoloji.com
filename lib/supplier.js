const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { XMLParser } = require("fast-xml-parser");
const { normalizeVatPercent } = require("./product-fields");
const { loadCategories, hasSiteCategory, assignedSiteCategory } = require("./categories");
const { convertCostToTry, normalizeCurrencyCode, readCachedRates } = require("./fx");
const {
  normalizeScheduleConfig,
  buildScheduleMinutes,
  parseTimeInput,
  getNextScheduledAt,
  scheduleSummary,
} = require("./supplier-schedule");

const MAX_XML_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;

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

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
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

function headerGet(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  return String(headers[name] || headers[String(name).toLowerCase()] || "");
}

function normalizeSupplierFeedUrl(rawUrl) {
  const url = new URL(String(rawUrl || "").trim());
  if (url.protocol === "http:") url.protocol = "https:";
  return url;
}

function isAllowedRedirectHost(hostname, allowedHosts, originHost) {
  const host = String(hostname || "").toLowerCase();
  const origin = String(originHost || "").toLowerCase();
  const allow = (allowedHosts || []).map((item) => String(item).toLowerCase());
  if (allow.length) return allow.includes(host);
  return Boolean(host) && host === origin;
}

async function fetchSupplierXml(url, options) {
  // Live feed allowlist: VPS 87.76.157.41 and integrator Windows 195.155.129.41.
  // Local PC egress is blocked by the supplier — do not call this against the
  // production URL from a developer machine.
  const settings = options || {};
  const timeoutMs = Number(settings.timeoutMs) || FETCH_TIMEOUT_MS;
  const maxBytes = Number(settings.maxBytes) || MAX_XML_BYTES;
  const maxRedirects = Number.isFinite(Number(settings.maxRedirects))
    ? Math.max(0, Number(settings.maxRedirects))
    : 5;
  const fetchImpl = settings.fetchImpl || fetch;
  const allowedHosts = settings.allowedHosts || [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let current = normalizeSupplierFeedUrl(url);
  let dispatcher;
  try {
    if (fetchImpl === fetch) {
      try {
        const undici = require("undici");
        if (undici && undici.Agent) {
          dispatcher = new undici.Agent({
            connect: { timeout: timeoutMs },
            headersTimeout: timeoutMs,
            bodyTimeout: timeoutMs,
          });
        }
      } catch (_) {
        dispatcher = undefined;
      }
    }
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const request = {
        headers: {
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
          "User-Agent": "Patygo-Catalog-Sync/1.0",
        },
        redirect: "manual",
        signal: controller.signal,
      };
      if (dispatcher) request.dispatcher = dispatcher;
      const response = await fetchImpl(current, request);
      const status = Number(response.status) || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = headerGet(response.headers, "location");
        if (!location) {
          throw new Error("Tedarikçi XML yönlendirme adresi eksik.");
        }
        const next = new URL(location, current);
        if (!["http:", "https:"].includes(next.protocol)) {
          throw new Error("Geçersiz tedarikçi XML yönlendirmesi.");
        }
        if (next.protocol === "http:") next.protocol = "https:";
        if (!isAllowedRedirectHost(next.hostname, allowedHosts, current.hostname)) {
          throw new Error("Tedarikçi XML yönlendirmesi izin verilen alan adları dışında.");
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        throw new Error("Tedarikçi XML sunucusu " + status + " yanıtı verdi.");
      }
      const length = Number(headerGet(response.headers, "content-length") || 0);
      if (length > maxBytes) throw new Error("XML dosyası boyut sınırını aşıyor.");

      const reader = response.body && response.body.getReader();
      if (!reader) {
        let bytes;
        if (typeof response.arrayBuffer === "function") {
          bytes = Buffer.from(await response.arrayBuffer());
        } else if (typeof response.text === "function") {
          bytes = Buffer.from(await response.text(), "utf8");
        } else {
          throw new Error("Tedarikçi XML gövdesi okunamadı.");
        }
        if (bytes.length > maxBytes) {
          throw new Error("XML dosyası boyut sınırını aşıyor.");
        }
        return decodeXmlBytes(bytes);
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
      return decodeXmlBytes(Buffer.concat(chunks));
    }
    throw new Error("Tedarikçi XML çok fazla yönlendirme içeriyor.");
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("Tedarikçi XML bağlantısı zaman aşımına uğradı.");
    }
    const cause = err && err.cause;
    const detail = cause && (cause.message || cause.code);
    if (detail && (!err.message || err.message === "fetch failed")) {
      throw new Error("Tedarikçi XML bağlantısı başarısız: " + detail);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (dispatcher && typeof dispatcher.close === "function") {
      try {
        await dispatcher.close();
      } catch (_) {}
    }
  }
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") {
    return decodeXmlEntities(String(value)).trim();
  }
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

function flattenNamespacedKeys(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const next = Object.assign({}, record);
  for (const [key, value] of Object.entries(record)) {
    const raw = String(key);
    const clark = raw.match(/\}([^}]+)$/);
    const local = clark
      ? clark[1]
      : raw.includes(":") && !raw.startsWith("http")
        ? raw.split(":").pop()
        : "";
    if (local && next[local] === undefined) next[local] = value;
  }
  return next;
}

function parseStockQty(raw) {
  const text = String(raw || "").trim().toLowerCase().replace(/_/g, " ");
  if (!text) return null;
  if (/^(in stock|instock|available|stokta|var)$/.test(text)) return 1;
  if (/^(out of stock|outofstock|unavailable|sold out|yok|tükendi)$/.test(text)) return 0;
  if (!/\d/.test(text)) return null;
  return Math.max(0, Math.floor(parseNumber(text)));
}

function isAvailabilityText(raw) {
  const text = String(raw || "").trim().toLowerCase().replace(/_/g, " ");
  return /^(in stock|instock|available|stokta|var|out of stock|outofstock|unavailable|sold out|yok|tükendi)$/.test(
    text
  );
}

function firstNonEmptyField(record, aliases) {
  const values = new Map();
  for (const [key, value] of Object.entries(record || {})) {
    const ck = canonicalKey(key);
    if (!values.has(ck)) values.set(ck, scalar(value));
  }
  for (const alias of aliases) {
    const value = values.get(canonicalKey(alias));
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function stockQtyFromRecord(record, baseUrl) {
  const qtyRaw = firstNonEmptyField(record, [
    "stockAmount",
    "stokAdedi",
    "stokAdet",
    "quantity",
    "qty",
    "miktar",
    "inventory",
    "stockQuantity",
    "stockQty",
    "stock",
    "stok",
  ]);
  if (qtyRaw && !isAvailabilityText(qtyRaw)) {
    const qty = parseStockQty(qtyRaw);
    if (qty !== null) return qty;
  }
  const host = String((baseUrl && baseUrl.hostname) || "").toLowerCase();
  if (host.includes("avansas.com")) {
    const custom = firstNonEmptyField(record, ["custom_label_1", "customLabel1"]);
    if (/^\d+$/.test(custom)) return parseInt(custom, 10);
  }
  return parseStockQty(firstNonEmptyField(record, ["availability", "stock", "stok"]));
}

function splitProductType(raw) {
  return String(raw || "")
    .replace(/&gt;/gi, ">")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
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
      const objects = value
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map(flattenNamespacedKeys);
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
  if (/kucukev|mutfak|supurge|kahve|kisiselbakim/.test(value)) return "kucuk-ev";
  return "bilgisayar";
}

function normalizeImage(raw, baseUrl) {
  if (!raw) return "";
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol === "http:") url.protocol = "https:";
    return ["http:", "https:"].includes(url.protocol) ? url.href.slice(0, 700) : "";
  } catch (_) {
    return "";
  }
}

const MAX_SUPPLIER_IMAGES = 10;

function expandImageCandidates(url) {
  const href = String(url || "").trim();
  if (!href) return [];
  const full = href.replace(/_th\.(jpe?g|png|webp)(\?.*)?$/i, ".$1$2");
  if (full && full !== href) return [full, href];
  return [href];
}

function collectSupplierImages(record, baseUrl) {
  const seen = new Set();
  const images = [];
  function add(raw) {
    const href = normalizeImage(raw, baseUrl);
    expandImageCandidates(href).forEach((url) => {
      if (!url || seen.has(url) || images.length >= MAX_SUPPLIER_IMAGES) return;
      seen.add(url);
      images.push(url);
    });
  }
  [
    "gorselBuyuk",
    "GorselBuyuk",
    "image",
    "imageUrl",
    "imageLink",
    "image_link",
    "resim",
    "resimUrl",
    "picture",
    "picture1",
    "gorselKucuk",
    "GorselKucuk",
  ].forEach((alias) => add(firstNonEmptyField(record, [alias])));
  Object.entries(record || {}).forEach(([key, value]) => {
    if (!/gorsel|resim|picture|image/i.test(String(key))) return;
    add(value);
  });
  return images;
}

function sameProductText(left, right) {
  return canonicalKey(left) === canonicalKey(right) && Boolean(canonicalKey(left));
}

function listedSupplierImages(item, override) {
  const overrideList = Array.isArray(override && override.images) ? override.images : null;
  const source = overrideList && overrideList.length
    ? overrideList
    : Array.isArray(item.images) && item.images.length
      ? item.images
      : item.image
        ? [item.image]
        : [];
  const seen = new Set();
  const images = [];
  source.forEach((raw) => {
    const href = String(raw || "")
      .trim()
      .replace(/^http:\/\//i, "https://")
      .slice(0, 700);
    const candidates =
      overrideList && overrideList.length ? [href] : expandImageCandidates(href);
    candidates.forEach((url) => {
      if (!url || seen.has(url) || images.length >= MAX_SUPPLIER_IMAGES) return;
      if (!/^https?:\/\//i.test(url) && !url.startsWith("/assets/img/products/")) return;
      seen.add(url);
      images.push(url);
    });
  });
  return images;
}

function normalizeSupplierRecord(record, index, baseUrl) {
  record = flattenNamespacedKeys(record);
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
  const name = field(record, [
    "productName",
    "urunAdi",
    "urun_adi",
    "stokAdi",
    "urunIsmi",
    "name",
    "title",
    "baslik",
    "adi",
    "urunAciklama",
    "urunAciklama2",
  ]);
  const brand = field(record, ["brand", "marka", "manufacturer", "uretici"]) || "MARKASIZ";
  const priceRaw = field(record, [
    "price",
    "fiyat",
    "bayiFiyati",
    "bayiFiyat",
    "bayi_fiyati",
    "listeFiyati",
    "alisFiyati",
    "satisFiyatiKdvDahil",
    "kdvDahilFiyat",
    "kdvliFiyat",
    "salePrice",
    "satisFiyati",
    "netFiyat",
    "specialPrice",
  ]);
  const costPrice = parseNumber(priceRaw);
  const stockQty = stockQtyFromRecord(record, baseUrl);
  const typeParts = splitProductType(
    field(record, ["productType", "product_type", "googleProductCategory"])
  );
  const rawCategory =
    field(record, ["category", "kategori", "categoryName", "kategoriAdi", "altKategori"]) ||
    field(record, ["anaKategori", "AnaKategori"]) ||
    typeParts.join(" > ");
  const images = collectSupplierImages(record, baseUrl);
  const image = images[0] || "";
  const barcode = field(record, ["barcode", "barkod", "ean", "gtin", "Barkod"]);
  const rawDescription = field(record, [
    "urunAciklama2",
    "urunAciklama3",
    "urunAciklama4",
    "description",
    "aciklama",
    "detail",
    "detay",
    "urunDetaylari",
    "UrunDetaylari",
  ]);
  const description = sameProductText(rawDescription, name)
    ? ""
    : String(rawDescription || "").trim().slice(0, 2000);
  const rawDetails = field(record, [
    "urunDetaylari",
    "UrunDetaylari",
    "longDescription",
    "details",
    "urunAciklama3",
    "urunAciklama4",
  ]);
  const details = sameProductText(rawDetails, name)
    ? description
    : String(rawDetails || description || "").trim().slice(0, 8000);
  const manufacturerCode =
    field(record, ["manufacturerCode", "ureticiKodu", "UreticiKodu", "mpn", "model"]) || sku;
  const gtipCode = field(record, ["gtipCode", "GtipCode", "gtip", "hsCode"]);
  const mainCategory =
    field(record, ["mainCategory", "anaKategori", "AnaKategori"]) || typeParts[0] || "";
  const midCategory =
    field(record, ["midCategory", "araKategori", "AraKategori"]) || typeParts[1] || "";
  const subCategory =
    field(record, ["subCategory", "altKategori", "AltKategori"]) || typeParts[2] || "";
  const vatPercent = normalizeVatPercent(
    parseNumber(field(record, ["kdv", "KDV", "vat", "vatRate"]))
  );
  const currencyMatch = String(priceRaw || "").match(/\b([A-Za-z]{3})\b/);
  const currency = normalizeCurrencyCode(
    field(record, ["currency", "dovizTuru", "DovizTuru", "paraBirimi"]) ||
      (currencyMatch ? currencyMatch[1] : "") ||
      "TRY"
  );
  const unit = field(record, ["unit", "birim", "Birim"]) || "ADET";
  const specialCode = field(record, ["specialCode", "ozelKod", "OzelKod"]);
  const mappedCategory = mapCategory(
    [rawCategory, mainCategory, midCategory, subCategory].filter(Boolean).join(" ")
  );
  const hash = crypto.createHash("sha1").update(sku).digest("hex").slice(0, 8);
  return {
    supplierSku: sku.slice(0, 120),
    id: "sup-" + (slugify(sku) || "urun") + "-" + hash,
    barcode: barcode.slice(0, 40),
    brand: brand.trim().toUpperCase().slice(0, 60),
    name: name.trim().slice(0, 180),
    description,
    details,
    costPrice,
    stockQty,
    supplierCategory: rawCategory.slice(0, 160),
    category: mappedCategory,
    image,
    images,
    manufacturerCode: manufacturerCode.trim().slice(0, 80),
    gtipCode: gtipCode.trim().slice(0, 40),
    mainCategory: mainCategory.trim().slice(0, 80),
    midCategory: midCategory.trim().slice(0, 80),
    subCategory: subCategory.trim().slice(0, 80),
    vatPercent,
    currency: String(currency).trim().toUpperCase().slice(0, 8) || "TRY",
    unit: String(unit).trim().toUpperCase().slice(0, 20) || "ADET",
    specialCode: specialCode.trim().slice(0, 40),
  };
}

function looksMojibake(text) {
  return /Ã.|Ä±|Å[Ÿž]|Å|Â[şŞıİğĞüÜöÖçÇ]/.test(String(text || "").slice(0, 4000));
}

function decodeXmlBytes(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const head = buf.slice(0, 240).toString("ascii");
  const declared = String((head.match(/encoding\s*=\s*["']([^"']+)/i) || [])[1] || "")
    .trim()
    .toLowerCase();
  const candidates = [];
  if (declared === "windows-1254" || declared === "iso-8859-9") {
    candidates.push("windows-1254", "iso-8859-9", "utf-8", "latin1");
  } else if (declared && declared !== "utf-8" && declared !== "utf8") {
    candidates.push(declared, "utf-8", "windows-1254");
  } else {
    candidates.push("utf-8", "windows-1254", "latin1");
  }
  const decoded = [];
  for (const label of candidates) {
    try {
      decoded.push({ label, text: new TextDecoder(label).decode(buf) });
    } catch (_) {}
  }
  if (!decoded.length) return buf.toString("utf8");
  const clean = decoded.find((item) => !looksMojibake(item.text));
  return (clean || decoded[0]).text;
}

function supplierFaultMessage(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  const fault = parsed.Hata || parsed.hata || parsed.Error || parsed.error;
  if (!fault) return "";
  const message = scalar(
    (fault && (fault.HataAciklama || fault.hataAciklama || fault.Message || fault.message)) || fault
  );
  return String(message || "").trim().slice(0, 280);
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
  const fault = supplierFaultMessage(parsed);
  if (fault) throw new Error(fault);
  const records = findRecords(parsed);
  const products = records
    .map((record, index) => normalizeSupplierRecord(flattenNamespacedKeys(record), index, baseUrl))
    .filter((item) => item.name && item.costPrice > 0);
  if (!products.length) {
    const sample = records[0] ? flattenNamespacedKeys(records[0]) : {};
    const keys = Object.keys(sample)
      .filter((key) => !String(key).startsWith("?"))
      .slice(0, 18)
      .join(", ");
    throw new Error(
      "XML içinde fiyatı ve adı geçerli ürün bulunamadı. Kayıt: " +
        records.length +
        (keys ? " Alanlar: " + keys : "")
    );
  }
  return products;
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
    lastXml: path.join(runtimeDir, filePrefix + "-last.xml"),
  };
  fs.mkdirSync(runtimeDir, { recursive: true });
  const envMargin = Number(options.defaultMarginPercent);
  const validateUrl =
    options.validateUrl ||
    ((rawUrl) => validateSupplierUrl(rawUrl, options.allowedHosts));
  const xmlFetcher =
    options.fetchXml ||
    ((feedUrl) =>
      fetchSupplierXml(feedUrl, {
        allowedHosts: options.allowedHosts,
      }));

  function getConfig() {
    const saved = readJson(files.config, {});
    return {
      url: String(saved.url || options.envUrl || "").trim(),
      name: String(saved.name || options.defaultName || "XML Kaynağı").trim().slice(0, 60),
    };
  }

  function getSettings() {
    const saved = readJson(files.settings, {});
    const schedule = normalizeScheduleConfig(saved);
    return {
      globalMarginPercent: Number.isFinite(Number(saved.globalMarginPercent))
        ? Math.max(0, Math.min(500, Number(saved.globalMarginPercent)))
        : Number.isFinite(envMargin)
          ? Math.max(0, Math.min(500, envMargin))
          : 15,
      criticalStockQty: Number.isFinite(Number(saved.criticalStockQty))
        ? Math.max(0, Math.floor(Number(saved.criticalStockQty)))
        : 0,
      scheduleStartMinute: schedule.scheduleStartMinute,
      scheduleIntervalMinutes: schedule.scheduleIntervalMinutes,
      lastFetchAt: saved.lastFetchAt || null,
      lastSuccessfulFetchAt: saved.lastSuccessfulFetchAt || null,
      lastFetchStatus: saved.lastFetchStatus || "never",
      lastError: saved.lastError || "",
      lastScheduledFetchKey: String(saved.lastScheduledFetchKey || ""),
      holdScheduledFetchesAt: saved.holdScheduledFetchesAt || null,
      catalogStale: Boolean(saved.catalogStale),
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
    const url = await validateUrl(normalizeSupplierFeedUrl(rawUrl).href);
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
    const cache = getCache();
    const catalogStale =
      Boolean(settings.catalogStale) ||
      (settings.lastFetchStatus === "error" && cache.length > 0);
    const minutes = buildScheduleMinutes(
      settings.scheduleStartMinute,
      settings.scheduleIntervalMinutes
    );
    const schedule = scheduleSummary(minutes, settings.scheduleIntervalMinutes);
    return Object.assign({}, settings, {
      configured: Boolean(config.url),
      maskedUrl: maskUrl(config.url),
      host: config.url ? new URL(config.url).hostname : "",
      name: config.name,
      itemCount: cache.length,
      catalogStale,
      lastSuccessfulFetchAt: settings.lastSuccessfulFetchAt || null,
      scheduleTimes: schedule.times,
      schedule,
      nextScheduled: getNextScheduledAt(new Date(), minutes),
    });
  }

  async function refresh() {
    const config = getConfig();
    if (!config.url) throw new Error("Önce tedarikçi XML bağlantısını kaydedin.");
    const started = Date.now();
    const previous = getCache();
    try {
      const normalizedHref = normalizeSupplierFeedUrl(config.url).href;
      const url = await validateUrl(normalizedHref);
      if (url.href !== config.url) {
        atomicWriteJson(files.config, {
          url: url.href,
          name: config.name,
          savedAt: new Date().toISOString(),
        });
      }
      const xml = await xmlFetcher(url);
      try {
        const temp = files.lastXml + "." + process.pid + ".tmp";
        fs.writeFileSync(temp, xml, "utf8");
        fs.renameSync(temp, files.lastXml);
      } catch (_) {}
      const products = parseSupplierXml(xml, url);
      if (!products.length) throw new Error("XML içinde fiyatı ve adı geçerli ürün bulunamadı.");
      atomicWriteJson(files.cache, products);
      const now = new Date().toISOString();
      saveSettings({
        lastFetchAt: now,
        lastSuccessfulFetchAt: now,
        lastFetchStatus: "ok",
        lastError: "",
        catalogStale: false,
        itemCount: products.length,
        durationMs: Date.now() - started,
      });
      return { itemCount: products.length, durationMs: Date.now() - started, catalogStale: false };
    } catch (err) {
      saveSettings({
        lastFetchAt: new Date().toISOString(),
        lastFetchStatus: "error",
        lastError: String(err && err.message ? err.message : "XML alınamadı").slice(0, 300),
        catalogStale: previous.length > 0,
        itemCount: previous.length,
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

  function setSettings(patch) {
    const next = Object.assign({}, getSettings());
    if (patch && patch.globalMarginPercent !== undefined) {
      const margin = Number(patch.globalMarginPercent);
      if (!Number.isFinite(margin) || margin < 0 || margin > 500) {
        throw new Error("Kâr oranı 0 ile 500 arasında olmalıdır.");
      }
      next.globalMarginPercent = margin;
    }
    if (patch && patch.criticalStockQty !== undefined) {
      const critical = Number(patch.criticalStockQty);
      if (!Number.isFinite(critical) || critical < 0) {
        throw new Error("Kritik stok 0 veya daha büyük olmalıdır.");
      }
      next.criticalStockQty = Math.floor(critical);
    }
    if (patch && (patch.scheduleStartMinute !== undefined || patch.scheduleStart !== undefined)) {
      const start =
        patch.scheduleStartMinute !== undefined
          ? patch.scheduleStartMinute
          : parseTimeInput(patch.scheduleStart);
      next.scheduleStartMinute = normalizeScheduleConfig({
        scheduleStartMinute: start,
        scheduleIntervalMinutes: next.scheduleIntervalMinutes,
      }).scheduleStartMinute;
    }
    if (patch && patch.scheduleIntervalMinutes !== undefined) {
      next.scheduleIntervalMinutes = normalizeScheduleConfig({
        scheduleStartMinute: next.scheduleStartMinute,
        scheduleIntervalMinutes: patch.scheduleIntervalMinutes,
      }).scheduleIntervalMinutes;
    }
    saveSettings({
      globalMarginPercent: next.globalMarginPercent,
      criticalStockQty: next.criticalStockQty,
      scheduleStartMinute: next.scheduleStartMinute,
      scheduleIntervalMinutes: next.scheduleIntervalMinutes,
    });
    return getSettings();
  }

  function markScheduledFetch(key) {
    return saveSettings({ lastScheduledFetchKey: String(key || "").slice(0, 32) });
  }

  function assignTextOverride(next, key, value, max) {
    if (value === null || value === "") delete next[key];
    else if (value !== undefined) {
      const text = String(value).trim().slice(0, max);
      if (!text) delete next[key];
      else next[key] = text;
    }
  }

  function updateOverrides(updates) {
    const current = getOverrides();
    for (const update of updates || []) {
      const sku = String(update.supplierSku || "").trim().slice(0, 120);
      if (!sku) continue;
      const previous = current[sku] || {};
      const next = Object.assign({}, previous);
      if (typeof update.active === "boolean") next.active = update.active;
      assignTextOverride(next, "siteParent", update.siteParent, 80);
      assignTextOverride(next, "siteChild", update.siteChild, 80);
      if (next.active === true) {
        const cats = loadCategories();
        if (
          !hasSiteCategory(
            { siteParent: next.siteParent, siteChild: next.siteChild },
            cats
          )
        ) {
          if (update.active === true) {
            throw new Error("Site kategorisi seçilmeden ürün yayına alınamaz.");
          }
          next.active = false;
        }
      }
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
      assignTextOverride(next, "category", update.category, 40);
      assignTextOverride(next, "name", update.name, 180);
      assignTextOverride(next, "brand", update.brand, 60);
      assignTextOverride(next, "barcode", update.barcode, 40);
      assignTextOverride(next, "manufacturerCode", update.manufacturerCode, 80);
      assignTextOverride(next, "gtipCode", update.gtipCode, 40);
      assignTextOverride(next, "mainCategory", update.mainCategory, 80);
      assignTextOverride(next, "midCategory", update.midCategory, 80);
      assignTextOverride(next, "subCategory", update.subCategory, 80);
      assignTextOverride(next, "description", update.description, 2000);
      assignTextOverride(next, "details", update.details, 8000);
      assignTextOverride(next, "specialCode", update.specialCode, 40);
      assignTextOverride(next, "currency", update.currency, 8);
      assignTextOverride(next, "unit", update.unit, 20);
      if (update.images !== undefined) {
        if (!Array.isArray(update.images) || !update.images.length) {
          delete next.images;
          if (update.image === undefined) delete next.image;
        } else {
          const list = [];
          const seen = new Set();
          update.images.forEach((raw) => {
            const href = String(raw || "").trim().slice(0, 700);
            if (!href || seen.has(href)) return;
            if (href.startsWith("/assets/img/products/")) {
              seen.add(href);
              list.push(href);
              return;
            }
            if (!/^https?:\/\//i.test(href)) {
              throw new Error("Görsel adresi http(s) veya site görseli olmalıdır.");
            }
            const secure = href.replace(/^http:\/\//i, "https://");
            if (seen.has(secure)) return;
            seen.add(secure);
            list.push(secure);
          });
          if (!list.length) {
            delete next.images;
            if (update.image === undefined) delete next.image;
          } else {
            next.images = list.slice(0, MAX_SUPPLIER_IMAGES);
            next.image = next.images[0];
          }
        }
      } else if (update.image === null || update.image === "") delete next.image;
      else if (update.image !== undefined) {
        const image = String(update.image).trim().slice(0, 700);
        if (!image) delete next.image;
        else if (image.startsWith("/assets/img/products/")) {
          next.image = image;
          next.images = [image];
        } else if (!/^https?:\/\//i.test(image)) {
          throw new Error("Görsel adresi http veya https ile başlamalıdır.");
        } else {
          next.image = image.replace(/^http:\/\//i, "https://");
          next.images = [next.image];
        }
      }
      if (update.vatPercent === null || update.vatPercent === "") delete next.vatPercent;
      else if (update.vatPercent !== undefined) {
        const vat = Number(update.vatPercent);
        if (![1, 8, 10, 20].includes(vat)) {
          throw new Error("KDV oranı 1, 8, 10 veya 20 olmalıdır.");
        }
        next.vatPercent = vat;
      }
      next.updatedAt = new Date().toISOString();
      current[sku] = next;
    }
    atomicWriteJson(files.overrides, current);
    return current;
  }

  function pickOverrideText(override, key, fallback) {
    return override[key] ? String(override[key]).trim() : fallback;
  }

  function listProducts() {
    const settings = getSettings();
    const overrides = getOverrides();
    const cache = getCache();
    const catalogStale =
      Boolean(settings.catalogStale) ||
      (settings.lastFetchStatus === "error" && cache.length > 0);
    const categories = loadCategories();
    return cache.map((item) => {
      const override = overrides[item.supplierSku] || {};
      const marginPercent = Number.isFinite(Number(override.marginPercent))
        ? Number(override.marginPercent)
        : settings.globalMarginPercent;
      const sourceCurrency = normalizeCurrencyCode(
        pickOverrideText(override, "currency", item.currency)
      );
      const rates = readCachedRates(root);
      const costTry = convertCostToTry(item.costPrice, sourceCurrency, rates);
      const fxReady = costTry != null;
      const baseCost = fxReady ? costTry : Number(item.costPrice) || 0;
      const computed = baseCost * (1 + marginPercent / 100);
      const salePrice = Number.isFinite(Number(override.salePrice))
        ? Number(override.salePrice)
        : fxReady
          ? Math.round(computed * 100) / 100
          : 0;
      const images = listedSupplierImages(item, override);
      const listedName = pickOverrideText(override, "name", item.name);
      let description = pickOverrideText(override, "description", item.description);
      if (!override.description && sameProductText(description, listedName)) description = "";
      let details = pickOverrideText(override, "details", item.details || item.description);
      if (!override.details && sameProductText(details, listedName)) details = description;
      const listed = Object.assign({}, item, {
        active: override.active === true,
        marginPercent,
        marginOverride:
          override.marginPercent !== undefined ? Number(override.marginPercent) : null,
        salePriceOverride: override.salePrice !== undefined ? Number(override.salePrice) : null,
        salePrice,
        costPrice: fxReady ? costTry : item.costPrice,
        sourceCostPrice: item.costPrice,
        sourceCurrency,
        fxReady,
        category: pickOverrideText(override, "category", item.category),
        name: listedName,
        nameOverride: override.name ? String(override.name).trim().slice(0, 180) : null,
        brand: pickOverrideText(override, "brand", item.brand),
        barcode: pickOverrideText(override, "barcode", item.barcode),
        manufacturerCode: pickOverrideText(override, "manufacturerCode", item.manufacturerCode),
        gtipCode: pickOverrideText(override, "gtipCode", item.gtipCode),
        mainCategory: decodeXmlEntities(pickOverrideText(override, "mainCategory", item.mainCategory)),
        midCategory: decodeXmlEntities(pickOverrideText(override, "midCategory", item.midCategory)),
        subCategory: decodeXmlEntities(pickOverrideText(override, "subCategory", item.subCategory)),
        description,
        details,
        specialCode: pickOverrideText(override, "specialCode", item.specialCode),
        currency: fxReady ? "TRY" : sourceCurrency,
        unit: pickOverrideText(override, "unit", item.unit),
        image: images[0] || "",
        images,
        vatPercent: override.vatPercent !== undefined ? Number(override.vatPercent) : item.vatPercent,
        criticalStockQty: settings.criticalStockQty,
        catalogStale,
        lastSuccessfulFetchAt: settings.lastSuccessfulFetchAt || null,
        siteParent: pickOverrideText(override, "siteParent", ""),
        siteChild: pickOverrideText(override, "siteChild", ""),
        xmlMainCategory: decodeXmlEntities(item.mainCategory),
        xmlMidCategory: decodeXmlEntities(item.midCategory),
        xmlSubCategory: decodeXmlEntities(item.subCategory),
      });
      const assigned = assignedSiteCategory(listed, categories);
      listed.siteCategoryAssigned = Boolean(assigned);
      listed.siteCategoryLabel = assigned ? assigned.label : "";
      return listed;
    });
  }

  return {
    saveUrl,
    status,
    refresh,
    setGlobalMargin,
    setSettings,
    markScheduledFetch,
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
  decodeXmlBytes,
  decodeXmlEntities,
  validateSupplierUrl,
  isPrivateIp,
  normalizeSupplierFeedUrl,
};
