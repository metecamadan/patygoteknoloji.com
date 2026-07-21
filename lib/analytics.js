const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("./supplier");

const ALLOWED_EVENTS = new Set([
  "page_view",
  "add_to_cart",
  "checkout_started",
  "lead_submitted",
  "order_submitted",
]);
const RETENTION_DAYS = 90;
const MAX_DAILY_SESSIONS = 100_000;
const MAX_DAILY_PATHS = 500;
const MAX_DAILY_PRODUCTS = 500;

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDay(date, amount) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return shifted;
}

function safePath(value) {
  try {
    const url = new URL(String(value || "/"), "https://patygo.local");
    return (url.pathname + url.search).slice(0, 220) || "/";
  } catch (_) {
    return "/";
  }
}

function extractProductId(pathValue, explicitId) {
  const explicit = String(explicitId || "")
    .trim()
    .slice(0, 80);
  if (explicit) return explicit;
  try {
    const url = new URL(String(pathValue || "/"), "https://patygo.local");
    if (!/urun-detay/i.test(url.pathname)) return "";
    return String(url.searchParams.get("id") || "")
      .trim()
      .slice(0, 80);
  } catch (_) {
    return "";
  }
}

function pathnameOnly(pathValue) {
  try {
    return new URL(String(pathValue || "/"), "https://patygo.local").pathname.slice(0, 160) || "/";
  } catch (_) {
    return "/";
  }
}

function percentageChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function parseDay(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function resolvePeriodRange(input, nowDate) {
  const currentDate = nowDate ? new Date(nowDate) : new Date();
  const today = dayKey(currentDate);
  let from = null;
  let to = null;

  if (input && typeof input === "object" && !Array.isArray(input)) {
    from = parseDay(input.from);
    to = parseDay(input.to);
    if ((!from || !to) && input.days != null) {
      const periodDays = Math.max(1, Math.min(90, Number(input.days) || 30));
      to = today;
      from = dayKey(shiftDay(currentDate, -(periodDays - 1)));
    }
  } else {
    const periodDays = Math.max(1, Math.min(90, Number(input) || 30));
    to = today;
    from = dayKey(shiftDay(currentDate, -(periodDays - 1)));
  }

  if (!from || !to) {
    to = today;
    from = dayKey(shiftDay(currentDate, -29));
  }
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  let periodDays =
    Math.round(
      (new Date(to + "T00:00:00.000Z") - new Date(from + "T00:00:00.000Z")) / 86400000
    ) + 1;
  if (periodDays > 90) {
    from = dayKey(shiftDay(new Date(to + "T00:00:00.000Z"), -89));
    periodDays = 90;
  }

  return { from, to, periodDays, currentDate, today };
}

function createAnalyticsStore(root, options) {
  const settings = options || {};
  const now = settings.now || (() => new Date());
  const file = path.join(root, ".runtime", "analytics.json");

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && value.days && typeof value.days === "object") return value;
    } catch (_) {}
    return { version: 1, days: {} };
  }

  function write(value) {
    atomicWriteJson(file, value);
  }

  function record(event) {
    if (!event || !ALLOWED_EVENTS.has(event.type)) {
      throw new Error("Analitik olayı geçersiz.");
    }
    const currentDate = now();
    const today = dayKey(currentDate);
    const data = read();
    const day = data.days[today] || {
      pageViews: 0,
      sessions: [],
      events: {},
      pages: {},
      productViews: {},
    };
    const sessionId = String(event.sessionId || "").slice(0, 120);
    if (sessionId) {
      const sessionHash = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
      if (
        day.sessions.length < MAX_DAILY_SESSIONS &&
        !day.sessions.includes(sessionHash)
      ) {
        day.sessions.push(sessionHash);
      }
    }
    if (event.type === "page_view") {
      const fullPath = safePath(event.path);
      let pathname = pathnameOnly(fullPath);
      if (!(pathname in day.pages) && Object.keys(day.pages).length >= MAX_DAILY_PATHS) {
        pathname = "/(other)";
      }
      day.pageViews += 1;
      day.pages[pathname] = (Number(day.pages[pathname]) || 0) + 1;
      const productId = extractProductId(fullPath, event.productId);
      if (productId) {
        if (!day.productViews) day.productViews = {};
        if (
          !(productId in day.productViews) &&
          Object.keys(day.productViews).length >= MAX_DAILY_PRODUCTS
        ) {
          // ignore overflow products for the day
        } else {
          day.productViews[productId] = (Number(day.productViews[productId]) || 0) + 1;
        }
      }
    } else {
      day.events[event.type] = (Number(day.events[event.type]) || 0) + 1;
    }
    data.days[today] = day;

    const oldest = dayKey(shiftDay(currentDate, -(RETENTION_DAYS - 1)));
    Object.keys(data.days).forEach((key) => {
      if (key < oldest || key > today) delete data.days[key];
    });
    write(data);
    return { ok: true };
  }

  function aggregate(data, start, end) {
    const sessions = new Set();
    const pages = {};
    const productViews = {};
    const totals = {
      pageViews: 0,
      addToCart: 0,
      checkoutStarted: 0,
      leads: 0,
      orders: 0,
    };
    Object.entries(data.days).forEach(([key, day]) => {
      if (key < start || key > end) return;
      totals.pageViews += Number(day.pageViews) || 0;
      totals.addToCart += Number(day.events && day.events.add_to_cart) || 0;
      totals.checkoutStarted += Number(day.events && day.events.checkout_started) || 0;
      totals.leads += Number(day.events && day.events.lead_submitted) || 0;
      totals.orders += Number(day.events && day.events.order_submitted) || 0;
      (day.sessions || []).forEach((session) => sessions.add(session));
      Object.entries(day.pages || {}).forEach(([pathname, count]) => {
        pages[pathname] = (pages[pathname] || 0) + (Number(count) || 0);
      });
      Object.entries(day.productViews || {}).forEach(([productId, count]) => {
        productViews[productId] = (productViews[productId] || 0) + (Number(count) || 0);
      });
    });
    return Object.assign(totals, {
      visitors: sessions.size,
      conversions: totals.leads + totals.orders,
      pages,
      productViews,
    });
  }

  function summary(requestedDaysOrRange) {
    const range = resolvePeriodRange(requestedDaysOrRange, now());
    const { from: currentStart, to: currentEnd, periodDays, currentDate } = range;
    const previousEndDate = shiftDay(new Date(currentStart + "T00:00:00.000Z"), -1);
    const previousEnd = dayKey(previousEndDate);
    const previousStart = dayKey(shiftDay(previousEndDate, -(periodDays - 1)));
    const data = read();
    const current = aggregate(data, currentStart, currentEnd);
    const previous = aggregate(data, previousStart, previousEnd);
    const conversionRate = current.visitors
      ? Math.round((current.conversions / current.visitors) * 10_000) / 100
      : 0;
    const previousRate = previous.visitors
      ? Math.round((previous.conversions / previous.visitors) * 10_000) / 100
      : 0;
    const daily = [];
    for (let offset = periodDays - 1; offset >= 0; offset -= 1) {
      const key = dayKey(shiftDay(new Date(currentEnd + "T00:00:00.000Z"), -offset));
      if (key < currentStart || key > currentEnd) continue;
      const day = data.days[key] || {};
      daily.push({
        date: key,
        pageViews: Number(day.pageViews) || 0,
        visitors: Array.isArray(day.sessions) ? day.sessions.length : 0,
        conversions:
          (Number(day.events && day.events.lead_submitted) || 0) +
          (Number(day.events && day.events.order_submitted) || 0),
      });
    }
    return {
      periodDays,
      from: currentStart,
      to: currentEnd,
      pageViews: current.pageViews,
      visitors: current.visitors,
      conversions: current.conversions,
      conversionRate,
      addToCart: current.addToCart,
      checkoutStarted: current.checkoutStarted,
      leads: current.leads,
      orders: current.orders,
      topPages: Object.entries(current.pages)
        .map(([pathname, views]) => ({ path: pathname, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 5),
      topViewedProducts: Object.entries(current.productViews || {})
        .map(([productId, views]) => ({ productId, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10),
      daily,
      comparison: {
        pageViewsPercent: percentageChange(current.pageViews, previous.pageViews),
        visitorsPercent: percentageChange(current.visitors, previous.visitors),
        conversionRateDelta: Math.round((conversionRate - previousRate) * 100) / 100,
      },
      updatedAt: currentDate.toISOString(),
    };
  }

  return { record, summary };
}

module.exports = { createAnalyticsStore, resolvePeriodRange };
