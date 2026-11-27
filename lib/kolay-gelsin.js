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

function kolayGelsinConfig(env) {
  const source = env || process.env;
  const user = String(source.KOLAY_GELSIN_USER || "").trim();
  const password = String(source.KOLAY_GELSIN_PASSWORD || "").trim();
  const mode = String(source.KOLAY_GELSIN_MODE || "").trim().toLowerCase() === "live" ? "live" : "test";
  const baseUrl = String(source.KOLAY_GELSIN_BASE_URL || DEFAULT_BASE)
    .trim()
    .replace(/\/+$/, "");
  return {
    configured: Boolean(user && password),
    user,
    password,
    mode,
    baseUrl: baseUrl || DEFAULT_BASE,
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

function extractToken(body) {
  if (body == null) return "";
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return "";
    if (trimmed[0] === "{" || trimmed[0] === "[") {
      try {
        return extractToken(JSON.parse(trimmed));
      } catch (_) {
        return trimmed.replace(/^"|"$/g, "");
      }
    }
    return trimmed.replace(/^"|"$/g, "");
  }
  if (typeof body !== "object") return "";
  const data = body.data != null ? body.data : body.Data != null ? body.Data : body;
  if (typeof data === "string") return data.trim();
  if (data && typeof data === "object") {
    const token =
      data.token ||
      data.Token ||
      data.accessToken ||
      data.AccessToken ||
      data.jwt ||
      data.JWT ||
      "";
    if (token) return String(token).trim();
  }
  return String(body.token || body.Token || body.result || "").trim();
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

module.exports = {
  CARRIER_NAME,
  DEFAULT_BASE,
  LOGIN_PATH,
  kolayGelsinConfig,
  login,
  getToken,
  clearTokenCache,
  pingKolayGelsin,
  apiFetch,
  getCityDistricts,
};
