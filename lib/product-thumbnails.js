"use strict";

const fs = require("fs");
const path = require("path");
const { mirrorPaths } = require("./product-image-mirror");

/** Card/list previews: mirrored `/media/catalog/<key>.<ext>` → `/media/catalog/thumb/<key>.webp`. */
const THUMB_SIZE = 400;
const THUMB_QUALITY = 78;
const MIRROR_FILE_RE = /\/media\/catalog\/([a-f0-9]{28})\.(?:jpe?g|png|webp|gif)$/i;

let sharpModule;
function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = require("sharp");
    sharpModule.concurrency(1);
  } catch (_) {
    sharpModule = null;
  }
  return sharpModule;
}

function thumbDir(dataRoot) {
  return path.join(mirrorPaths(dataRoot).mediaDir, "thumb");
}

let thumbSetMemo = { dir: "", mtime: 0, files: null, checkedAt: 0 };
const THUMB_SET_RECHECK_MS = 2000;

/** Directory listing memoised on mtime (new files bump it), so per-product lookups stay O(1). */
function thumbnailSet(dataRoot) {
  if (!dataRoot) return null;
  const dir = thumbDir(dataRoot);
  const now = Date.now();
  if (thumbSetMemo.files && thumbSetMemo.dir === dir && now - thumbSetMemo.checkedAt < THUMB_SET_RECHECK_MS) {
    return thumbSetMemo.files;
  }
  let mtime = 0;
  try {
    mtime = fs.statSync(dir).mtimeMs;
  } catch (_) {
    return null;
  }
  if (thumbSetMemo.files && thumbSetMemo.dir === dir && thumbSetMemo.mtime === mtime) {
    thumbSetMemo.checkedAt = now;
    return thumbSetMemo.files;
  }
  let files;
  try {
    files = new Set(fs.readdirSync(dir).filter((name) => name.endsWith(".webp")));
  } catch (_) {
    return null;
  }
  thumbSetMemo = { dir, mtime, files, checkedAt: now };
  return files;
}

function thumbUrlFor(imageUrl, dataRoot) {
  const url = String(imageUrl || "");
  const m = url.match(MIRROR_FILE_RE);
  if (!m) return "";
  const files = thumbnailSet(dataRoot);
  const name = m[1].toLowerCase() + ".webp";
  if (!files || !files.has(name)) return "";
  return url.replace(MIRROR_FILE_RE, "/media/catalog/thumb/" + name);
}

async function createThumbnail(sharp, sourcePath, destPath) {
  const temp = destPath + ".part";
  try {
    await sharp(sourcePath, { failOn: "none" })
      .rotate()
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .webp({ quality: THUMB_QUALITY })
      .toFile(temp);
    fs.renameSync(temp, destPath);
  } catch (err) {
    try {
      fs.unlinkSync(temp);
    } catch (_) {}
    throw err;
  }
}

/**
 * Creates missing previews for every usable mirror entry. Runs one image at a time and yields
 * between files so the storefront stays responsive during the first backfill.
 */
async function generateMissingThumbnails(dataRoot, mirrorIndex, options) {
  const settings = options || {};
  const sharp = settings.sharp !== undefined ? settings.sharp : loadSharp();
  if (!sharp) return { created: 0, failed: 0, unavailable: true };
  const { mediaDir } = mirrorPaths(dataRoot);
  const dir = thumbDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const existing = new Set(fs.readdirSync(dir));
  const limit = Number(settings.limit) > 0 ? Number(settings.limit) : Infinity;
  let created = 0;
  let failed = 0;
  for (const entry of Object.values(mirrorIndex || {})) {
    if (created >= limit) break;
    if (!entry || !entry.file || entry.placeholder === true) continue;
    const key = path.parse(entry.file).name.toLowerCase();
    if (!/^[a-f0-9]{28}$/.test(key) || existing.has(key + ".webp")) continue;
    const sourcePath = path.join(mediaDir, entry.file);
    if (!fs.existsSync(sourcePath)) continue;
    try {
      await createThumbnail(sharp, sourcePath, path.join(dir, key + ".webp"));
      created += 1;
    } catch (err) {
      failed += 1;
      if (settings.logError) settings.logError(entry.file, err.message || err);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { created, failed, unavailable: false };
}

module.exports = {
  THUMB_SIZE,
  loadSharp,
  thumbDir,
  thumbnailSet,
  thumbUrlFor,
  generateMissingThumbnails,
};
