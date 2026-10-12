#!/usr/bin/env node
"use strict";

/**
 * nginx keeps /assets/*?v=... in the browser for a year, so a file whose content changes must
 * get a new ?v= label. assets/asset-versions.json remembers each label's content hash; this
 * check fails when a file changed but its label did not, or when pages disagree on the label.
 *   node scripts/asset-versions.js         check (used by tests)
 *   node scripts/asset-versions.js --write record new labels (refuses a changed file with an old label)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "assets", "asset-versions.json");
const REF_PATTERN = /\/assets\/([A-Za-z0-9_./-]+)\?v=([A-Za-z0-9_.-]+)/g;
const SKIP_DIRS = new Set(["node_modules", ".git", ".runtime", "tests", "coverage", "tools"]);

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(path.join(dir, entry.name));
      } else if (/\.(html|js)$/.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(ROOT);
  return out;
}

/** "/assets/x" → Set of ?v= labels and the files that use them. */
function collectReferences() {
  const refs = new Map();
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(REF_PATTERN)) {
      const asset = "/assets/" + match[1];
      if (!refs.has(asset)) refs.set(asset, new Map());
      const labels = refs.get(asset);
      if (!labels.has(match[2])) labels.set(match[2], new Set());
      labels.get(match[2]).add(path.relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
  return refs;
}

/** Line endings differ between a Windows checkout and the server; hash the text with LF. */
function contentHash(asset) {
  const file = path.join(ROOT, asset);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(text).digest("hex");
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8")).files || {};
  } catch (_) {
    return {};
  }
}

function checkAssetVersions(options) {
  const write = Boolean(options && options.write);
  const manifest = loadManifest();
  const next = {};
  const problems = [];
  for (const [asset, labels] of [...collectReferences()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!fs.existsSync(path.join(ROOT, asset))) {
      problems.push(asset + ": dosya yok");
      continue;
    }
    if (labels.size > 1) {
      const detail = [...labels].map(([label, files]) => label + " (" + [...files].join(", ") + ")").join("; ");
      problems.push(asset + ": sayfalar farklı ?v= etiketi kullanıyor: " + detail);
      continue;
    }
    const label = [...labels.keys()][0];
    const sha256 = contentHash(asset);
    const known = manifest[asset];
    if (known && known.v === label && known.sha256 !== sha256) {
      problems.push(asset + ": içerik değişti ama ?v=" + label + " aynı kaldı; etiketi artır");
      continue;
    }
    if (!write && (!known || known.v !== label)) {
      problems.push(asset + ": ?v=" + label + " kayıtlı değil; `node scripts/asset-versions.js --write` çalıştır");
      continue;
    }
    next[asset] = { v: label, sha256 };
  }
  if (write && !problems.length) {
    fs.writeFileSync(MANIFEST, JSON.stringify({ version: 1, files: next }, null, 2) + "\n");
  }
  return { problems, files: next };
}

if (require.main === module) {
  const result = checkAssetVersions({ write: process.argv.includes("--write") });
  if (result.problems.length) {
    console.error(result.problems.join("\n"));
    process.exit(1);
  }
  console.log("asset versions ok (" + Object.keys(result.files).length + " files)");
}

module.exports = { checkAssetVersions, collectReferences };
