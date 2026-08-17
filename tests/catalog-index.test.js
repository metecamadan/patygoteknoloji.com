const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { queryPublicCatalog, buildStorefrontIndex, queryPublicCatalogIndexed } = require("../lib/catalog");

const sample = [
  {
    id: "p1",
    brand: "HP",
    name: "Notebook A",
    price: 1000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteMid: "notebooklar",
    siteChild: "nb-a",
    active: true,
  },
  {
    id: "p2",
    brand: "Lenovo",
    name: "Notebook B",
    price: 2000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteMid: "notebooklar",
    siteChild: "nb-b",
    active: true,
  },
  {
    id: "p3",
    brand: "Canon",
    name: "Toner",
    price: 500,
    vatPercent: 20,
    category: "kartus-toner",
    siteMid: "toner",
    siteChild: "toner-a",
    active: true,
  },
];

test("indexed catalog query matches full scan for category listing", () => {
  const index = buildStorefrontIndex(sample);
  assert.equal(index.compactAll.length, 3);
  assert.equal(index.byParent["bilgisayar-tablet"].length, 2);

  const cases = [
    { page: 1, limit: 48 },
    { kategori: "bilgisayar-tablet", page: 1, limit: 20 },
    { kategori: "bilgisayar-tablet", ara: "notebooklar", page: 1, limit: 20 },
    { marka: "HP", page: 1, limit: 48 },
  ];
  cases.forEach((params) => {
    const full = queryPublicCatalog(sample, params);
    const indexed = queryPublicCatalogIndexed(index, params);
    assert.equal(indexed.total, full.total, JSON.stringify(params));
    assert.deepEqual(
      indexed.products.map((item) => item.id),
      full.products.map((item) => item.id)
    );
  });
});

test("buildStorefrontIndex stores compact list with limited images", () => {
  const index = buildStorefrontIndex(sample);
  assert.ok(index.compactAll.every((item) => Array.isArray(item.images) && item.images.length <= 2));
});

test("listing snapshots cover parent mid and child keys", () => {
  const { listingSnapshotFileName, listingSnapshotJobs, buildStorefrontIndex } = require("../lib/catalog");
  assert.equal(listingSnapshotFileName({}), "all.json");
  assert.equal(
    listingSnapshotFileName({
      kategori: "bilgisayar-tablet",
      ara: "klavye-mouse-urunleri",
      alt: "klavye-ve-mouse",
    }),
    "bilgisayar-tablet__klavye-mouse-urunleri__klavye-ve-mouse.json"
  );
  const index = buildStorefrontIndex(sample);
  const files = listingSnapshotJobs(index).map((job) => job.file);
  assert.ok(files.includes("all.json"));
  assert.ok(files.includes("bilgisayar-tablet.json"));
  assert.ok(files.includes("bilgisayar-tablet__notebooklar.json"));
  assert.ok(files.includes("bilgisayar-tablet__notebooklar__nb-a.json"));
  const { canonicalCategoryTree } = require("../lib/site-category-schema");
  const { normalizeTree } = require("../lib/categories");
  const treeFiles = listingSnapshotJobs({ compactAll: [], byParent: {} }, normalizeTree(canonicalCategoryTree())).map(
    (job) => job.file
  );
  assert.ok(treeFiles.includes("bilgisayar-bilesenleri__bellekler__pc-bellegi-ddr5.json"));
  assert.ok(treeFiles.includes("bilgisayar-bilesenleri__bellekler__notebook-bellegi-ddr5.json"));
});

test("server exposes fast catalog bootstrap API and snapshot writers", () => {
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /sendCatalogHtml/);
  assert.match(serverJs, /\/api\/catalog-bootstrap/);
  assert.match(serverJs, /readCatalogBootstrapSnapshot/);
  assert.match(serverJs, /writeCatalogBootstrapSnapshots/);
  assert.match(serverJs, /scheduleWarmStorefrontCatalog/);
  assert.match(serverJs, /bootstrapSnapshotsReady/);
  assert.match(serverJs, /ensureListingTreeSnapshotFiles/);
  assert.match(serverJs, /catalogBootstrapSnapshotName/);
  assert.match(serverJs, /storefrontIndex\(false\)/);
  assert.match(serverJs, /max-age=120/);
  assert.match(serverJs, /\/listing\//);
  assert.match(serverJs, /listingSnapshotJobs/);
  assert.match(serverJs, /lookupPublicProductsByIds/);
  assert.match(serverJs, /enqueueXmlCategorySync/);
  assert.match(serverJs, /syncXmlSiteCategoriesAsync/);
  assert.match(serverJs, /getProductById/);
});
