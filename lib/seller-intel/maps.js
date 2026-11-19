"use strict";

const { phoneKey } = require("./parse");

const TURKEY = { minLat: 35.5, maxLat: 42.3, minLon: 25.5, maxLon: 44.9 };

function inTurkey(lat, lon) {
  return lat >= TURKEY.minLat && lat <= TURKEY.maxLat && lon >= TURKEY.minLon && lon <= TURKEY.maxLon;
}

function googleCountry(place) {
  const parts = place.addressComponents || place.address_components || [];
  const country = parts.find((part) => (part.types || []).includes("country"));
  if (!country) return "";
  return String(country.shortText || country.short_name || "").toUpperCase();
}

function mapRecord(row) {
  return {
    ad: row.ad,
    unvan: row.ad,
    sehir: row.sehir || "",
    kanal: "harita",
    site: row.site || "",
    telefon: row.telefon || "",
    eposta: "",
    kategori: row.kategori || "elektronik",
    kaynak: row.kaynak,
  };
}

async function collectMapSellers({ googleKey, yandexKey, query, kategori, fetchImpl }) {
  const skipped = [];
  const records = [];
  const term = query || "elektronik mağaza";
  if (!googleKey) {
    skipped.push({ kaynak: "google", neden: "API anahtarı yok" });
  } else {
    const response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": googleKey,
        "x-goog-fieldmask":
          "places.displayName,places.nationalPhoneNumber,places.websiteUri,places.addressComponents,places.location",
      },
      body: JSON.stringify({ textQuery: term, regionCode: "TR", languageCode: "tr" }),
    });
    if (!response.ok) {
      skipped.push({ kaynak: "google", neden: `HTTP ${response.status}` });
    } else {
      const body = await response.json();
      for (const place of body.places || []) {
        if (googleCountry(place) !== "TR") continue;
        const loc = place.location || {};
        if (loc.latitude != null && !inTurkey(loc.latitude, loc.longitude)) continue;
        records.push(
          mapRecord({
            ad: place.displayName && place.displayName.text,
            telefon: place.nationalPhoneNumber || "",
            site: place.websiteUri || "",
            kategori,
            kaynak: "google-places",
          })
        );
      }
    }
  }
  if (!yandexKey) {
    skipped.push({ kaynak: "yandex", neden: "API anahtarı yok" });
  } else {
    const url = new URL("https://search-maps.yandex.ru/v1/");
    url.searchParams.set("apikey", yandexKey);
    url.searchParams.set("text", term);
    url.searchParams.set("type", "biz");
    url.searchParams.set("lang", "tr_TR");
    url.searchParams.set("ll", "35.0,39.0");
    url.searchParams.set("spn", "18,6");
    url.searchParams.set("results", "20");
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      skipped.push({ kaynak: "yandex", neden: `HTTP ${response.status}` });
    } else {
      const body = await response.json();
      for (const feature of (body.features || [])) {
        const [lon, lat] = (feature.geometry && feature.geometry.coordinates) || [];
        if (!inTurkey(lat, lon)) continue;
        const meta = (feature.properties && feature.properties.CompanyMetaData) || {};
        const phone = (meta.Phones && meta.Phones[0] && meta.Phones[0].formatted) || "";
        records.push(
          mapRecord({
            ad: (feature.properties && feature.properties.name) || meta.name,
            telefon: phoneKey(phone) ? phone : "",
            site: meta.url || "",
            kategori,
            kaynak: "yandex-maps",
          })
        );
      }
    }
  }
  return { kayitlar: records.filter((row) => row.ad), atlanan: skipped };
}

module.exports = { collectMapSellers, inTurkey };
