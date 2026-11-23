"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("./supplier");

const MAX_SLIDES = 8;
const MAX_DEALS = 4;
const TONES = new Set(["navy", "blue", "indigo", "teal", "slate"]);

function newSlideId(prefix) {
  return (prefix || "hs_") + crypto.randomBytes(6).toString("hex");
}

function normalizeTone(value) {
  const tone = String(value || "").trim().toLowerCase();
  return TONES.has(tone) ? tone : "navy";
}

function normalizeHref(value) {
  const raw = String(value || "").trim().slice(0, 500);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return "/" + raw.replace(/^\/+/, "");
}

function normalizeSlide(raw, index) {
  const input = raw && typeof raw === "object" ? raw : {};
  const id = String(input.id || "").trim().slice(0, 64) || newSlideId("hs_");
  const sort = Number.isFinite(Number(input.sort)) ? Math.round(Number(input.sort)) : index;
  const imageDesktop = String(input.imageDesktop || input.imageOverride || "")
    .trim()
    .slice(0, 500);
  const imageMobile = String(input.imageMobile || "")
    .trim()
    .slice(0, 500);
  const categoryKey = String(input.categoryKey || "")
    .trim()
    .slice(0, 200);
  const categoryName = String(input.categoryName || "")
    .trim()
    .slice(0, 120);
  const eyebrow =
    String(input.eyebrow || "").trim().slice(0, 80) || categoryName.slice(0, 80);
  const linkHref = normalizeHref(input.linkHref || input.href || "");
  // productId kept for migrate → deals; campaigns no longer require it
  const productId = String(input.productId || "").trim().slice(0, 120);
  return {
    id,
    productId,
    categoryKey,
    categoryName,
    eyebrow,
    titleOverride: String(input.titleOverride || "").trim().slice(0, 160),
    linkHref,
    imageDesktop,
    imageMobile,
    /** @deprecated alias of imageDesktop */
    imageOverride: imageDesktop,
    tone: normalizeTone(input.tone),
    active: input.active !== false && input.active !== 0 && input.active !== "0",
    sort,
  };
}

function normalizeDeal(raw, index) {
  const input = raw && typeof raw === "object" ? raw : {};
  const id = String(input.id || "").trim().slice(0, 64) || newSlideId("hd_");
  const sort = Number.isFinite(Number(input.sort)) ? Math.round(Number(input.sort)) : index;
  const categoryKey = String(input.categoryKey || "")
    .trim()
    .slice(0, 200);
  const categoryName = String(input.categoryName || "")
    .trim()
    .slice(0, 120);
  const eyebrow =
    String(input.eyebrow || "").trim().slice(0, 80) || categoryName.slice(0, 80);
  return {
    id,
    productId: String(input.productId || "").trim().slice(0, 120),
    categoryKey,
    categoryName,
    eyebrow,
    titleOverride: String(input.titleOverride || "").trim().slice(0, 160),
    active: input.active !== false && input.active !== 0 && input.active !== "0",
    sort,
  };
}

function slideIsPublishable(slide) {
  return Boolean(slide && slide.imageDesktop && slide.linkHref);
}

function dealIsPublishable(deal) {
  return Boolean(deal && deal.productId);
}

function migrateDealsFromSlides(slides, existingDeals) {
  if (Array.isArray(existingDeals) && existingDeals.length) {
    return existingDeals
      .map((deal, index) => normalizeDeal(deal, index))
      .filter(dealIsPublishable)
      .sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id)))
      .slice(0, MAX_DEALS)
      .map((deal, index) => Object.assign({}, deal, { sort: index }));
  }
  const fromSlides = [];
  const seen = new Set();
  for (const slide of slides) {
    const pid = String(slide.productId || "").trim();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    fromSlides.push(
      normalizeDeal(
        {
          productId: pid,
          categoryKey: slide.categoryKey,
          categoryName: slide.categoryName,
          eyebrow: slide.eyebrow,
          titleOverride: slide.titleOverride,
          active: slide.active,
        },
        fromSlides.length
      )
    );
  }
  return fromSlides
    .filter(dealIsPublishable)
    .slice(0, MAX_DEALS)
    .map((deal, index) => Object.assign({}, deal, { sort: index }));
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const normalizedSlides = rawSlides.map((slide, index) => normalizeSlide(slide, index));
  const deals = migrateDealsFromSlides(normalizedSlides, input.deals);
  const slides = normalizedSlides
    .filter(slideIsPublishable)
    .sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX_SLIDES)
    .map((slide, index) =>
      Object.assign({}, slide, {
        sort: index,
        // campaigns no longer store product for right card
        productId: "",
      })
    );
  return {
    slides,
    deals,
    updatedAt: String(input.updatedAt || "").trim() || null,
  };
}

function createHomeSliderStore(root) {
  const file = path.join(root, ".runtime", "home-slider.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  function read() {
    try {
      if (!fs.existsSync(file)) return normalizeConfig({});
      return normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (_) {
      return normalizeConfig({});
    }
  }

  function getConfig() {
    return read();
  }

  function setConfig(patch) {
    const current = read();
    const next = normalizeConfig({
      slides: patch && patch.slides !== undefined ? patch.slides : current.slides,
      deals: patch && patch.deals !== undefined ? patch.deals : current.deals,
      updatedAt: new Date().toISOString(),
    });
    atomicWriteJson(file, next);
    return next;
  }

  return {
    getConfig,
    setConfig,
    file,
    MAX_SLIDES,
    MAX_DEALS,
    TONES: Array.from(TONES),
  };
}

module.exports = {
  createHomeSliderStore,
  normalizeConfig,
  normalizeSlide,
  normalizeDeal,
  slideIsPublishable,
  dealIsPublishable,
  normalizeHref,
  MAX_SLIDES,
  MAX_DEALS,
  TONES: Array.from(TONES),
};
