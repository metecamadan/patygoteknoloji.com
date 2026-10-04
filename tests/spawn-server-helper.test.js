const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");

test("spawnTestServer seeds data before the server starts and stop() waits for exit", async (t) => {
  const seeded = [];
  const { dataRoot, child, stop } = await spawnTestServer(t, {}, {
    seed: (root) => {
      seeded.push({ root, productsSeeded: fs.existsSync(path.join(root, "assets", "data", "products.json")) });
    },
  });
  assert.deepEqual(seeded, [{ root: dataRoot, productsSeeded: true }]);
  assert.equal(child.exitCode, null);
  await stop();
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await stop();
});

test("server-backed tests touch SQLite only inside seed or after stop()", () => {
  const dir = __dirname;
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".test.js"))) {
    const src = fs.readFileSync(path.join(dir, name), "utf8");
    if (!src.includes("spawnTestServer(")) continue;
    for (const block of src.split(/\ntest\(/).slice(1)) {
      const start = block.indexOf("spawnTestServer(");
      if (start < 0) continue;
      const rest = block.slice(start);
      const callEnd = rest.search(/\n  [^ ]/);
      const live = (callEnd < 0 ? "" : rest.slice(callEnd)).split("await stop()")[0];
      if (/getDb\(dataRoot\)|create(Order|Contact|PriceAlert|Coupon|Review)Store\(dataRoot\)/.test(live)) {
        offenders.push(name + ": " + block.slice(0, 60).split("\n")[0]);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
