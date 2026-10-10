#!/usr/bin/env node
"use strict";

/**
 * Spawned by server.js (nice 19) after image mirror runs:
 *   node tools/image-bg/run.js --data-root <dir> --minutes 20
 * Prints one JSON line with the pass result on stdout.
 */
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const sharp = require(path.join(APP_ROOT, "node_modules", "sharp"));
const fs = require("fs");
const { loadMirrorIndex } = require(path.join(APP_ROOT, "lib", "product-image-mirror"));
const { thumbDir, createThumbnail } = require(path.join(APP_ROOT, "lib", "product-thumbnails"));
const bg = require(path.join(APP_ROOT, "lib", "image-background"));

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const dataRoot = path.resolve(arg("data-root", APP_ROOT));
  const minutes = Math.max(1, Number(arg("minutes", 20)) || 20);
  if (!bg.acquireWorkerLock(dataRoot)) {
    console.log(JSON.stringify({ ok: false, busy: true }));
    return;
  }
  const startedAt = new Date().toISOString();
  try {
    sharp.concurrency(1);
    const { removeBackground } = await import("@imgly/background-removal-node");
    const remover = async (png) => {
      const blob = await removeBackground(new Blob([png], { type: "image/png" }), {
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
    bg.recordBackgroundRun(dataRoot, { lastRunAt: startedAt, lastFinishedAt: new Date().toISOString(), lastResult: result });
    console.log(JSON.stringify(Object.assign({ ok: true }, result)));
  } finally {
    bg.releaseWorkerLock(dataRoot);
  }
}

main().catch((err) => {
  console.error("Beyaz zemin aracı durdu:", (err && err.stack) || err);
  console.log(JSON.stringify({ ok: false, error: String((err && err.message) || err).slice(0, 200) }));
  process.exitCode = 1;
});
