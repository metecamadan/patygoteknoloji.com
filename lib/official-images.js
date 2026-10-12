"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createRuntimeJsonIndex } = require("./runtime-json-index");
const { mirrorPaths, publicCatalogPath } = require("./product-image-mirror");
const {
  LIGHT_BORDER_MIN,
  borderProfile,
  loadBackgroundIndex,
  backgroundIndexStamp,
  productMirrorFiles,
  storefrontMirrorIndex,
} = require("./image-background");

/**
 * Products whose card image sits on a dark backdrop that could not be whitened get the
 * manufacturer's own picture instead. Sources: the hand-verified list next to this file
 * (barcode must still match) and, when ICECAT_USERNAME is set, Open Icecat by barcode or
 * brand + manufacturer code. The mirrored original stays on disk; the storefront reads an
 * overlay and the panel can switch any image back.
 */
const PIPELINE_VERSION = 1;
const SOURCES_FILE = path.join(__dirname, "official-image-sources.json");
const NOT_FOUND_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_IMAGE_SIDE = 300;
const OUTPUT_MAX_SIDE = 1200;
const JPEG_QUALITY = 88;
const FETCH_TIMEOUT_MS = 20000;
const REQUEST_GAP_MS = 1000;
const SAVE_EVERY = 10;
const USER_AGENT = "PatygoTeknoloji/1.0 (+https://patygoteknoloji.com)";

function officialPaths(dataRoot) {
  return { indexFile: path.join(dataRoot, ".runtime", "catalog-image-official.json") };
}

const officialIndex = createRuntimeJsonIndex((dataRoot) => officialPaths(dataRoot).indexFile);
const readIndexFile = officialIndex.read;

function loadOfficialIndex(dataRoot) {
  return readIndexFile(dataRoot).entries;
}

function officialIndexStamp(dataRoot) {
  return readIndexFile(dataRoot).stamp;
}

function officialMeta(dataRoot) {
  return readIndexFile(dataRoot).meta;
}

function storefrontImageStamp(dataRoot) {
  return backgroundIndexStamp(dataRoot) + ":" + officialIndexStamp(dataRoot);
}

function updateOfficialIndex(dataRoot, patch, meta) {
  return officialIndex.update(dataRoot, patch, meta);
}

function officialFileFor(file, imageUrl) {
  return (
    crypto
      .createHash("sha256")
      .update("official:" + String(file) + "\n" + String(imageUrl))
      .digest("hex")
      .slice(0, 28) + ".jpg"
  );
}

function norm(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr");
}

function productKey(product) {
  return (product.supplierSlot || "supplier-1") + "|" + String(product.supplierSku || "").trim();
}

/** Two products are the same model when brand and manufacturer code agree. */
function modelIdentity(product) {
  return norm(product.brand) + "|" + norm(product.manufacturerCode || product.supplierSku);
}

function cleanBarcode(value) {
  const digits = String(value || "").trim();
  return /^\d{8,14}$/.test(digits) ? digits : "";
}

function loadManualSources(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file || SOURCES_FILE, "utf8"));
    return Array.isArray(raw && raw.products) ? raw.products : [];
  } catch (_) {
    return [];
  }
}

/**
 * One target per dark card image. A picture shared with another model is skipped: the
 * overlay works per image file, so it would show one model's photo on the other.
 */
function officialTargets(options) {
  const { products, mirrorIndex, siteBaseUrl, backgroundEntries } = options;
  const usedBy = new Map();
  const cards = new Map();
  for (const product of products || []) {
    if (!product || !product.supplierSku) continue;
    const files = productMirrorFiles(product, mirrorIndex, siteBaseUrl);
    files.forEach((file, i) => {
      if (!usedBy.has(file)) usedBy.set(file, new Set());
      usedBy.get(file).add(modelIdentity(product));
      if (i !== 0) return;
      const bg = backgroundEntries[file];
      if (!bg || bg.status !== "rejected") return;
      if (!cards.has(file)) cards.set(file, product);
    });
  }
  const targets = [];
  for (const [file, product] of cards) {
    targets.push({ file, product, shared: usedBy.get(file).size > 1 });
  }
  return targets;
}

function manualCandidate(product, manualSources) {
  const sku = String(product.supplierSku || "").trim();
  const row = manualSources.find(
    (item) => item && String(item.supplierSku || "").trim() === sku && (item.supplierSlot || "supplier-1") === (product.supplierSlot || "supplier-1")
  );
  if (!row || !row.imageUrl) return null;
  const listed = cleanBarcode(row.barcode);
  // The supplier may reuse a code for another item; a changed barcode means the check no longer holds.
  if (listed && cleanBarcode(product.barcode) && listed !== cleanBarcode(product.barcode)) return null;
  return { source: "manufacturer", imageUrl: String(row.imageUrl), pageUrl: String(row.pageUrl || "") };
}

function pickIcecatImage(gallery) {
  const list = (Array.isArray(gallery) ? gallery : []).filter((item) => item && (item.Pic || item.Pic500x500));
  if (!list.length) return "";
  const main = list.find((item) => String(item.IsMain || "").toUpperCase() === "Y") || list[0];
  return String(main.Pic || main.Pic500x500);
}

/** Open Icecat lookup: barcode first, then brand + manufacturer code. */
function icecatSource(settings) {
  const username = String((settings && settings.username) || "").trim();
  const fetchImpl = settings.fetch;
  return async function lookup(product) {
    const tries = [];
    const ean = cleanBarcode(product.barcode);
    if (ean) tries.push({ GTIN: ean });
    if (product.brand && product.manufacturerCode) {
      tries.push({ Brand: String(product.brand).trim(), ProductCode: String(product.manufacturerCode).trim() });
    }
    for (const params of tries) {
      const qs = new URLSearchParams(Object.assign({ lang: "EN", shopname: username, content: "gallery" }, params));
      const res = await fetchImpl("https://live.icecat.biz/api?" + qs.toString(), {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      await settings.pause();
      if (!res.ok && res.status !== 404) {
        if (res.status === 401 || res.status === 403) throw new Error("Icecat erişimi reddedildi (" + res.status + ")");
        continue;
      }
      const body = await res.json().catch(() => null);
      const data = body && body.data;
      const imageUrl = pickIcecatImage(data && data.Gallery);
      if (imageUrl) {
        const id = data.GeneralInfo && data.GeneralInfo.IcecatId;
        return { source: "icecat", imageUrl, pageUrl: id ? "https://icecat.biz/p/product/" + id : "" };
      }
    }
    return null;
  };
}

async function downloadImage(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": USER_AGENT, accept: "image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("Görsel indirilemedi (HTTP " + res.status + ")");
  const type = String(res.headers.get("content-type") || "");
  if (!/^image\//i.test(type)) throw new Error("Adres görsel döndürmedi (" + (type || "tür yok") + ")");
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("Görsel çok büyük");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Görsel çok büyük");
  return buf;
}

/** Transparent manufacturer PNGs are flattened on white; a dark picture is no improvement. */
async function writeOfficialImage(sharp, input, target) {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  if (Math.min(Number(meta.width) || 0, Number(meta.height) || 0) < MIN_IMAGE_SIDE) {
    throw new Error("Resmî görsel çok küçük");
  }
  const jpeg = await sharp(input, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(OUTPUT_MAX_SIDE, OUTPUT_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  const border = await borderProfile(sharp, jpeg);
  if (border.light < LIGHT_BORDER_MIN) throw new Error("Resmî görselin zemini de koyu");
  const tmp = target + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, jpeg);
  fs.renameSync(tmp, target);
}

function needsLookup(entry, target, manual, now) {
  if (!entry) return true;
  if (entry.decidedBy === "panel") return false;
  if (entry.version !== PIPELINE_VERSION) return true;
  if (entry.productKey !== productKey(target.product)) return true;
  if (manual && entry.imageUrl !== manual.imageUrl) return true;
  if (entry.status === "applied") return false;
  if (entry.status === "skipped") return !target.shared;
  return now - Date.parse(entry.checkedAt || entry.at || 0) >= NOT_FOUND_RETRY_MS;
}

/**
 * Looks up and stores manufacturer pictures for dark card images.
 * Returns { checked, applied, notFound, skipped, failed, remaining }.
 */
async function processOfficialImages(options) {
  const settings = options || {};
  const dataRoot = settings.dataRoot;
  const sharp = settings.sharp;
  const fetchImpl = settings.fetch;
  const now = typeof settings.now === "function" ? settings.now : Date.now;
  const log = typeof settings.log === "function" ? settings.log : () => {};
  const pause =
    typeof settings.pause === "function" ? settings.pause : () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  const manualSources = Array.isArray(settings.manualSources) ? settings.manualSources : loadManualSources();
  const icecat = settings.icecatUsername ? icecatSource({ username: settings.icecatUsername, fetch: fetchImpl, pause }) : null;
  const { mediaDir } = mirrorPaths(dataRoot);
  fs.mkdirSync(mediaDir, { recursive: true });

  const entries = loadOfficialIndex(dataRoot);
  const targets = officialTargets({
    products: settings.products,
    mirrorIndex: settings.mirrorIndex,
    siteBaseUrl: settings.siteBaseUrl,
    backgroundEntries: loadBackgroundIndex(dataRoot),
  });
  const counts = { checked: 0, applied: 0, notFound: 0, skipped: 0, failed: 0, remaining: 0 };
  const todo = targets.filter((target) =>
    needsLookup(entries[target.file], target, manualCandidate(target.product, manualSources), now())
  );
  let patch = {};
  const flush = () => {
    if (!Object.keys(patch).length) return;
    updateOfficialIndex(dataRoot, patch);
    patch = {};
  };
  for (let i = 0; i < todo.length; i++) {
    if (settings.deadline && now() > settings.deadline) {
      counts.remaining = todo.length - i;
      break;
    }
    const { file, product, shared } = todo[i];
    const at = new Date(now()).toISOString();
    const base = {
      version: PIPELINE_VERSION,
      productKey: productKey(product),
      brand: String(product.brand || ""),
      manufacturerCode: String(product.manufacturerCode || ""),
      barcode: cleanBarcode(product.barcode),
      checkedAt: at,
    };
    counts.checked += 1;
    if (shared) {
      patch[file] = Object.assign(base, { status: "skipped", at, note: "Görsel başka bir modelle ortak" });
      counts.skipped += 1;
      continue;
    }
    try {
      let candidate = manualCandidate(product, manualSources);
      if (!candidate && icecat) candidate = await icecat(product);
      if (!candidate) {
        patch[file] = Object.assign(base, { status: "notfound", at });
        counts.notFound += 1;
      } else {
        const officialFile = officialFileFor(file, candidate.imageUrl);
        const target = path.join(mediaDir, officialFile);
        if (!fs.existsSync(target)) {
          const buf = await downloadImage(fetchImpl, candidate.imageUrl);
          await pause();
          await writeOfficialImage(sharp, buf, target);
          if (typeof settings.onOfficialFile === "function") {
            try {
              await settings.onOfficialFile(target, officialFile);
            } catch (err) {
              log("Resmî görselin küçük kopyası üretilemedi", officialFile, err.message || err);
            }
          }
        }
        patch[file] = Object.assign(base, {
          status: "applied",
          at,
          source: candidate.source,
          imageUrl: candidate.imageUrl,
          pageUrl: candidate.pageUrl,
          officialFile,
        });
        counts.applied += 1;
      }
    } catch (err) {
      const message = String(err.message || err).slice(0, 200);
      patch[file] = Object.assign(base, { status: "error", at, error: message });
      counts.failed += 1;
      log("Resmî görsel alınamadı", file, message);
    }
    if (counts.checked % SAVE_EVERY === 0) flush();
  }
  flush();
  return counts;
}

let overlayMemo = { input: null, stamp: -1, dataRoot: "", result: null };

/** Mirror index with official pictures swapped in over dark originals. Never save it back. */
function officialMirrorIndex(dataRoot, mirrorIndex) {
  const stamp = storefrontImageStamp(dataRoot);
  if (overlayMemo.result && overlayMemo.input === mirrorIndex && overlayMemo.stamp === stamp && overlayMemo.dataRoot === dataRoot) {
    return overlayMemo.result;
  }
  const entries = loadOfficialIndex(dataRoot);
  const backgroundEntries = loadBackgroundIndex(dataRoot);
  const { mediaDir } = mirrorPaths(dataRoot);
  const usable = new Map();
  for (const [file, entry] of Object.entries(entries)) {
    if (!entry || entry.status !== "applied" || !entry.officialFile) continue;
    // An explicit white/original choice in the white-background list stands.
    const bg = backgroundEntries[file];
    if (bg && bg.decidedBy === "panel" && entry.decidedBy !== "panel") continue;
    if (fs.existsSync(path.join(mediaDir, entry.officialFile))) usable.set(file, entry.officialFile);
  }
  let result = mirrorIndex;
  if (mirrorIndex && usable.size) {
    const out = {};
    let changed = false;
    for (const [url, entry] of Object.entries(mirrorIndex)) {
      const original = entry && (entry.originalFile || entry.file);
      const officialFile = original ? usable.get(original) : "";
      if (officialFile) {
        out[url] = Object.assign({}, entry, {
          file: officialFile,
          publicPath: publicCatalogPath(officialFile),
          originalFile: original,
          placeholder: false,
        });
        changed = true;
      } else {
        out[url] = entry;
      }
    }
    if (changed) result = out;
  }
  overlayMemo = { input: mirrorIndex, stamp, dataRoot, result };
  return result;
}

/** What the storefront, thumbnails and Akakçe read: white copies, then official pictures. */
function storefrontImageIndex(dataRoot, mirrorIndex) {
  return officialMirrorIndex(dataRoot, storefrontMirrorIndex(dataRoot, mirrorIndex));
}

/** Panel choice for one dark image: "original" or "official". */
function setOfficialDecision(dataRoot, file, use) {
  const entry = loadOfficialIndex(dataRoot)[file];
  if (!entry) return { ok: false, error: "Görsel bulunamadı." };
  if (use === "official") {
    if (!entry.officialFile || !fs.existsSync(path.join(mirrorPaths(dataRoot).mediaDir, entry.officialFile))) {
      return { ok: false, error: "Bu ürün için resmî görsel yok." };
    }
  } else if (use !== "original") {
    return { ok: false, error: "Geçersiz seçim." };
  }
  const next = Object.assign({}, entry, {
    status: use === "official" ? "applied" : "reverted",
    decidedBy: "panel",
    decidedAt: new Date().toISOString(),
  });
  updateOfficialIndex(dataRoot, { [file]: next });
  return { ok: true, entry: next };
}

function officialCounts(dataRoot) {
  const counts = { applied: 0, notfound: 0, skipped: 0, reverted: 0, error: 0 };
  for (const entry of Object.values(loadOfficialIndex(dataRoot))) {
    if (entry && Object.prototype.hasOwnProperty.call(counts, entry.status)) counts[entry.status] += 1;
  }
  return counts;
}

function recordOfficialRun(dataRoot, meta) {
  updateOfficialIndex(dataRoot, {}, meta);
}

module.exports = {
  PIPELINE_VERSION,
  SOURCES_FILE,
  officialPaths,
  loadOfficialIndex,
  officialIndexStamp,
  officialMeta,
  updateOfficialIndex,
  officialFileFor,
  loadManualSources,
  officialTargets,
  manualCandidate,
  pickIcecatImage,
  icecatSource,
  processOfficialImages,
  officialMirrorIndex,
  storefrontImageIndex,
  storefrontImageStamp,
  setOfficialDecision,
  officialCounts,
  recordOfficialRun,
};
