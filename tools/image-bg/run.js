#!/usr/bin/env node
"use strict";

/**
 * Spawned by server.js (nice 19) after image mirror runs:
 *   node tools/image-bg/run.js --data-root <dir> --minutes 20
 * Prints one JSON line with the pass result on stdout.
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const sharp = require(path.join(APP_ROOT, "node_modules", "sharp"));
const { loadMirrorIndex } = require(path.join(APP_ROOT, "lib", "product-image-mirror"));
const { thumbDir, createThumbnail } = require(path.join(APP_ROOT, "lib", "product-thumbnails"));
const bg = require(path.join(APP_ROOT, "lib", "image-background"));

// The library looks for its model files under process.cwd() unless told otherwise; the server
// starts this worker from the app root, where they do not exist.
const MODEL_PUBLIC_PATH = pathToFileURL(path.dirname(require.resolve("@imgly/background-removal-node"))).href + "/";

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(dataRoot) {
  const minutes = Math.max(1, Number(arg("minutes", 20)) || 20);
  const startedAt = new Date().toISOString();
  sharp.concurrency(1);
  const { removeBackground } = await import("@imgly/background-removal-node");
  const remover = async (png) => {
    const blob = await removeBackground(new Blob([png], { type: "image/png" }), {
      publicPath: MODEL_PUBLIC_PATH,
      model: "medium",
      output: { format: "image/png" },
    });
    return Buffer.from(await blob.arrayBuffer());
  };
  const thumbs = thumbDir(dataRoot);
  const result = await bg.processBackgrounds({
    dataRoot,
    sharp,
    removeBackground: remover,
    mirrorIndex: loadMirrorIndex(dataRoot),
    deadline: Date.now() + minutes * 60 * 1000,
    onWhiteFile: async (filePath, fileName) => {
      fs.mkdirSync(thumbs, { recursive: true });
      await createThumbnail(sharp, filePath, path.join(thumbs, path.parse(fileName).name + ".webp"));
    },
    log: (...parts) => console.error(parts.join(" ")),
  });
  bg.recordBackgroundRun(dataRoot, {
    lastRunAt: startedAt,
    lastFinishedAt: new Date().toISOString(),
    lastResult: result,
    lastError: "",
  });
  return result;
}

const dataRoot = path.resolve(arg("data-root", APP_ROOT));
if (!bg.acquireWorkerLock(dataRoot)) {
  console.log(JSON.stringify({ ok: false, busy: true }));
} else {
  main(dataRoot)
    .then((result) => console.log(JSON.stringify(Object.assign({ ok: true }, result))))
    .catch((err) => {
      const message = String((err && err.message) || err).slice(0, 300);
      console.error("Beyaz zemin aracı durdu:", (err && err.stack) || err);
      try {
        bg.recordBackgroundRun(dataRoot, { lastFailedAt: new Date().toISOString(), lastError: message });
      } catch (_) {}
      console.log(JSON.stringify({ ok: false, error: message }));
      process.exitCode = 1;
    })
    .finally(() => bg.releaseWorkerLock(dataRoot));
}
