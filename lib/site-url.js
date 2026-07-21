function resolveSiteBaseUrl(raw, port, isProduction) {
  const fallback = `http://localhost:${port}`;
  const value = String(raw || fallback).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error("SITE_BASE_URL geçerli bir URL olmalıdır (örn. https://patygoteknoloji.com).");
  }
  const host = parsed.hostname || "";
  const isLocalHost =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  const isIpHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (isProduction) {
    if (!raw) {
      throw new Error("Canlı ortamda SITE_BASE_URL zorunludur (https://patygoteknoloji.com).");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("Canlı ortamda SITE_BASE_URL https ile başlamalıdır.");
    }
    if (isLocalHost || isIpHost) {
      throw new Error(
        "Canlı ortamda SITE_BASE_URL IP veya localhost olamaz; alan adı kullanın (https://patygoteknoloji.com)."
      );
    }
  }
  return value;
}

module.exports = { resolveSiteBaseUrl };
