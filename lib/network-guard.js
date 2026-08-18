"use strict";

const dns = require("dns").promises;
const { isPrivateIp } = require("./supplier");

async function assertPublicHost(hostname, resolveHost) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host || host === "localhost") {
    throw new Error("Özel ağ adreslerine erişim engellendi.");
  }
  const lookup = typeof resolveHost === "function" ? resolveHost : dns.lookup;
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch (_) {
    throw new Error("Sunucu adresi çözümlenemedi.");
  }
  if (!addresses.length || addresses.some((row) => isPrivateIp(row.address))) {
    throw new Error("Özel ağ adreslerine erişim engellendi.");
  }
}

function parseHttpUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch (_) {
    return null;
  }
}

async function assertPublicHttpUrl(rawUrl, resolveHost) {
  const url = parseHttpUrl(rawUrl);
  if (!url) throw new Error("Geçersiz URL.");
  await assertPublicHost(url.hostname, resolveHost);
  return url;
}

module.exports = {
  assertPublicHost,
  assertPublicHttpUrl,
  parseHttpUrl,
};
