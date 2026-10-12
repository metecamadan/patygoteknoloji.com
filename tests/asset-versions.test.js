const test = require("node:test");
const assert = require("node:assert/strict");

const { checkAssetVersions, collectReferences } = require("../scripts/asset-versions");

test("every ?v= asset has one label and a new label whenever its content changes (nginx caches them a year)", () => {
  const { problems, files } = checkAssetVersions();
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(Object.keys(files).length >= 15);
  assert.ok(files["/assets/css/style.css"], "vitrin CSS sürümlü olmalı");
  assert.ok(files["/assets/js/admin-panel.js"], "panel JS sürümlü olmalı");
});

test("references are collected from pages and from scripts that load other scripts", () => {
  const refs = collectReferences();
  const panel = refs.get("/assets/js/admin-panel.js");
  assert.ok(panel, "admin-login.js panel JS'ini ?v= ile yükler");
  assert.ok([...panel.values()].some((files) => files.has("assets/js/admin-login.js")));
});
