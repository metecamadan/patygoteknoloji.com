"use strict";

const path = require("path");
const { runTour, writeTourFiles } = require("../lib/seller-intel");

async function main() {
  const categoryId = process.env.SELLER_INTEL_CATEGORY || "laptop-notebook";
  const result = await runTour({
    categoryId,
    limit: Number(process.env.SELLER_INTEL_LIMIT || 8),
    delayMs: 500,
    googleKey: process.env.GOOGLE_MAPS_API_KEY || "",
    yandexKey: process.env.YANDEX_MAPS_API_KEY || "",
  });
  const dir = path.join(process.cwd(), ".runtime", "seller-intel");
  writeTourFiles(dir, result);
  process.stdout.write(`${JSON.stringify(result.ozet, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
});
