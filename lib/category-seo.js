"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = path.join(__dirname, "..", "assets", "data", "category-seo.json");

/** Safe alternate search phrases keyed by slug token or folded leaf fragment. No spam terms. */
const ALT_TERMS = {
  notebooklar: ["dizüstü bilgisayar", "laptop"],
  notebook: ["dizüstü bilgisayar", "laptop"],
  tabletler: ["tablet bilgisayar"],
  monitorler: ["bilgisayar monitörü", "ekran"],
  "ekran-kartlari": ["ekran kartı", "GPU"],
  bellekler: ["RAM", "bilgisayar belleği"],
  "pc-bellegi-ddr4": ["DDR4 RAM", "bellek"],
  "pc-bellegi-ddr5": ["DDR5 RAM", "bellek"],
  "laser-tonerler": ["laser toner", "yazıcı toneri"],
  "inkjet-kartuslar": ["mürekkep kartuşu", "inkjet kartuş"],
  "muadil-laser-tonerler": ["muadil toner", "uyumlu toner"],
  prizler: ["elektrik prizi", "çoklu priz"],
  powerbank: ["taşınabilir şarj", "power bank"],
  yazicilar: ["yazıcı"],
  "inkjet-yazicilar": ["mürekkepli yazıcı"],
  kasalar: ["bilgisayar kasası"],
  "power-supply": ["güç kaynağı", "PSU"],
};

const BANNED =
  /\b(en ucuz|süper fiyat|super fiyat|fırsat|firsat|bedava|%100|kaçırma|resmi olmayan garanti)\b/i;

let cached = null;

function loadCategorySeoData() {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || { entries: {} };
  } catch (_) {
    cached = { entries: {} };
  }
  return cached;
}

function resetCategorySeoCache() {
  cached = null;
}

function categorySeoPathKey(pathCats) {
  if (!pathCats || !pathCats.parent) return "";
  return [pathCats.parent, pathCats.mid, pathCats.child]
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("/");
}

function plain(text, max) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!max || value.length <= max) return value;
  return value.slice(0, max - 1).trim() + "…";
}

function prettyCategoryName(name) {
  const text = String(name || "").trim();
  if (!text || text !== text.toLocaleUpperCase("tr-TR")) return text;
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (!token.trim() || token.length <= 3) return token;
      const lower = token.toLocaleLowerCase("tr-TR");
      return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
    })
    .join("");
}

function altTermsFor(pathCats, leaf) {
  const slugs = [pathCats && pathCats.parent, pathCats && pathCats.mid, pathCats && pathCats.child]
    .map((s) => String(s || "").toLowerCase())
    .filter(Boolean);
  const out = [];
  const push = (term) => {
    const t = String(term || "").trim();
    if (!t) return;
    if (out.some((x) => x.toLocaleLowerCase("tr-TR") === t.toLocaleLowerCase("tr-TR"))) return;
    if (t.toLocaleLowerCase("tr-TR") === String(leaf || "").toLocaleLowerCase("tr-TR")) return;
    out.push(t);
  };
  slugs.forEach((slug) => (ALT_TERMS[slug] || []).forEach(push));
  const leafKey = String(leaf || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  (ALT_TERMS[leafKey] || []).forEach(push);
  return out.slice(0, 4);
}

function assertClean(text) {
  const value = String(text || "");
  if (BANNED.test(value)) {
    throw new Error("category SEO banned phrase: " + value.slice(0, 80));
  }
  return value;
}

function buildTeaser(leaf, alts) {
  // Düz cümle: özne net, yüklem sonda; parantez içi anahtar kelime yığını yok.
  const withAlts = alts.length
    ? leaf + " ürünlerini " + alts.slice(0, 2).join(" ve ") + " seçenekleriyle birlikte"
    : leaf + " ürünlerini";
  return assertClean(
    "Bu kategorideki " +
      withAlts +
      " KDV dahil güncel fiyatlarla inceleyebilir ve güvenli ödeme ile Patygo Teknoloji üzerinden sipariş verebilirsiniz."
  );
}

function buildDetailParagraphs(names, leaf, alts) {
  const scope =
    names.length > 1
      ? prettyJoin(names.slice(0, -1)) + " altında yer alan "
      : "";
  const p1 = assertClean(
    scope +
      leaf +
      " listesinde stokta bulunan ürünleri marka, özellik ve fiyata göre filtreleyebilirsiniz. Tüm fiyatlara KDV dahildir. Uygun modeli sepete ekleyerek güvenli ödeme ile sipariş verebilirsiniz."
  );
  const p2 = alts.length
    ? assertClean(
        "Bu ürün grubu " +
          prettyJoin(alts) +
          " gibi arama ifadeleriyle de anılır. Sayfadaki filtreler, listenizi bu ihtiyaçlara göre daraltmanıza yardımcı olur."
      )
    : assertClean(
        "Marka ve özellik filtreleriyle listeyi ihtiyacınıza göre daraltabilirsiniz. Stok bilgisi düzenli olarak güncellenir."
      );
  const p3 = assertClean(
    "Patygo Teknoloji, " +
      leaf +
      " ürünlerini bireysel ve kurumsal alıcılar için sunar. Kargo ve ödeme ayrıntıları sipariş aşamasında gösterilir. Sorularınız için iletişim kanallarımız açıktır."
  );
  return [p1, p2, p3];
}

function prettyJoin(parts) {
  const list = (parts || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  if (list.length === 2) return list[0] + " ve " + list[1];
  return list.slice(0, -1).join(", ") + " ve " + list[list.length - 1];
}

function autoCopy(pathCats, names) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  const leaf = list[list.length - 1] || "Ürünler";
  const alts = altTermsFor(pathCats, leaf);
  const teaser = buildTeaser(leaf, alts);
  const detailParagraphs = buildDetailParagraphs(list, leaf, alts);
  return {
    h1: leaf,
    teaser,
    lead: teaser,
    detailHeading: leaf + " hakkında",
    detailParagraphs,
    description: plain(
      leaf +
        " fiyatları ve modelleri Patygo Teknoloji’de. KDV dahil güncel fiyatlarla inceleyin; güvenli ödeme ile sipariş verin." +
        (alts.length ? " " + alts[0] + " seçenekleri mevcuttur." : ""),
      160
    ),
  };
}

/**
 * SEO copy for a category path. Auto-builds teaser (top) + detail (bottom) for every path;
 * curated assets/data/category-seo.json overrides when present.
 */
function resolveCategorySeo(pathCats, names) {
  const key = categorySeoPathKey(pathCats);
  const auto = autoCopy(pathCats, names);
  const entry = key && loadCategorySeoData().entries && loadCategorySeoData().entries[key];
  if (!entry || typeof entry !== "object") {
    return Object.assign({ key, curated: false }, auto);
  }
  const teaser = String(entry.teaser || entry.lead || auto.teaser).trim() || auto.teaser;
  let detailParagraphs = auto.detailParagraphs;
  if (Array.isArray(entry.detailParagraphs) && entry.detailParagraphs.length) {
    detailParagraphs = entry.detailParagraphs.map((p) => assertClean(String(p || "").trim())).filter(Boolean);
  } else if (entry.detail) {
    detailParagraphs = String(entry.detail)
      .split(/\n{2,}/)
      .map((p) => assertClean(p.replace(/\s+/g, " ").trim()))
      .filter(Boolean);
  }
  if (!detailParagraphs.length) detailParagraphs = auto.detailParagraphs;
  return {
    key,
    curated: true,
    h1: String(entry.h1 || auto.h1).trim() || auto.h1,
    teaser: assertClean(teaser),
    lead: assertClean(teaser),
    detailHeading: String(entry.detailHeading || auto.detailHeading).trim() || auto.detailHeading,
    detailParagraphs,
    description: plain(entry.description || auto.description, 160) || auto.description,
  };
}

function categorySeoTitle(seo) {
  const h1 = (seo && seo.h1) || "Ürünler";
  return h1 + " Fiyatları ve Modelleri | Patygo Teknoloji";
}

/** Every node in the live category tree gets a generated SEO entry (curated overrides win). */
function buildAllCategorySeoEntries(categories) {
  const entries = {};
  function walk(nodes, slugParts, nameParts) {
    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      if (!node || !node.slug) return;
      const slugs = slugParts.concat(String(node.slug).trim().toLowerCase());
      const names = nameParts.concat(prettyCategoryName(node.name));
      const pathCats = {
        parent: slugs[0] || "",
        mid: slugs[1] || "",
        child: slugs[2] || "",
      };
      const key = categorySeoPathKey(pathCats);
      if (key) entries[key] = resolveCategorySeo(pathCats, names);
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children, slugs, names);
      }
    });
  }
  walk(categories, [], []);
  return entries;
}

function categorySeoPayload(categories) {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    entries: buildAllCategorySeoEntries(categories),
  };
}

module.exports = {
  categorySeoPathKey,
  resolveCategorySeo,
  categorySeoTitle,
  buildAllCategorySeoEntries,
  categorySeoPayload,
  autoCopy,
  altTermsFor,
  loadCategorySeoData,
  resetCategorySeoCache,
  prettyCategoryName,
  DATA_FILE,
  BANNED,
};
