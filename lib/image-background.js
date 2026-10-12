"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createRuntimeJsonIndex } = require("./runtime-json-index");
const { mirrorPaths, publicCatalogPath, absoluteImageUrl } = require("./product-image-mirror");
const { collectRawProductImages } = require("./product-images");

/**
 * Supplier photos shot on a black/grey/coloured backdrop get a white-background copy.
 * The mirrored original is never touched: the white copy has its own file name (the
 * 7-day image cache would otherwise keep serving the old one), and the panel can switch
 * any image back to the original.
 *
 * Bump PIPELINE_VERSION when thresholds change so automatic results are re-evaluated;
 * panel decisions are kept regardless of version.
 */
const PIPELINE_VERSION = 2;

const BORDER_SAMPLE = 100;
const BORDER_RING = 6;
/**
 * Share of light (white or pale grey) border pixels from which the backdrop is left alone.
 * Only dark/coloured backdrops are worth the risk: on pale backdrops the model also eats
 * silver and white product parts (a hard drive lost its metal body) for no visible gain.
 */
const LIGHT_BORDER_MIN = 0.5;

const MASK_SIZE = 200;
const MASK_RING = 8;
/**
 * Calibrated on the 80 darkest live images (Oct 2026). A cut-out is used only when it is crisp
 * (few half-transparent pixels), the image edge really was backdrop, the product keeps a sane
 * share of the frame and what got removed looked like the backdrop rather than packaging/text.
 */
const ACCEPT = {
  maxSemi: 0.3,
  minRingBackground: 0.85,
  minForeground: 0.04,
  maxForeground: 0.8,
  // Above ~0.1 the model is eating coloured packaging (a bag's purple top at 0.13), not backdrop.
  maxForeignRemoved: 0.1,
};
const FOREIGN_COLOR_DISTANCE = 60;
const WHITE_JPEG_QUALITY = 88;
const SAVE_EVERY = 20;
/** A broken model fails every image; stop the pass instead of filling the index with errors. */
const MAX_CONSECUTIVE_FAILURES = 5;

function backgroundPaths(dataRoot) {
  const runtime = path.join(dataRoot, ".runtime");
  return {
    indexFile: path.join(runtime, "catalog-image-background.json"),
    lockFile: path.join(runtime, "image-background.lock"),
    priorityFile: path.join(runtime, "image-background-priority.json"),
  };
}

const backgroundIndex = createRuntimeJsonIndex((dataRoot) => backgroundPaths(dataRoot).indexFile);
const readIndexFile = backgroundIndex.read;

function loadBackgroundIndex(dataRoot) {
  return readIndexFile(dataRoot).entries;
}

function backgroundIndexStamp(dataRoot) {
  return readIndexFile(dataRoot).stamp;
}

function updateBackgroundIndex(dataRoot, patch, meta) {
  return backgroundIndex.update(dataRoot, patch, meta);
}

function whiteFileFor(file) {
  return crypto.createHash("sha256").update("white-bg:" + String(file)).digest("hex").slice(0, 28) + ".jpg";
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isNearWhite(r, g, b) {
  return luminance(r, g, b) >= 235 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;
}

function isLight(r, g, b) {
  return luminance(r, g, b) >= 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;
}

function inRing(x, y, size, ring) {
  return x < ring || y < ring || x >= size - ring || y >= size - ring;
}

async function borderProfile(sharp, input) {
  const size = BORDER_SAMPLE;
  const { data } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(size, size, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let total = 0;
  let white = 0;
  let light = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRing(x, y, size, BORDER_RING)) continue;
      const i = (y * size + x) * 3;
      total += 1;
      if (isNearWhite(data[i], data[i + 1], data[i + 2])) white += 1;
      if (isLight(data[i], data[i + 1], data[i + 2])) light += 1;
    }
  }
  return { white: total ? white / total : 1, light: total ? light / total : 1 };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1] || 0;
}

/** Quality of a cut-out: `original` is the source image, `cutout` the PNG with alpha. */
async function cutoutMetrics(sharp, original, cutout) {
  const size = MASK_SIZE;
  const alpha = (
    await sharp(cutout).ensureAlpha().extractChannel(3).resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true })
  ).data;
  const rgb = (
    await sharp(original, { failOn: "none" })
      .rotate()
      .resize(size, size, { fit: "fill" })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  ).data;
  const ringR = [];
  const ringG = [];
  const ringB = [];
  let foreground = 0;
  let visible = 0;
  let semi = 0;
  let ring = 0;
  let ringBackground = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      const a = alpha[p];
      if (a > 25) visible += 1;
      if (a > 25 && a < 230) semi += 1;
      if (a >= 128) foreground += 1;
      if (inRing(x, y, size, MASK_RING)) {
        ring += 1;
        if (a < 25) ringBackground += 1;
        ringR.push(rgb[p * 3]);
        ringG.push(rgb[p * 3 + 1]);
        ringB.push(rgb[p * 3 + 2]);
      }
    }
  }
  const backdrop = [median(ringR), median(ringG), median(ringB)];
  let removed = 0;
  let foreign = 0;
  for (let p = 0; p < size * size; p++) {
    if (alpha[p] >= 25) continue;
    const r = rgb[p * 3];
    const g = rgb[p * 3 + 1];
    const b = rgb[p * 3 + 2];
    if (isNearWhite(r, g, b)) continue;
    removed += 1;
    if (Math.hypot(r - backdrop[0], g - backdrop[1], b - backdrop[2]) > FOREIGN_COLOR_DISTANCE) foreign += 1;
  }
  const round = (value) => Math.round(value * 1000) / 1000;
  return {
    semi: round(visible ? semi / visible : 1),
    ringBackground: round(ring ? ringBackground / ring : 0),
    foreground: round(foreground / (size * size)),
    foreignRemoved: round(removed ? foreign / removed : 0),
  };
}

function acceptCutout(metrics) {
  const m = metrics || {};
  return (
    Number(m.semi) <= ACCEPT.maxSemi &&
    Number(m.ringBackground) >= ACCEPT.minRingBackground &&
    Number(m.foreground) >= ACCEPT.minForeground &&
    Number(m.foreground) <= ACCEPT.maxForeground &&
    Number(m.foreignRemoved) <= ACCEPT.maxForeignRemoved
  );
}

async function writeWhiteImage(sharp, cutout, destPath) {
  const temp = destPath + ".part";
  try {
    await sharp(cutout).flatten({ background: "#ffffff" }).jpeg({ quality: WHITE_JPEG_QUALITY }).toFile(temp);
    fs.renameSync(temp, destPath);
  } catch (err) {
    try {
      fs.unlinkSync(temp);
    } catch (_) {}
    throw err;
  }
}

function readPriority(dataRoot) {
  try {
    const list = JSON.parse(fs.readFileSync(backgroundPaths(dataRoot).priorityFile, "utf8"));
    return Array.isArray(list) ? list.map(String) : [];
  } catch (_) {
    return [];
  }
}

/** Mirror files to look at: storefront card images first, then the rest of the galleries. */
function orderedMirrorFiles(mirrorIndex, priority) {
  const all = new Set();
  for (const entry of Object.values(mirrorIndex || {})) {
    if (!entry || !entry.file || entry.placeholder === true) continue;
    all.add(entry.file);
  }
  const ordered = [];
  for (const file of priority || []) {
    if (all.has(file) && !ordered.includes(file)) ordered.push(file);
  }
  const first = new Set(ordered);
  for (const file of all) if (!first.has(file)) ordered.push(file);
  return ordered;
}

function needsProcessing(entry) {
  if (!entry) return true;
  if (entry.decidedBy === "panel") return false;
  // Failed images are tried again on the next pass (each pass builds its list once).
  return entry.status === "error" || entry.version !== PIPELINE_VERSION;
}

/**
 * One worker pass. `removeBackground(pngBuffer) → Promise<pngBufferWithAlpha>` is injected
 * (the ONNX model only lives in tools/image-bg). Stops at `deadline` and reports what is left.
 */
async function processBackgrounds(options) {
  const settings = options || {};
  const { dataRoot, sharp, removeBackground } = settings;
  const now = typeof settings.now === "function" ? settings.now : () => Date.now();
  const log = typeof settings.log === "function" ? settings.log : () => {};
  const { mediaDir } = mirrorPaths(dataRoot);
  const known = loadBackgroundIndex(dataRoot);
  const files = orderedMirrorFiles(settings.mirrorIndex, settings.priority || readPriority(dataRoot)).filter((file) =>
    needsProcessing(known[file])
  );
  const counts = { checked: 0, white: 0, whitened: 0, rejected: 0, failed: 0, remaining: 0 };
  let patch = {};
  let consecutiveFailures = 0;
  const flush = () => {
    if (!Object.keys(patch).length) return;
    updateBackgroundIndex(dataRoot, patch);
    patch = {};
  };
  for (let i = 0; i < files.length; i++) {
    if (settings.deadline && now() > settings.deadline) {
      counts.remaining = files.length - i;
      break;
    }
    const file = files[i];
    const source = path.join(mediaDir, file);
    if (!fs.existsSync(source)) continue;
    const at = new Date(now()).toISOString();
    try {
      const border = await borderProfile(sharp, source);
      const borderWhite = Math.round(border.white * 1000) / 1000;
      const borderLight = Math.round(border.light * 1000) / 1000;
      if (border.light >= LIGHT_BORDER_MIN) {
        patch[file] = { status: "white", version: PIPELINE_VERSION, at, borderWhite, borderLight };
        counts.white += 1;
      } else {
        const png = await sharp(source, { failOn: "none" }).rotate().png().toBuffer();
        const cutout = await removeBackground(png);
        const metrics = await cutoutMetrics(sharp, png, cutout);
        const whiteFile = whiteFileFor(file);
        // Rejected cut-outs are kept as a preview so the panel can still choose them.
        await writeWhiteImage(sharp, cutout, path.join(mediaDir, whiteFile));
        if (typeof settings.onWhiteFile === "function") {
          try {
            await settings.onWhiteFile(path.join(mediaDir, whiteFile), whiteFile);
          } catch (err) {
            log("Beyaz zemin küçük görseli üretilemedi", whiteFile, err.message || err);
          }
        }
        const accepted = acceptCutout(metrics);
        patch[file] = {
          status: accepted ? "whitened" : "rejected",
          version: PIPELINE_VERSION,
          at,
          borderWhite,
          borderLight,
          whiteFile,
          metrics,
        };
        counts[accepted ? "whitened" : "rejected"] += 1;
      }
      consecutiveFailures = 0;
    } catch (err) {
      const message = String(err.message || err).slice(0, 200);
      patch[file] = { status: "error", version: PIPELINE_VERSION, at, error: message };
      counts.failed += 1;
      consecutiveFailures += 1;
      log("Beyaz zemin işlenemedi", file, message);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        flush();
        throw new Error("Arka plan modeli üst üste " + consecutiveFailures + " görselde hata verdi: " + message);
      }
    }
    counts.checked += 1;
    if (counts.checked % SAVE_EVERY === 0) flush();
    await new Promise((resolve) => setImmediate(resolve));
  }
  flush();
  return counts;
}

/** Panel choice for one mirrored image: "original" or "white". */
function setBackgroundDecision(dataRoot, file, use) {
  const entries = loadBackgroundIndex(dataRoot);
  const entry = entries[file];
  if (!entry) return { ok: false, error: "Görsel bulunamadı." };
  if (use === "white") {
    if (!entry.whiteFile || !fs.existsSync(path.join(mirrorPaths(dataRoot).mediaDir, entry.whiteFile))) {
      return { ok: false, error: "Bu görselin beyaz zeminli sürümü yok." };
    }
  } else if (use !== "original") {
    return { ok: false, error: "Geçersiz seçim." };
  }
  const next = Object.assign({}, entry, {
    status: use === "white" ? "whitened" : "reverted",
    decidedBy: "panel",
    decidedAt: new Date().toISOString(),
  });
  updateBackgroundIndex(dataRoot, { [file]: next });
  return { ok: true, entry: next };
}

let overlayMemo = { mirrorIndex: null, stamp: -1, dataRoot: "", result: null };

/**
 * Mirror index as the storefront and Akakçe should see it: whitened images point at their
 * white copy. Never save this object back as the mirror index.
 */
function storefrontMirrorIndex(dataRoot, mirrorIndex) {
  const stamp = backgroundIndexStamp(dataRoot);
  if (overlayMemo.result && overlayMemo.mirrorIndex === mirrorIndex && overlayMemo.stamp === stamp && overlayMemo.dataRoot === dataRoot) {
    return overlayMemo.result;
  }
  const entries = loadBackgroundIndex(dataRoot);
  const { mediaDir } = mirrorPaths(dataRoot);
  let result = mirrorIndex;
  if (mirrorIndex && Object.keys(entries).length) {
    const out = {};
    let changed = false;
    for (const [url, entry] of Object.entries(mirrorIndex)) {
      const bg = entry && entry.file ? entries[entry.file] : null;
      if (bg && bg.status === "whitened" && bg.whiteFile && fs.existsSync(path.join(mediaDir, bg.whiteFile))) {
        out[url] = Object.assign({}, entry, {
          file: bg.whiteFile,
          publicPath: publicCatalogPath(bg.whiteFile),
          originalFile: entry.file,
          placeholder: false,
        });
        changed = true;
      } else {
        out[url] = entry;
      }
    }
    if (changed) result = out;
  }
  overlayMemo = { mirrorIndex, stamp, dataRoot, result };
  return result;
}

/** Mirror file names per product image, in gallery order (index 0 is the card image). */
function productMirrorFiles(product, mirrorIndex, siteBaseUrl) {
  const files = [];
  for (const raw of collectRawProductImages(product, 10)) {
    const abs = absoluteImageUrl(raw, siteBaseUrl);
    const entry = abs && mirrorIndex ? mirrorIndex[abs] : null;
    if (entry && entry.file && !files.includes(entry.file)) files.push(entry.file);
  }
  return files;
}

function cardImageFiles(products, mirrorIndex, siteBaseUrl) {
  const out = [];
  const seen = new Set();
  for (const product of products || []) {
    const file = productMirrorFiles(product, mirrorIndex, siteBaseUrl)[0];
    if (file && !seen.has(file)) {
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

function productsByImageFile(products, mirrorIndex, siteBaseUrl) {
  const map = new Map();
  for (const product of products || []) {
    for (const file of productMirrorFiles(product, mirrorIndex, siteBaseUrl)) {
      if (!map.has(file)) map.set(file, []);
      map.get(file).push(product);
    }
  }
  return map;
}

function backgroundCounts(dataRoot) {
  const counts = { white: 0, whitened: 0, rejected: 0, reverted: 0, error: 0 };
  for (const entry of Object.values(loadBackgroundIndex(dataRoot))) {
    if (entry && Object.prototype.hasOwnProperty.call(counts, entry.status)) counts[entry.status] += 1;
  }
  return counts;
}

function backgroundMeta(dataRoot) {
  return readIndexFile(dataRoot).meta;
}

function recordBackgroundRun(dataRoot, meta) {
  updateBackgroundIndex(dataRoot, {}, meta);
}

/** Single worker at a time, also across a PM2 restart (stale pid files are taken over). */
function acquireWorkerLock(dataRoot) {
  const { lockFile } = backgroundPaths(dataRoot);
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    const pid = Number(fs.readFileSync(lockFile, "utf8"));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false;
      } catch (_) {}
    }
  } catch (_) {}
  fs.writeFileSync(lockFile, String(process.pid));
  return true;
}

function releaseWorkerLock(dataRoot) {
  const { lockFile } = backgroundPaths(dataRoot);
  try {
    if (Number(fs.readFileSync(lockFile, "utf8")) === process.pid) fs.unlinkSync(lockFile);
  } catch (_) {}
}

module.exports = {
  PIPELINE_VERSION,
  ACCEPT,
  LIGHT_BORDER_MIN,
  backgroundPaths,
  loadBackgroundIndex,
  backgroundIndexStamp,
  updateBackgroundIndex,
  whiteFileFor,
  borderProfile,
  cutoutMetrics,
  acceptCutout,
  orderedMirrorFiles,
  processBackgrounds,
  setBackgroundDecision,
  storefrontMirrorIndex,
  productMirrorFiles,
  cardImageFiles,
  productsByImageFile,
  backgroundCounts,
  backgroundMeta,
  recordBackgroundRun,
  acquireWorkerLock,
  releaseWorkerLock,
};
