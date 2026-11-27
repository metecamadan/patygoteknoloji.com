"use strict";

/**
 * Kolay Gelsin (Sendeo) REST cargo API.
 * Docs: https://klyglsn.github.io/web-service-doc/
 * Auth: POST Token/LoginAES → Bearer (≈20h). No IP whitelist.
 */

const CARRIER_NAME = "Kolay Gelsin";
const DEFAULT_BASE = "https://apiintg.kolaygelsin.com";
const LOGIN_PATH = "/api/Token/LoginAES";
const REQUEST_TIMEOUT_MS = 30000;
/** Soft refresh before the documented 20h expiry. */
const TOKEN_TTL_MS = 19 * 60 * 60 * 1000;

let tokenCache = { key: "", token: "", expiresAt: 0 };

/** Default sender — same as lib/cargo-label.js / mesafeli satış. */
const DEFAULT_SENDER = {
  address: "Mevlana Mah. 911. Sk. Karadayı A.P No: 19 İç Kapı No: 8",
  cityName: "İstanbul",
  districtName: "Gaziosmanpaşa",
  gsm: "5555070724",
  email: "mete.camadan@patygoteknoloji.com",
};

function intEnv(source, key) {
  const raw = String(source[key] || "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function kolayGelsinConfig(env) {
  const source = env || process.env;
  const user = String(source.KOLAY_GELSIN_USER || "").trim();
  const password = String(source.KOLAY_GELSIN_PASSWORD || "").trim();
  const mode = String(source.KOLAY_GELSIN_MODE || "").trim().toLowerCase() === "live" ? "live" : "test";
  const baseUrl = String(source.KOLAY_GELSIN_BASE_URL || DEFAULT_BASE)
    .trim()
    .replace(/\/+$/, "");
  const senderAddress =
    String(source.KOLAY_GELSIN_SENDER_ADDRESS || "").trim() || DEFAULT_SENDER.address;
  const senderGsm = String(source.KOLAY_GELSIN_SENDER_GSM || "")
    .trim()
    .replace(/\D/g, "")
    .replace(/^90(?=\d{10}$)/, "")
    .replace(/^0(?=\d{10}$)/, "") || DEFAULT_SENDER.gsm;
  const senderEmail =
    String(source.KOLAY_GELSIN_SENDER_EMAIL || "").trim() || DEFAULT_SENDER.email;
  const senderCityId = intEnv(source, "KOLAY_GELSIN_SENDER_CITY_ID");
  const senderDistrictId = intEnv(source, "KOLAY_GELSIN_SENDER_DISTRICT_ID");
  return {
    configured: Boolean(user && password),
    user,
    password,
    mode,
    baseUrl: baseUrl || DEFAULT_BASE,
    sender: {
      address: senderAddress,
      cityName: DEFAULT_SENDER.cityName,
      districtName: DEFAULT_SENDER.districtName,
      cityId: senderCityId,
      districtId: senderDistrictId,
      gsm: senderGsm,
      email: senderEmail,
      ready: Boolean(senderAddress && senderGsm && senderCityId && senderDistrictId),
    },
  };
}

function requireConfig(env) {
  const cfg = kolayGelsinConfig(env);
  if (!cfg.configured) {
    const err = new Error("Kolay Gelsin bilgileri sunucuda tanımlı değil.");
    err.status = 503;
    throw err;
  }
  return cfg;
}

function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const ms = timeoutMs || REQUEST_TIMEOUT_MS;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return fetchImpl(url, Object.assign({}, init, { signal: AbortSignal.timeout(ms) }));
  }
  return fetchImpl(url, init);
}

function pickTokenField(obj) {
  if (!obj || typeof obj !== "object") return "";
  const token =
    obj.token ||
    obj.Token ||
    obj.accessToken ||
    obj.AccessToken ||
    obj.jwt ||
    obj.JWT ||
    "";
  if (token == null) return "";
  if (typeof token === "object") return "";
  return String(token).trim();
}

function extractToken(body) {
  if (body == null) return "";
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return "";
    // Reject accidental String(object) leakage (also starts with '[')
    if (trimmed === "[object Object]") return "";
    if (trimmed[0] === "{" || trimmed[0] === "[") {
      try {
        return extractToken(JSON.parse(trimmed));
      } catch (_) {
        return "";
      }
    }
    return trimmed.replace(/^"|"$/g, "");
  }
  if (typeof body !== "object") return "";
  const nested =
    body.result != null
      ? body.result
      : body.Result != null
        ? body.Result
        : body.data != null
          ? body.data
          : body.Data != null
            ? body.Data
            : null;
  if (typeof nested === "string") {
    const t = nested.trim();
    return t === "[object Object]" ? "" : t;
  }
  const fromNested = pickTokenField(nested);
  if (fromNested) return fromNested;
  return pickTokenField(body);
}

function loginOk(status, body) {
  if (status === 401 || status === 403) return false;
  if (status < 200 || status >= 300) return false;
  if (body && typeof body === "object") {
    if (body.result === false || body.Result === false || body.success === false) return false;
  }
  return Boolean(extractToken(body));
}

async function login(options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const fetchImpl = opts.fetchImpl || fetch;
  const url = cfg.baseUrl + LOGIN_PATH;
  const res = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ musteri: cfg.user, sifre: cfg.password }),
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    /* keep text */
  }
  const token = extractToken(body);
  if (!loginOk(res.status, body) || !token) {
    const message =
      (body && typeof body === "object" && (body.resultMessage || body.ResultMessage || body.message)) ||
      (typeof body === "string" && body.slice(0, 200)) ||
      "HTTP " + res.status;
    const err = new Error(String(message));
    err.status = res.status || 502;
    throw err;
  }
  const key = cfg.baseUrl + "\0" + cfg.user + "\0" + cfg.password;
  tokenCache = { key, token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return { token, mode: cfg.mode, baseUrl: cfg.baseUrl, status: res.status };
}

async function getToken(options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const key = cfg.baseUrl + "\0" + cfg.user + "\0" + cfg.password;
  const now = Date.now();
  if (!opts.forceRefresh && tokenCache.key === key && tokenCache.token && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }
  const logged = await login(opts);
  return logged.token;
}

function clearTokenCache() {
  tokenCache = { key: "", token: "", expiresAt: 0 };
}

/** Credential check: LoginAES must return a Bearer token. */
async function pingKolayGelsin(options) {
  const opts = options || {};
  const cfg = kolayGelsinConfig(opts.env);
  if (!cfg.configured) {
    return { ok: false, mode: cfg.mode, message: "Kolay Gelsin bilgileri sunucuda tanımlı değil." };
  }
  try {
    clearTokenCache();
    const logged = await login(opts);
    return {
      ok: true,
      mode: logged.mode,
      message: "LoginAES token alındı",
    };
  } catch (err) {
    return {
      ok: false,
      mode: cfg.mode,
      message: err && err.message ? String(err.message) : "Login başarısız",
    };
  }
}

async function apiFetch(path, options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const fetchImpl = opts.fetchImpl || fetch;
  const token = await getToken(opts);
  const method = String(opts.method || "GET").toUpperCase();
  const init = {
    method,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + token,
    },
  };
  if (opts.body != null) {
    init.headers["Content-Type"] = "application/json";
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  const url = cfg.baseUrl + (path.startsWith("/") ? path : "/" + path);
  const res = await fetchWithTimeout(fetchImpl, url, init);
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    /* keep text */
  }
  if (res.status === 401 && !opts._retried) {
    clearTokenCache();
    return apiFetch(path, Object.assign({}, opts, { forceRefresh: true, _retried: true }));
  }
  return { status: res.status, body, ok: res.status >= 200 && res.status < 300 };
}

async function getCityDistricts(cityName, districtName, options) {
  const q = new URLSearchParams();
  if (cityName) q.set("CityName", String(cityName));
  if (districtName) q.set("DistrictName", String(districtName));
  const path = "/api/Cargo/GetCityDistricts" + (q.toString() ? "?" + q.toString() : "");
  return apiFetch(path, Object.assign({}, options, { method: "GET" }));
}

function normalizeDistrictKey(name) {
  return String(name || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "");
}

function parseCityDistrictsBody(body) {
  const result =
    (body && (body.result || body.Result || body.data || body.Data)) || body || {};
  const cityId = Number(result.CityId || result.cityId || 0) || 0;
  const cityName = String(result.CityName || result.cityName || "").trim();
  const districts = result.Districts || result.districts || [];
  return {
    cityId,
    cityName,
    districts: Array.isArray(districts)
      ? districts.map((d) => ({
          districtId: Number(d.DistrictId || d.districtId || 0) || 0,
          districtName: String(d.DistrictName || d.districtName || "").trim(),
        }))
      : [],
  };
}

/** Resolve SenderCityId / SenderDistrictId via GetCityDistricts (cached in env by ops). */
async function resolveSenderLocation(options) {
  const opts = options || {};
  const cfg = kolayGelsinConfig(opts.env);
  if (cfg.sender.cityId && cfg.sender.districtId) {
    return {
      ok: true,
      cityId: cfg.sender.cityId,
      districtId: cfg.sender.districtId,
      cityName: cfg.sender.cityName,
      districtName: cfg.sender.districtName,
      source: "env",
    };
  }
  const cityQuery = opts.cityName || cfg.sender.cityName || "Istanbul";
  const districtQuery = opts.districtName || cfg.sender.districtName || "Gaziosmanpasa";
  const res = await getCityDistricts(cityQuery, districtQuery, opts);
  const parsed = parseCityDistrictsBody(res.body);
  const want = normalizeDistrictKey(districtQuery);
  const match =
    parsed.districts.find((d) => normalizeDistrictKey(d.districtName) === want) ||
    parsed.districts.find((d) => normalizeDistrictKey(d.districtName).includes(want)) ||
    parsed.districts[0];
  if (!res.ok || !parsed.cityId || !match || !match.districtId) {
    return {
      ok: false,
      message:
        (res.body && (res.body.resultMessage || res.body.ResultMessage || res.body.message)) ||
        "GetCityDistricts il/ilçe bulamadı (HTTP " + res.status + ")",
      status: res.status,
    };
  }
  return {
    ok: true,
    cityId: parsed.cityId,
    districtId: match.districtId,
    cityName: parsed.cityName || cityQuery,
    districtName: match.districtName,
    source: "api",
  };
}

module.exports = {
  CARRIER_NAME,
  DEFAULT_BASE,
  DEFAULT_SENDER,
  LOGIN_PATH,
  kolayGelsinConfig,
  extractToken,
  login,
  getToken,
  clearTokenCache,
  pingKolayGelsin,
  apiFetch,
  getCityDistricts,
  parseCityDistrictsBody,
  resolveSenderLocation,
};
