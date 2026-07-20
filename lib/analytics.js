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
    return new URL(String(value || "/"), "https://patygo.local").pathname.slice(0, 160) || "/";
  } catch (_) {
    return "/";
  }
}

function percentageChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
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
      let pathname = safePath(event.path);
      if (!(pathname in day.pages) && Object.keys(day.pages).length >= MAX_DAILY_PATHS) {
        pathname = "/(other)";
      }
      day.pageViews += 1;
      day.pages[pathname] = (Number(day.pages[pathname]) || 0) + 1;
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
    });
    return Object.assign(totals, {
      visitors: sessions.size,
      conversions: totals.leads + totals.orders,
      pages,
    });
  }

  function summary(requestedDays) {
    const periodDays = Math.max(1, Math.min(90, Number(requestedDays) || 30));
    const currentDate = now();
    const currentEnd = dayKey(currentDate);
    const currentStart = dayKey(shiftDay(currentDate, -(periodDays - 1)));
    const previousEndDate = shiftDay(currentDate, -periodDays);
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
      const key = dayKey(shiftDay(currentDate, -offset));
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

module.exports = { createAnalyticsStore };
