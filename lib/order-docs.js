"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ATTACHMENT_TYPES, safeFilename } = require("./lead-reply");

const ORDER_DOC_KINDS = { invoice: "Fatura", return: "İade belgesi" };
const ORDER_DOC_EXTS = new Set(["pdf", "png", "jpg", "jpeg"]);
const MAX_ORDER_DOC_BYTES = 10 * 1024 * 1024;
const MAX_ORDER_DOC_REQUEST_BYTES = 15 * 1024 * 1024;
const MAX_DOCS_PER_ORDER = 20;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DOC_ID_RE = /^[a-f0-9]{16}$/;

function validateOrderDocInput(body) {
  const src = body && typeof body === "object" ? body : {};
  const kind = String(src.kind || "");
  if (!Object.prototype.hasOwnProperty.call(ORDER_DOC_KINDS, kind)) {
    return { ok: false, error: "Belge türü fatura veya iade belgesi olmalı." };
  }
  const filename = safeFilename(src.filename);
  const ext = ((/\.([a-z0-9]+)$/i.exec(filename) || [])[1] || "").toLowerCase();
  if (!filename || !ORDER_DOC_EXTS.has(ext)) {
    return { ok: false, error: "Yalnızca PDF, PNG veya JPG yükleyebilirsiniz." };
  }
  const data = String(src.dataBase64 || "");
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, error: filename + " okunamadı." };
  const content = Buffer.from(data, "base64");
  if (!content.length) return { ok: false, error: filename + " boş." };
  if (content.length > MAX_ORDER_DOC_BYTES) return { ok: false, error: "Dosya en fazla 10 MB olabilir." };
  const type = ATTACHMENT_TYPES[ext];
  if (!type.sniff(content)) return { ok: false, error: filename + " içeriği uzantısıyla uyuşmuyor." };
  return { ok: true, kind, filename, ext: ext === "jpeg" ? "jpg" : ext, content, contentType: type.contentType };
}

function createOrderDocStore(dataRoot) {
  const base = path.join(dataRoot, ".runtime", "order-docs");

  function dirFor(orderId) {
    if (!ORDER_ID_RE.test(String(orderId || ""))) return null;
    return path.join(base, orderId);
  }

  function list(orderId) {
    const dir = dirFor(orderId);
    if (!dir) return [];
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function writeIndex(dir, rows) {
    const file = path.join(dir, "index.json");
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 1), "utf8");
    fs.renameSync(tmp, file);
  }

  function add(orderId, input, meta) {
    const dir = dirFor(orderId);
    if (!dir) return { ok: false, error: "Geçersiz sipariş numarası." };
    const rows = list(orderId);
    if (rows.length >= MAX_DOCS_PER_ORDER) {
      return { ok: false, error: "Bir siparişe en fazla " + MAX_DOCS_PER_ORDER + " belge yüklenebilir." };
    }
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomBytes(8).toString("hex");
    fs.writeFileSync(path.join(dir, id + "." + input.ext), input.content);
    const doc = {
      id,
      kind: input.kind,
      filename: input.filename,
      ext: input.ext,
      contentType: input.contentType,
      size: input.content.length,
      at: ((meta && meta.now) || new Date()).toISOString(),
      by: String((meta && meta.by) || ""),
    };
    rows.push(doc);
    writeIndex(dir, rows);
    return { ok: true, doc };
  }

  function read(orderId, docId) {
    const dir = dirFor(orderId);
    if (!dir || !DOC_ID_RE.test(String(docId || ""))) return null;
    const doc = list(orderId).find((row) => row.id === docId);
    if (!doc) return null;
    try {
      return { doc, content: fs.readFileSync(path.join(dir, doc.id + "." + doc.ext)) };
    } catch (_) {
      return null;
    }
  }

  function remove(orderId, docId) {
    const dir = dirFor(orderId);
    if (!dir || !DOC_ID_RE.test(String(docId || ""))) return null;
    const rows = list(orderId);
    const doc = rows.find((row) => row.id === docId);
    if (!doc) return null;
    writeIndex(
      dir,
      rows.filter((row) => row.id !== docId)
    );
    try {
      fs.unlinkSync(path.join(dir, doc.id + "." + doc.ext));
    } catch (_) {}
    return doc;
  }

  return { list, add, read, remove };
}

const DOC_LINK_TTL_MS = 30 * 60 * 1000;

/** Short-lived signed view links so a plain target=_blank anchor can open a document without the session token. */
function createDocLinkSigner(secret) {
  const key = secret || crypto.randomBytes(32);
  const sign = (orderId, docId, exp) =>
    crypto.createHmac("sha256", key).update(orderId + "\n" + docId + "\n" + exp).digest("hex");
  function link(orderId, docId, nowMs) {
    const exp = Math.floor(((nowMs || Date.now()) + DOC_LINK_TTL_MS) / 1000);
    return (
      "/api/order-documents/" +
      encodeURIComponent(orderId) +
      "/" +
      encodeURIComponent(docId) +
      "?exp=" +
      exp +
      "&sig=" +
      sign(orderId, docId, exp)
    );
  }
  function verify(orderId, docId, exp, sig, nowMs) {
    const expNum = Number(exp);
    if (!Number.isInteger(expNum) || expNum * 1000 < (nowMs || Date.now())) return false;
    const expected = Buffer.from(sign(orderId, docId, expNum), "hex");
    const given = /^[a-f0-9]{64}$/.test(String(sig || "")) ? Buffer.from(sig, "hex") : null;
    return Boolean(given) && crypto.timingSafeEqual(expected, given);
  }
  return { link, verify };
}

module.exports = {
  DOC_LINK_TTL_MS,
  createDocLinkSigner,
  ORDER_DOC_KINDS,
  MAX_ORDER_DOC_BYTES,
  MAX_ORDER_DOC_REQUEST_BYTES,
  validateOrderDocInput,
  createOrderDocStore,
};
