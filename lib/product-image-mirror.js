const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const MIRROR_CONCURRENCY = 2;
const LEAK_HOST_PATTERN = /bilgisayarim\.com/i;
const KNOWN_PLACEHOLDER_SHA256 = new Set([
  // bilgisayarim.com.tr generic "no product photo" camera glyph
  "69562ec8559651b1c1a7902c7ea6305056bee9379c36a01d14bf46b20c4c9fd9",
]);
const PLACEHOLDER_IMAGE_BYTES = 32448;
const mirrorFileHashMemo = new Map();

function mirrorPaths(dataRoot) {
  const mediaDir = path.join(dataRoot, ".runtime", "media", "catalog");
  const indexFile = path.join(dataRoot, ".runtime", "catalog-image-mirror.json");
  const failuresFile = path.join(dataRoot, ".runtime", "catalog-image-mirror-failures.json");
  return { mediaDir, indexFile, failuresFile };
}

/** Supplier images that answered 404/410 are not re-downloaded on every mirror run. */
const NOT_FOUND_STATUSES = new Set([404, 410]);
const NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

function loadMirrorFailures(dataRoot) {
  const { failuresFile } = mirrorPaths(dataRoot);
  try {
    const data = JSON.parse(fs.readFileSync(failuresFile, "utf8"));
    return data && typeof data.entries === "object" && data.entries ? data.entries : {};
  } catch (_) {
    return {};
  }
}

function saveMirrorFailures(dataRoot, entries) {
  const { failuresFile } = mirrorPaths(dataRoot);
  atomicWriteJson(failuresFile, { version: 1, updatedAt: new Date().toISOString(), entries });
}

let mirrorIndexMemo = { file: "", mtime: 0, entries: null };

function loadMirrorIndex(dataRoot) {
  const { indexFile } = mirrorPaths(dataRoot);
  if (!fs.existsSync(indexFile)) return {};
  try {
    const mtime = fs.statSync(indexFile).mtimeMs;
    if (
      mirrorIndexMemo.entries &&
      mirrorIndexMemo.file === indexFile &&
      mirrorIndexMemo.mtime === mtime
    ) {
      return mirrorIndexMemo.entries;
    }
    const data = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    const entries = data && typeof data === "object" && data.entries ? data.entries : data || {};
    mirrorIndexMemo = { file: indexFile, mtime, entries };
    return entries;
  } catch (_) {
    return {};
  }
}

function saveMirrorIndex(dataRoot, entries) {
  const { indexFile, mediaDir } = mirrorPaths(dataRoot);
  fs.mkdirSync(mediaDir, { recursive: true });
  atomicWriteJson(indexFile, {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  });
  try {
    mirrorIndexMemo = {
      file: indexFile,
      mtime: fs.statSync(indexFile).mtimeMs,
      entries,
    };
  } catch (_) {
    mirrorIndexMemo = { file: "", mtime: 0, entries: null };
  }
}

function siteHostname(siteBaseUrl) {
  try {
    return new URL(String(siteBaseUrl || "").replace(/\/+$/, "") + "/").hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function absoluteImageUrl(value, siteBaseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, String(siteBaseUrl || "").replace(/\/+$/, "") + "/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function isOwnSiteImage(url, siteBaseUrl) {
  const abs = absoluteImageUrl(url, siteBaseUrl);
  if (!abs) return false;
  try {
    return new URL(abs).hostname.toLowerCase() === siteHostname(siteBaseUrl);
  } catch (_) {
    return false;
  }
}

function exposesSupplierHost(url) {
  try {
    return LEAK_HOST_PATTERN.test(new URL(url).hostname);
  } catch (_) {
    return LEAK_HOST_PATTERN.test(String(url || ""));
  }
}

function mirrorKey(sourceUrl) {
  return crypto.createHash("sha256").update(String(sourceUrl)).digest("hex").slice(0, 28);
}

function extensionFrom(sourceUrl, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  const match = String(sourceUrl || "")
    .split("?")[0]
    .match(/\.(jpe?g|png|webp|gif)$/i);
  if (match) return "." + match[1].toLowerCase().replace("jpeg", "jpg");
  return ".jpg";
}

function publicCatalogPath(fileName) {
  return "/media/catalog/" + fileName;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function mirrorFileHash(filePath) {
  const key = String(filePath || "");
  if (!key) return "";
  if (mirrorFileHashMemo.has(key)) return mirrorFileHashMemo.get(key);
  let digest = "";
  try {
    if (fs.existsSync(key)) digest = sha256File(key);
  } catch (_) {
    digest = "";
  }
  mirrorFileHashMemo.set(key, digest);
  return digest;
}

function buildPlaceholderMirrorFileSet(dataRoot, mirrorIndex) {
  const bad = new Set();
  const { mediaDir } = mirrorPaths(dataRoot);
  const entries = Object.values(mirrorIndex || {});
  for (const entry of entries) {
    if (!entry || !entry.file) continue;
    if (entry.placeholder === true) {
      bad.add(entry.file);
      continue;
    }
    if (entry.placeholder === false) continue;
    const filePath = path.join(mediaDir, entry.file);
    try {
      if (!fs.existsSync(filePath)) {
        bad.add(entry.file);
        continue;
      }
      const size = fs.statSync(filePath).size;
      if (size !== PLACEHOLDER_IMAGE_BYTES) continue;
      if (KNOWN_PLACEHOLDER_SHA256.has(mirrorFileHash(filePath))) bad.add(entry.file);
    } catch (_) {
      bad.add(entry.file);
    }
  }
  return bad;
}

let placeholderMirrorCache = { stamp: 0, files: null };

function getCachedPlaceholderMirrorFileSet(dataRoot, mirrorIndex) {
  const { indexFile } = mirrorPaths(dataRoot);
  let stamp = 0;
  try {
    if (fs.existsSync(indexFile)) stamp = fs.statSync(indexFile).mtimeMs;
  } catch (_) {}
  if (placeholderMirrorCache.files && placeholderMirrorCache.stamp === stamp) {
    return placeholderMirrorCache.files;
  }
  const files = buildPlaceholderMirrorFileSet(dataRoot, mirrorIndex);
  placeholderMirrorCache = { stamp, files };
  return files;
}

function isPlaceholderImageFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return true;
    const size = fs.statSync(filePath).size;
    if (size !== PLACEHOLDER_IMAGE_BYTES) return false;
    return KNOWN_PLACEHOLDER_SHA256.has(mirrorFileHash(filePath));
  } catch (_) {
    return true;
  }
}

function mirrorEntryIsUsable(entry, dataRoot, placeholderFiles) {
  if (!entry || !entry.file || !dataRoot) return false;
  if (entry.placeholder === true) return false;
  if (entry.placeholder === false) return true;
  if (placeholderFiles && placeholderFiles.has(entry.file)) return false;
  const filePath = path.join(mirrorPaths(dataRoot).mediaDir, entry.file);
  try {
    if (!fs.existsSync(filePath)) return false;
    const size = fs.statSync(filePath).size;
    if (size !== PLACEHOLDER_IMAGE_BYTES) return true;
    return !KNOWN_PLACEHOLDER_SHA256.has(mirrorFileHash(filePath));
  } catch (_) {
    return false;
  }
}

function resolveFeedImageUrl(raw, siteBaseUrl, mirrorIndex) {
  const abs = absoluteImageUrl(raw, siteBaseUrl);
  if (!abs) return "";
  if (isOwnSiteImage(abs, siteBaseUrl)) return abs;
  const entry = mirrorIndex && mirrorIndex[abs];
  if (entry && entry.publicPath) {
    const base = String(siteBaseUrl || "").replace(/\/+$/, "");
    return base ? base + entry.publicPath : entry.publicPath;
  }
  return "";
}

async function downloadImage(sourceUrl, destPath, options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || fetch;
  const timeoutMs = Number(settings.timeoutMs) || FETCH_TIMEOUT_MS;
  const { assertPublicHttpUrl } = require("./network-guard");
  await assertPublicHttpUrl(sourceUrl, settings.resolveHost);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(sourceUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "Patygo-Catalog-Mirror/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = new Error("Görsel indirilemedi (" + response.status + ")");
      err.status = response.status;
      throw err;
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_IMAGE_BYTES) {
      throw new Error("Görsel boyut sınırını aşıyor");
    }
    const reader = response.body && response.body.getReader();
    if (!reader) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Görsel boyut sınırını aşıyor");
      fs.writeFileSync(destPath, bytes);
      return extensionFrom(sourceUrl, response.headers.get("content-type"));
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Görsel boyut sınırını aşıyor");
      }
      chunks.push(Buffer.from(part.value));
    }
    fs.writeFileSync(destPath, Buffer.concat(chunks));
    return extensionFrom(sourceUrl, response.headers.get("content-type"));
  } finally {
    clearTimeout(timer);
  }
}

async function ensureMirrored(sourceUrl, options) {
  const settings = options || {};
  const dataRoot = settings.dataRoot;
  const siteBaseUrl = settings.siteBaseUrl;
  const index = settings.index || {};
  const fetchImpl = settings.fetchImpl;
  const abs = absoluteImageUrl(sourceUrl, siteBaseUrl);
  if (!abs) return null;
  if (isOwnSiteImage(abs, siteBaseUrl)) {
    return { sourceUrl: abs, publicPath: new URL(abs).pathname, local: false };
  }
  const existing = index[abs];
  if (existing && existing.publicPath && existing.file) {
    const { mediaDir } = mirrorPaths(dataRoot);
    const existingPath = path.join(mediaDir, existing.file);
    if (fs.existsSync(existingPath) && !isPlaceholderImageFile(existingPath)) return existing;
  }
  const { mediaDir } = mirrorPaths(dataRoot);
  fs.mkdirSync(mediaDir, { recursive: true });
  const key = mirrorKey(abs);
  const tempPath = path.join(mediaDir, key + ".part");
  let ext = extensionFrom(abs, "");
  try {
    ext = await downloadImage(abs, tempPath, {
      fetchImpl,
      resolveHost: settings.resolveHost,
    });
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    throw err;
  }
  const fileName = key + ext;
  const finalPath = path.join(mediaDir, fileName);
  fs.renameSync(tempPath, finalPath);
  if (isPlaceholderImageFile(finalPath)) {
    try {
      fs.unlinkSync(finalPath);
    } catch (_) {}
    return null;
  }
  const stat = fs.statSync(finalPath);
  const entry = {
    sourceUrl: abs,
    file: fileName,
    publicPath: publicCatalogPath(fileName),
    mirroredAt: new Date().toISOString(),
    bytes: stat.size,
    placeholder: stat.size === PLACEHOLDER_IMAGE_BYTES,
  };
  index[abs] = entry;
  return entry;
}

/** Same URLs the storefront image gate looks up (thumbnails upgraded to full size). */
function collectProductSourceImages(product, siteBaseUrl) {
  const { collectRawProductImages } = require("./product-images");
  const list = [];
  for (const value of collectRawProductImages(product, 10)) {
    const abs = absoluteImageUrl(value, siteBaseUrl);
    if (abs && !list.includes(abs)) list.push(abs);
  }
  return list;
}

async function mirrorAkakceCatalogImages(products, options) {
  const settings = options || {};
  const dataRoot = settings.dataRoot;
  const siteBaseUrl = settings.siteBaseUrl;
  const fetchImpl = settings.fetchImpl;
  const resolveHost = settings.resolveHost;
  const index = Object.assign({}, loadMirrorIndex(dataRoot));
  const now = Number(settings.now) || Date.now();
  const retryMs = Number.isFinite(Number(settings.notFoundRetryMs))
    ? Number(settings.notFoundRetryMs)
    : NOT_FOUND_RETRY_MS;
  const failures = {};
  for (const [url, failure] of Object.entries(loadMirrorFailures(dataRoot))) {
    const failedAt = Date.parse(failure && failure.failedAt);
    if (Number.isFinite(failedAt) && now - failedAt < retryMs) failures[url] = failure;
  }
  const queue = [];
  const queued = new Set();
  let skippedNotFound = 0;
  for (const product of products || []) {
    if (!product || product.active === false) continue;
    for (const sourceUrl of collectProductSourceImages(product, siteBaseUrl)) {
      if (isOwnSiteImage(sourceUrl, siteBaseUrl)) continue;
      if (index[sourceUrl] && index[sourceUrl].publicPath) continue;
      if (queued.has(sourceUrl)) continue;
      queued.add(sourceUrl);
      if (failures[sourceUrl]) {
        skippedNotFound += 1;
        continue;
      }
      queue.push(sourceUrl);
    }
  }
  if (!queue.length) {
    saveMirrorFailures(dataRoot, failures);
    return { mirrored: 0, index, skipped: true, skippedNotFound };
  }
  let cursor = 0;
  let mirrored = 0;
  async function worker() {
    while (cursor < queue.length) {
      const i = cursor;
      cursor += 1;
      const sourceUrl = queue[i];
      try {
        const entry = await ensureMirrored(sourceUrl, {
          dataRoot,
          siteBaseUrl,
          index,
          fetchImpl,
          resolveHost,
        });
        if (entry) mirrored += 1;
      } catch (err) {
        if (err && NOT_FOUND_STATUSES.has(err.status)) {
          failures[sourceUrl] = { status: err.status, failedAt: new Date(now).toISOString() };
        }
        if (settings.logError) {
          settings.logError("Görsel aynası", sourceUrl.slice(0, 80), err.message || err);
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  const workers = Math.min(MIRROR_CONCURRENCY, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  saveMirrorIndex(dataRoot, index);
  saveMirrorFailures(dataRoot, failures);
  return { mirrored, index, skipped: false, skippedNotFound };
}

module.exports = {
  LEAK_HOST_PATTERN,
  mirrorPaths,
  loadMirrorIndex,
  saveMirrorIndex,
  absoluteImageUrl,
  isOwnSiteImage,
  exposesSupplierHost,
  resolveFeedImageUrl,
  ensureMirrored,
  mirrorAkakceCatalogImages,
  publicCatalogPath,
  isPlaceholderImageFile,
  mirrorEntryIsUsable,
  buildPlaceholderMirrorFileSet,
  getCachedPlaceholderMirrorFileSet,
  KNOWN_PLACEHOLDER_SHA256,
};
