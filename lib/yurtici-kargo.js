"use strict";

const { XMLParser } = require("fast-xml-parser");

const CARRIER_NAME = "Yurtiçi Kargo";
const ENDPOINTS = {
  test: "https://testws.yurticikargo.com/KOPSWebServices/ShippingOrderDispatcherServices",
  live: "https://ws.yurticikargo.com/KOPSWebServices/ShippingOrderDispatcherServices",
};
const SOAP_NS = "http://yurticikargo.com.tr/ShippingOrderDispatcherServices";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_KEY_LENGTH = 20;

const ERR_CARGO_KEY_EXISTS = "60020";
const ERR_CARGO_KEY_NOT_FOUND = "82519";
const ERR_ALREADY_CANCELLED = "82520";

/** Yurtiçi accepts calls only from IPs registered with them, so requests must leave from the VPS. */
function yurticiConfig(env) {
  const source = env || process.env;
  const user = String(source.YURTICI_WS_USER || "").trim();
  const password = String(source.YURTICI_WS_PASSWORD || "").trim();
  const mode = String(source.YURTICI_MODE || "").trim().toLowerCase() === "live" ? "live" : "test";
  return {
    configured: Boolean(user && password),
    user,
    password,
    mode,
    language: String(source.YURTICI_LANGUAGE || "TR").trim() || "TR",
    endpoint: ENDPOINTS[mode],
  };
}

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fieldsXml(fields) {
  return Object.keys(fields)
    .map((name) => {
      const value = fields[name];
      if (value == null || value === "") return "";
      if (Array.isArray(value)) return value.map((item) => "<" + name + ">" + xmlEscape(item) + "</" + name + ">").join("");
      return "<" + name + ">" + xmlEscape(value) + "</" + name + ">";
    })
    .join("");
}

function soapEnvelope(operation, innerXml) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ship="' +
    SOAP_NS +
    '"><soapenv:Header/><soapenv:Body><ship:' +
    operation +
    ">" +
    innerXml +
    "</ship:" +
    operation +
    "></soapenv:Body></soapenv:Envelope>"
  );
}

/** One cargo key per attempt: a cancelled key cannot be reused at Yurtiçi. */
function cargoKeyFor(orderId, attempt) {
  const base = String(orderId || "").trim();
  const n = Number(attempt) || 1;
  const key = n > 1 ? base + "-" + n : base;
  if (!base || key.length > MAX_KEY_LENGTH) {
    throw new Error("Kargo anahtarı 20 karakteri aşıyor: " + key);
  }
  return key;
}

/** Yurtiçi wants the 10-digit national number (area code + subscriber), no 0 or +90 prefix. */
function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) throw new Error("Alıcı telefonu 10 haneli olmalı (5xx xxx xx xx).");
  return digits;
}

/** The checkout stores "line, district / city"; Yurtiçi wants the street part without city/district. */
function receiverStreet(customer) {
  const c = customer || {};
  const city = String(c.shippingCity || "").trim();
  const district = String(c.shippingDistrict || "").trim();
  let text = String(c.shippingAddress || c.billingAddress || "").trim();
  const suffix = district && city ? ", " + district + " / " + city : "";
  if (suffix && text.endsWith(suffix)) text = text.slice(0, -suffix.length).trim();
  return text.replace(/\s+/g, " ").slice(0, 200);
}

function positiveNumber(value) {
  const n = Math.round(Number(value) * 1000) / 1000;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildShippingOrderVO(order, options) {
  const opts = options || {};
  const c = (order && order.customer) || {};
  const name = String(c.company || c.name || "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (name.replace(/[^\p{L}]/gu, "").length < 4 || name.length < 5) {
    throw new Error("Alıcı adı en az 5 karakter olmalı.");
  }
  const street = receiverStreet(c);
  if (street.length < 5) throw new Error("Alıcı açık adresi eksik.");
  const city = String(c.shippingCity || "").trim().slice(0, 40);
  const town = String(c.shippingDistrict || "").trim().slice(0, 40);
  if (!city || !town) throw new Error("Teslimat il/ilçe bilgisi eksik.");
  // Keys follow the WSDL sequence. The four xs:long fields are mandatory; 0 means "not given" to Yurtiçi.
  return {
    cargoKey: opts.cargoKey,
    invoiceKey: opts.cargoKey,
    receiverCustName: name,
    receiverAddress: street,
    cityName: city,
    townName: town,
    receiverPhone1: normalizePhone(c.phone),
    emailAddress: String(c.email || "").trim().slice(0, 200),
    taxOfficeId: 0,
    desi: positiveNumber(opts.desi),
    kg: positiveNumber(opts.kg),
    cargoCount: 1,
    waybillNo: opts.waybillNo ? String(opts.waybillNo).trim().slice(0, MAX_KEY_LENGTH) : "",
    ttDocumentId: 0,
    dcSelectedCredit: 0,
    dcCreditRule: 0,
    description: ("Patygo sipariş " + order.id).slice(0, 255),
  };
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

function firstOf(value) {
  return Array.isArray(value) ? value[0] : value;
}

function listOf(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

/** Finds the result object (the one carrying outFlag) whether or not Yurtiçi wrapped it in a *VO element. */
function findResult(node, depth) {
  if (!node || typeof node !== "object" || depth > 4) return null;
  if (Object.prototype.hasOwnProperty.call(node, "outFlag")) return node;
  for (const key of Object.keys(node)) {
    const found = findResult(firstOf(node[key]), depth + 1);
    if (found) return found;
  }
  return null;
}

function parseSoapResult(xml, operation) {
  let doc;
  try {
    doc = parser.parse(String(xml || ""));
  } catch (_) {
    throw new Error("Yurtiçi yanıtı okunamadı.");
  }
  const body = doc && doc.Envelope && doc.Envelope.Body;
  if (!body) throw new Error("Yurtiçi yanıtı okunamadı.");
  if (body.Fault) {
    const fault = body.Fault;
    const wsException = fault.detail && fault.detail.YurticikargoWSException;
    const text = (wsException && str(wsException, "errText")) || fault.faultstring || fault.faultcode || "SOAP fault";
    throw new Error("Yurtiçi hatası: " + String(text).slice(0, 200));
  }
  const result = findResult(body[operation + "Response"] || body, 0);
  if (!result) throw new Error("Yurtiçi yanıtında sonuç yok.");
  return result;
}

async function callSoap(cfg, operation, innerXml, options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  let res;
  try {
    res = await fetchImpl(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: soapEnvelope(operation, innerXml),
      signal: AbortSignal.timeout(opts.timeoutMs || REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    throw new Error("Yurtiçi servisine ulaşılamadı: " + msg.slice(0, 160));
  }
  const text = await res.text();
  if (!res.ok && !/Envelope/.test(text)) {
    throw new Error("Yurtiçi servisi HTTP " + res.status + " döndü.");
  }
  return parseSoapResult(text, operation);
}

function auth(cfg, languageField) {
  return { wsUserName: cfg.user, wsPassword: cfg.password, [languageField]: cfg.language };
}

function requireConfig(env) {
  const cfg = yurticiConfig(env);
  if (!cfg.configured) throw new Error("Yurtiçi Kargo bilgileri .env içinde tanımlı değil.");
  return cfg;
}

function detailMessage(detail, result) {
  return String(
    (detail && (detail.errMessage || detail.operationMessage)) || (result && result.outResult) || "Bilinmeyen hata"
  ).slice(0, 300);
}

async function createShipment(order, options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const vo = buildShippingOrderVO(order, opts);
  const inner = fieldsXml(auth(cfg, "userLanguage")) + "<ShippingOrderVO>" + fieldsXml(vo) + "</ShippingOrderVO>";
  const result = await callSoap(cfg, "createShipment", inner, opts);
  const detail = firstOf(result.shippingOrderDetailVO) || {};
  const errCode = String(detail.errCode || "").trim();
  if (String(result.outFlag) === "0" && (!errCode || errCode === "0")) {
    return { cargoKey: vo.cargoKey, jobId: String(result.jobId || "") || null, alreadyExisted: false, mode: cfg.mode };
  }
  // The key is already on file at Yurtiçi (e.g. a retry after a lost response): the shipment exists.
  if (errCode === ERR_CARGO_KEY_EXISTS) {
    return { cargoKey: vo.cargoKey, jobId: null, alreadyExisted: true, mode: cfg.mode };
  }
  const err = new Error("Yurtiçi gönderiyi kabul etmedi: " + detailMessage(detail, result));
  err.code = errCode || String(result.outFlag || "");
  throw err;
}

const RETURNING_REJECT = new Set(["0", "1", "2", "3", "9", "10"]);

/** Collapses Yurtiçi's operation/return flags into the states the store acts on. */
function shipmentStateOf(row) {
  if (row.errCode === ERR_CARGO_KEY_NOT_FOUND) return "created";
  if (row.returnStatus === "3") return "returned";
  if (RETURNING_REJECT.has(row.rejectStatus)) return "returning";
  if (row.operationCode === "5" || row.documentDelFlag === "1") return "delivered";
  if (row.operationCode === "3" || row.operationCode === "4" || row.operationCode === "6") return "cancelled";
  if (row.docId) return "in_transit";
  return "created";
}

function str(node, key) {
  const value = node && node[key];
  if (value == null) return "";
  return String(typeof value === "object" ? "" : value).trim();
}

function safeHttpUrl(raw) {
  const value = String(raw || "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value.slice(0, 500) : "";
}

async function queryShipments(cargoKeys, options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const keys = listOf(cargoKeys).map((key) => String(key || "").trim()).filter(Boolean);
  if (!keys.length) return [];
  const inner =
    fieldsXml(auth(cfg, "wsLanguage")) +
    fieldsXml({ keys }) +
    fieldsXml({ keyType: 0, addHistoricalData: "false", onlyTracking: "false" });
  const result = await callSoap(cfg, "queryShipment", inner, opts);
  if (String(result.outFlag) === "2") {
    throw new Error("Yurtiçi sorgu hatası: " + String(result.outResult || "").slice(0, 200));
  }
  return listOf(result.shippingDeliveryDetailVO).map((detail) => {
    const item = firstOf(detail.shippingDeliveryItemDetailVO) || {};
    const row = {
      cargoKey: str(detail, "cargoKey"),
      operationCode: str(detail, "operationCode"),
      operationStatus: str(detail, "operationStatus"),
      operationMessage: str(detail, "operationMessage"),
      errCode: str(detail, "errCode") === "0" ? "" : str(detail, "errCode"),
      errMessage: str(detail, "errMessage"),
      docId: str(item, "docId") || str(detail, "docId"),
      trackingUrl: safeHttpUrl(str(item, "trackingUrl")),
      documentDelFlag: str(item, "documentDelFlag"),
      returnStatus: str(item, "returnStatus"),
      rejectStatus: str(item, "rejectStatus"),
    };
    row.state = shipmentStateOf(row);
    return row;
  });
}

/** Setup check from the VPS: an unknown key must come back as "not found", which proves credentials and IP. */
async function pingYurtici(options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const inner =
    fieldsXml(auth(cfg, "wsLanguage")) +
    fieldsXml({ keys: ["PATYGO-PING"], keyType: 0, addHistoricalData: "false", onlyTracking: "false" });
  const result = await callSoap(cfg, "queryShipment", inner, opts);
  const detail = firstOf(result.shippingDeliveryDetailVO) || {};
  const errCode = str(detail, "errCode");
  return {
    ok: errCode === ERR_CARGO_KEY_NOT_FOUND,
    mode: cfg.mode,
    outFlag: String(result.outFlag || ""),
    message: detailMessage(detail, result),
  };
}

/** Only possible before the branch has turned the key into a waybill. */
async function cancelShipment(cargoKey, options) {
  const opts = options || {};
  const cfg = requireConfig(opts.env);
  const inner = fieldsXml(auth(cfg, "userLanguage")) + fieldsXml({ cargoKeys: [cargoKey] });
  const result = await callSoap(cfg, "cancelShipment", inner, opts);
  const detail = firstOf(result.shippingCancelDetailVO) || {};
  const errCode = String(detail.errCode || "").trim();
  const operationCode = String(detail.operationCode || "").trim();
  if (errCode === ERR_ALREADY_CANCELLED || operationCode === "3" || operationCode === "4") {
    return { cancelled: true, message: detailMessage(detail, result) };
  }
  return { cancelled: false, code: errCode || operationCode || null, message: detailMessage(detail, result) };
}

module.exports = {
  CARRIER_NAME,
  ENDPOINTS,
  yurticiConfig,
  cargoKeyFor,
  normalizePhone,
  receiverStreet,
  buildShippingOrderVO,
  soapEnvelope,
  parseSoapResult,
  shipmentStateOf,
  createShipment,
  queryShipments,
  cancelShipment,
  pingYurtici,
};
