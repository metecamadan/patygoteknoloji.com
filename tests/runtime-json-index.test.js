const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createRuntimeJsonIndex } = require("../lib/runtime-json-index");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patygo-rji-"));
}

test("back-to-back writes in one process are read back with a new stamp", () => {
  const root = tempRoot();
  const index = createRuntimeJsonIndex((dataRoot) => path.join(dataRoot, ".runtime", "idx.json"));
  assert.equal(index.read(root).stamp, "0");

  index.update(root, { "a.jpg": { status: "white" } });
  const first = index.read(root).stamp;
  index.update(root, { "a.jpg": { status: "whitened" } });
  const second = index.read(root);

  assert.notEqual(second.stamp, first);
  assert.equal(second.entries["a.jpg"].status, "whitened");
});

test("another process's write within the same clock tick is still picked up", () => {
  const root = tempRoot();
  const file = path.join(root, ".runtime", "idx.json");
  const index = createRuntimeJsonIndex(() => file);
  index.update(root, { "a.jpg": { status: "white" } });
  const before = index.read(root);
  const { mtime } = fs.statSync(file);

  fs.writeFileSync(file, JSON.stringify({ version: 1, meta: {}, entries: { "a.jpg": { status: "rejected", extra: 1 } } }));
  fs.utimesSync(file, mtime, mtime);

  const after = index.read(root);
  assert.equal(after.entries["a.jpg"].status, "rejected");
  assert.notEqual(after.stamp, before.stamp);
});

test("an automatic result never overwrites a panel decision", () => {
  const root = tempRoot();
  const index = createRuntimeJsonIndex((dataRoot) => path.join(dataRoot, "idx.json"));
  index.update(root, { "a.jpg": { status: "rejected", decidedBy: "panel" } }, { lastRun: "x" });
  index.update(root, { "a.jpg": { status: "whitened" }, "b.jpg": { status: "white" } });
  const data = index.read(root);
  assert.equal(data.entries["a.jpg"].decidedBy, "panel");
  assert.equal(data.entries["b.jpg"].status, "white");
  assert.equal(data.meta.lastRun, "x");
});
