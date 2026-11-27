"use strict";

/**
 * Kolay Gelsin (Sendeo) REST cargo API.
 * Docs: https://klyglsn.github.io/web-service-doc/
 * Auth: POST Token/LoginAES → Bearer (≈20h). No IP whitelist.
 */

const { receiverStreet } = require("./yurtici-kargo");

const CARRIER_NAME = "Kolay Gelsin";
const DEFAULT_BASE = "https://apiintg.kolaygelsin.com";
const LOGIN_PATH = "/api/Token/LoginAES";
const REQUEST_TIMEOUT_MS = 30000;
/** Soft refresh before the documented 20h expiry. */
const TOKEN_TTL_MS = 19 * 60 * 60 * 1000;
const MAX_REFERENCE_LENGTH = 50;
/** Status 101 = iş emri (iptal edilebilir); 111 = teslim edildi. */
const STATE_JOB = 101;
const STATE_DELIVERED = 111;

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

/** Alias so cargo-shipments can call client.getConfig for either carrier. */
function getConfig(env) {
  return kolayGelsinConfig(env);
}

/** ReferenceNo = order id, suffix on retry; Kolay allows 50 chars (Yurtiçi was 20). */
function cargoKeyFor(orderId, attempt) {
  const base = String(orderId || "").trim();
  const n = Number(attempt) || 1;
  const key = n > 1 ? base + "-" + n : base;
  if (!base || key.length > MAX_REFERENCE_LENGTH) {
    throw new Error("Kargo anahtarı " + MAX_REFERENCE_LENGTH + " karakteri aşıyor: " + key);
  }
  return key;
}

function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) throw new Error("Alıcı telefonu 10 haneli olmalı (5xx xxx xx xx).");
  return digits;
}

function positiveNumber(value) {
  const n = Math.round(Number(value) * 1000) / 1000;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unwrapResult(body) {
  if (!body || typeof body !== "object") return body;
  if (body.result != null) return body.result;
  if (body.Result != null) return body.Result;
  if (body.data != null) return body.data;
  return body;
}

function apiErrorMessage(body, status) {
  if (body && typeof body === "object") {
    const msg =
      body.ExceptionMessage ||
      body.exceptionMessage ||
      body.resultMessage ||
      body.ResultMessage ||
      body.message ||
      (typeof body.result === "string" ? body.result : "");
    if (msg) return String(msg).slice(0, 240);
  }
  return "HTTP " + status;
}

async function resolveCityDistrict(cityName, districtName, options) {
  const city = String(cityName || "").trim();
  const district = String(districtName || "").trim();
  if (!city || !district) throw new Error("Teslimat il/ilçe bilgisi eksik.");
  const res = await getCityDistricts(city, district, options);
  const parsed = parseCityDistrictsBody(res.body);
  const want = normalizeDistrictKey(district);
  const match =
    parsed.districts.find((d) => normalizeDistrictKey(d.districtName) === want) ||
    parsed.districts.find((d) => normalizeDistrictKey(d.districtName).includes(want)) ||
    null;
  if (!res.ok || !parsed.cityId || !match || !match.districtId) {
    throw Object.assign(new Error("Alıcı il/ilçe Kolay Gelsin koduna çevrilemedi: " + city + " / " + district), {
      status: res.status || 502,
    });
  }
  return { cityId: parsed.cityId, districtId: match.districtId, cityName: parsed.cityName, districtName: match.districtName };
}

function mapTrackState(stateId) {
  const id = Number(stateId);
  if (id === STATE_DELIVERED) return "delivered";
  if (id === STATE_JOB || !id) return "created";
  return "in_transit";
}

/** Build SetDelivery body (DeliveryType=1, our ReferenceNo barcode on A4 label). */
async function buildSetDeliveryPayload(order, options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  if (!cfg.sender.ready) {
    const err = new Error("Kolay Gelsin gönderici adresi / il-ilçe ID sunucuda tanımlı değil.");
    err.status = 503;
    throw err;
  }
  const c = (order && order.customer) || {};
  const name = String(c.company || c.name || "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (name.replace(/[^\p{L}]/gu, "").length < 4 || name.length < 5) {
    throw new Error("Alıcı adı en az 5 karakter olmalı.");
  }
  const street = receiverStreet(c);
  if (street.length < 5) throw new Error("Alıcı açık adresi eksik.");
  const receiverLoc = await resolveCityDistrict(c.shippingCity, c.shippingDistrict, opts);
  const desi = positiveNumber(opts.desi);
  const kg = positiveNumber(opts.kg);
  const referenceNo = String(opts.cargoKey || opts.referenceNo || order.id).slice(0, MAX_REFERENCE_LENGTH);
  return {
    DeliveryType: 1,
    ReferenceNo: referenceNo,
    Description: ("Patygo sipariş " + order.id).slice(0, 200),
    SenderAddress: cfg.sender.address.slice(0, 225),
    SenderCityId: cfg.sender.cityId,
    SenderDistrictId: cfg.sender.districtId,
    SenderGSM: cfg.sender.gsm,
    SenderEmail: cfg.sender.email || undefined,
    Receiver: name,
    ReceiverAddress: street.slice(0, 225),
    ReceiverCityId: receiverLoc.cityId,
    ReceiverDistrictId: receiverLoc.districtId,
    ReceiverGSM: normalizePhone(c.phone),
    ReceiverEmail: String(c.email || "").trim().slice(0, 250) || undefined,
    PaymentType: 1,
    CollectionType: 0,
    CollectionPrice: 0,
    ServiceType: 1,
    // We print our own A4 Code128 of ReferenceNo (same idea as Yurtiçi); still request Base64 for ops if needed.
    BarcodeLabelType: 1,
    BarcodeVersion: "V2",
    products: [
      {
        Count: 1,
        ProductCode: "",
        Description: "",
        Deci: desi != null ? Math.round(desi) : 0,
        Weigth: kg != null ? Math.round(kg) : 0,
        Price: 0,
      },
    ],
  };
}

async function setDelivery(order, options) {
  const opts = options || {};
  const payload = await buildSetDeliveryPayload(order, opts);
  const res = await apiFetch("/api/Cargo/SetDelivery", {
    method: "POST",
    body: payload,
    env: opts.env,
    fetchImpl: opts.fetchImpl,
  });
  const result = unwrapResult(res.body);
  if (!res.ok) {
    const err = new Error(apiErrorMessage(res.body, res.status));
    err.status = res.status || 502;
    throw err;
  }
  const trackingNumber = String(
    (result && (result.TrackingNumber || result.trackingNumber || result.TrackingNo)) || ""
  ).trim();
  const trackingUrl = String((result && (result.TrackingUrl || result.trackingUrl)) || "").trim();
  const cfg = kolayGelsinConfig(opts.env);
  return {
    mode: cfg.mode,
    jobId: trackingNumber,
    trackingNumber,
    trackingUrl,
    referenceNo: payload.ReferenceNo,
    barcode: result && (result.Barcode || result.barcode),
    alreadyExisted: false,
  };
}

/** cargo-shipments adapter: same shape as Yurtiçi createShipment. */
async function createShipment(order, options) {
  const opts = options || {};
  const created = await setDelivery(order, opts);
  return {
    mode: created.mode,
    jobId: created.jobId,
    alreadyExisted: false,
    trackingUrl: created.trackingUrl,
  };
}

function bodySaysCancelled(body) {
  if (body === true) return true;
  if (!body || typeof body !== "object") return false;
  if (body.IsSuccess === true || body.isSuccess === true || body.IsSuccessful === true) return true;
  const r = unwrapResult(body);
  if (r === true) return true;
  if (r && typeof r === "object") {
    return r.IsSuccess === true || r.isSuccess === true || r.IsSuccessful === true;
  }
  return false;
}

async function cancelDelivery(referenceNo, options) {
  const opts = options || {};
  const ref = String(referenceNo || "").trim();
  if (!ref) throw new Error("İptal için referans no gerekli.");
  const q = new URLSearchParams({ referenceNo: ref });
  const res = await apiFetch("/api/Cargo/CancelDelivery?" + q.toString(), {
    method: "POST",
    env: opts.env,
    fetchImpl: opts.fetchImpl,
  });
  const success = res.ok && bodySaysCancelled(res.body);
  return {
    cancelled: Boolean(success),
    message: success ? "OK" : apiErrorMessage(res.body, res.status),
    status: res.status,
  };
}

async function cancelShipment(cargoKey, options) {
  return cancelDelivery(cargoKey, options);
}

async function trackDelivery(referenceNo, options) {
  const opts = options || {};
  const ref = String(referenceNo || "").trim();
  const q = new URLSearchParams({ referenceNo: ref });
  const res = await apiFetch("/api/Cargo/TrackDelivery?" + q.toString(), {
    method: "GET",
    env: opts.env,
    fetchImpl: opts.fetchImpl,
  });
  if (!res.ok) {
    const err = new Error(apiErrorMessage(res.body, res.status));
    err.status = res.status || 502;
    throw err;
  }
  const result = unwrapResult(res.body) || {};
  const stateId = result.State != null ? result.State : result.state;
  const trackingNo = String(result.TrackingNo || result.TrackingNumber || result.trackingNumber || "").trim();
  return {
    cargoKey: ref,
    state: mapTrackState(stateId),
    stateId: Number(stateId) || 0,
    docId: trackingNo,
    trackingUrl: String(result.TrackingUrl || result.trackingUrl || "").trim(),
    operationMessage: String(result.StateText || result.stateText || result.DeliveryDescription || "").trim(),
    errMessage: "",
  };
}

async function queryShipments(cargoKeys, options) {
  const keys = Array.isArray(cargoKeys) ? cargoKeys : [];
  const rows = [];
  for (const key of keys) {
    try {
      rows.push(await trackDelivery(key, options));
    } catch (err) {
      rows.push({
        cargoKey: key,
        state: "created",
        operationMessage: err && err.message ? String(err.message).slice(0, 160) : "TrackDelivery hata",
        errMessage: err && err.message ? String(err.message).slice(0, 160) : "",
      });
    }
  }
  return rows;
}

module.exports = {
  CARRIER_NAME,
  DEFAULT_BASE,
  DEFAULT_SENDER,
  LOGIN_PATH,
  MAX_REFERENCE_LENGTH,
  STATE_JOB,
  STATE_DELIVERED,
  kolayGelsinConfig,
  getConfig,
  extractToken,
  login,
  getToken,
  clearTokenCache,
  pingKolayGelsin,
  apiFetch,
  getCityDistricts,
  parseCityDistrictsBody,
  resolveSenderLocation,
  cargoKeyFor,
  normalizePhone,
  buildSetDeliveryPayload,
  setDelivery,
  createShipment,
  cancelDelivery,
  cancelShipment,
  trackDelivery,
  queryShipments,
  mapTrackState,
};
