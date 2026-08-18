const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const MIRROR_CONCURRENCY = 6;
const LEAK_HOST_PATTERN = /bilgisayarim\.com/i;

function mirrorPaths(dataRoot) {
  const mediaDir = path.join(dataRoot, ".runtime", "media", "catalog");
  const indexFile = path.join(dataRoot, ".runtime", "catalog-image-mirror.json");
  return { mediaDir, indexFile };
}

function loadMirrorIndex(dataRoot) {
  const { indexFile } = mirrorPaths(dataRoot);
  if (!fs.existsSync(indexFile)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    return data && typeof data === "object" && data.entries ? data.entries : data || {};
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
      throw new Error("Görsel indirilemedi (" + response.status + ")");
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
    if (fs.existsSync(path.join(mediaDir, existing.file))) return existing;
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
  const entry = {
    sourceUrl: abs,
    file: fileName,
    publicPath: publicCatalogPath(fileName),
    mirroredAt: new Date().toISOString(),
  };
  index[abs] = entry;
  return entry;
}

function collectProductSourceImages(product, siteBaseUrl) {
  const list = [];
  const push = (value) => {
    const abs = absoluteImageUrl(value, siteBaseUrl);
    if (abs && !list.includes(abs)) list.push(abs);
  };
  if (Array.isArray(product.images)) product.images.forEach(push);
  push(product.image);
  return list;
}

async function mirrorAkakceCatalogImages(products, options) {
  const settings = options || {};
  const dataRoot = settings.dataRoot;
  const siteBaseUrl = settings.siteBaseUrl;
  const fetchImpl = settings.fetchImpl;
  const resolveHost = settings.resolveHost;
  const index = Object.assign({}, loadMirrorIndex(dataRoot));
  const queue = [];
  for (const product of products || []) {
    if (!product || product.active === false) continue;
    for (const sourceUrl of collectProductSourceImages(product, siteBaseUrl)) {
      if (isOwnSiteImage(sourceUrl, siteBaseUrl)) continue;
      if (index[sourceUrl] && index[sourceUrl].publicPath) continue;
      if (!queue.includes(sourceUrl)) queue.push(sourceUrl);
    }
  }
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const i = cursor;
      cursor += 1;
      const sourceUrl = queue[i];
      try {
        await ensureMirrored(sourceUrl, {
          dataRoot,
          siteBaseUrl,
          index,
          fetchImpl,
          resolveHost,
        });
      } catch (err) {
        if (settings.logError) {
          settings.logError("Görsel aynası", sourceUrl.slice(0, 80), err.message || err);
        }
      }
    }
  }
  const workers = Math.min(MIRROR_CONCURRENCY, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  saveMirrorIndex(dataRoot, index);
  return { mirrored: queue.length, index };
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
};
