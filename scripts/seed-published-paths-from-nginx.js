#!/usr/bin/env node
/**
 * Adds product URLs that nginx served with 200 to the published product path list, so links of
 * products removed before the list existed keep redirecting to their category.
 * Usage (on the VPS): node scripts/seed-published-paths-from-nginx.js [/var/log/nginx]
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { createPublishedPaths, productPathsFromAccessLog } = require("../lib/published-paths");

const root = path.resolve(__dirname, "..");
const logDir = process.argv[2] || "/var/log/nginx";
const segmentFile = path.join(root, ".runtime", "product-segment-categories.json");
const segments = new Set(Object.keys(JSON.parse(fs.readFileSync(segmentFile, "utf8"))));

const found = new Set();
const files = fs.readdirSync(logDir).filter((name) => /^access\.log(\.\d+)?(\.gz)?$/.test(name));
for (const name of files) {
  const raw = fs.readFileSync(path.join(logDir, name));
  const text = name.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  productPathsFromAccessLog(text, segments).forEach((value) => found.add(value));
}
const added = createPublishedPaths(root).record([...found]);
console.log(JSON.stringify({ files: files.length, segments: segments.size, found: found.size, added }));
