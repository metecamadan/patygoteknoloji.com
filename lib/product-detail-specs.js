"use strict";

function parseProductSpecChips(name) {
  const text = String(name || "").trim();
  if (!text) return [];
  const chips = [];
  const seen = new Set();
  function add(label) {
    const key = String(label || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    chips.push(label);
  }

  const screen =
    text.match(/(\d+(?:[.,]\d+)?)\s*"/) ||
    text.match(/(\d+(?:[.,]\d+)?)\s*(?:inch|inç)\b/i);
  if (screen) add(String(screen[1]).replace(",", ".") + '" Ekran');

  const res = text.match(/(\d{3,4}\s*[x×]\s*\d{3,4})/i);
  if (res) add(String(res[1]).replace(/\s+/g, "").replace(/×/g, "x"));

  const refresh = text.match(/(\d{2,3})\s*hz\b/i);
  if (refresh) add(refresh[1] + " Hz");

  const response = text.match(/(\d+(?:[.,]\d+)?)\s*ms\b/i);
  if (response) add(response[1].replace(",", ".") + " ms");

  const panel = text.match(/\b(ips|tn|va|oled)\b/i);
  if (panel) add(panel[1].toUpperCase() + " Panel");

  const ramExplicit = text.match(/(\d+)\s*gb\s*ram\b/i);
  const ramImplicit =
    !ramExplicit &&
    /\b(?:ssd|nvme|hdd)\b/i.test(text) &&
    text.match(/(\d+)\s*gb(?!\s*(?:ssd|nvme|hdd|tb|gddr|vram|grafik))/i);
  if (ramExplicit) add(ramExplicit[1] + " GB RAM");
  else if (ramImplicit) add(ramImplicit[1] + " GB RAM");

  const ssd = text.match(/(\d+)\s*gb\s*ssd\b/i);
  if (ssd) add(ssd[1] + " GB SSD");

  const nvme = text.match(/(\d+)\s*gb\s*nvme\b/i);
  if (nvme) add(nvme[1] + " GB NVMe");

  const tb = text.match(/(\d+)\s*tb\b/i);
  if (tb && !ssd && !nvme) add(tb[1] + " TB Depolama");

  const intelCore = text.match(/intel\s+core\s+(i[3579])\s*-?\s*(\d+[a-z]*)/i);
  if (intelCore) {
    add(
      "Intel Core " +
        intelCore[1].toLowerCase() +
        "-" +
        String(intelCore[2]).toUpperCase()
    );
  } else {
    const ultra = text.match(/(?:intel\s+)?core\s+ultra\s*(\d+)\s*(\d+[a-z]*)/i);
    if (ultra) add("Intel Core Ultra " + ultra[1] + " " + String(ultra[2]).toUpperCase());
    const genericIntel = text.match(/intel\s+(i[3579])\s*-?\s*(\d+[a-z]*)/i);
    if (genericIntel && !intelCore && !ultra) {
      add("Intel " + genericIntel[1].toUpperCase() + "-" + String(genericIntel[2]).toUpperCase());
    }
  }

  const amd = text.match(/amd\s+ryzen\s*(\d+\s*\w*)/i);
  if (amd) add("AMD Ryzen " + amd[1].trim());

  const gpu =
    text.match(/(geforce\s*(?:rtx|gtx)\s*\d+\s*\w*)/i) ||
    text.match(/(radeon\s*(?:rx)?\s*\d+\s*\w*)/i);
  if (gpu) add(gpu[1].trim());

  const ddr = text.match(/\b(ddr[345])\b/i);
  if (ddr) add(ddr[1].toUpperCase());

  const mhz = text.match(/(\d{4,5})\s*mhz/i);
  if (mhz) add(mhz[1] + " MHz");

  const cl = text.match(/\bcl\s*(\d{1,2})\b/i);
  if (cl) add("CL" + cl[1]);

  const watt = text.match(/(\d{3,4})\s*w\b/i);
  if (watt) add(watt[1] + " W");

  const socket = text.match(/\b(?:soket|socket)\s*(lga\s*\d+|am[45]|s\d+)\b/i);
  if (socket) add("Soket " + socket[1].replace(/\s+/g, " ").toUpperCase());

  const chipset = text.match(/\b([bzxqhm]\d{3,4}[a-z]?|x\d{3,4}[a-z]?|a\d{3,4}[a-z]?)\b/i);
  if (chipset && /anakart|motherboard|mainboard/i.test(text)) add(chipset[1].toUpperCase() + " Chipset");

  if (/\bfreedos\b/i.test(text)) add("FreeDOS");
  else if (/\bwindows\s*11\b/i.test(text)) add("Windows 11");
  else if (/\bwindows\s*10\b/i.test(text)) add("Windows 10");

  if (/\bwifi\s*6e\b/i.test(text)) add("Wi-Fi 6E");
  else if (/\bwifi\s*6\b/i.test(text)) add("Wi-Fi 6");
  else if (/\bwifi\s*5\b/i.test(text)) add("Wi-Fi 5");

  if (/\bbluetooth\b/i.test(text)) add("Bluetooth");

  if (/\b80\s*\+\s*platinum\b/i.test(text)) add("80+ Platinum");
  else if (/\b80\s*\+\s*gold\b/i.test(text)) add("80+ Gold");
  else if (/\b80\s*\+\s*bronze\b/i.test(text)) add("80+ Bronze");

  const va = text.match(/(\d{3,5})\s*va\b/i);
  if (va) add(va[1] + " VA");

  const ppm = text.match(/(\d+)\s*ppm\b/i);
  if (ppm) add(ppm[1] + " ppm");

  const dpi = text.match(/(\d{3,5})\s*dpi\b/i);
  if (dpi) add(dpi[1] + " dpi");

  return chips.slice(0, 12);
}

function parseProductDetailSpecTable(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  if (lines[0] === "__SPEC_TABLE__") lines.shift();
  const rows = [];
  lines.forEach((line) => {
    const pipe = line.indexOf("|");
    if (pipe <= 0) return;
    const label = line.slice(0, pipe).trim();
    const value = line.slice(pipe + 1).trim();
    if (label && value) rows.push({ label, value });
  });
  return rows;
}

function normalizeResolutionFromTitle(name) {
  const text = String(name || "");
  const exactMatch = text.match(/(\d{3,4}\s*[x×]\s*\d{3,4})/i);
  const compact = exactMatch
    ? String(exactMatch[1] || exactMatch[0]).replace(/\s+/g, "").replace(/×/g, "x")
    : "";
  if (/\b4k\b|\buhd\b/i.test(text)) {
    return (compact || "3840x2160") + " (4K UHD)";
  }
  if (/\bqhd\b/i.test(text)) {
    return (compact || "2560x1440") + " (QHD)";
  }
  if (/\bfhd\b|\bfull\s*hd\b/i.test(text)) {
    return (compact || "1920x1080") + " FHD";
  }
  return compact || "";
}

function extractMonitorPorts(name) {
  const ports = [];
  if (/\bvga\b/i.test(name)) ports.push("VGA");
  if (/\bhdmi\b/i.test(name)) ports.push("HDMI");
  if (/\bdisplay\s*port\b/i.test(name)) ports.push("DisplayPort");
  else if (/\bdp\b/i.test(name)) ports.push("DisplayPort");
  if (/\busb\s*-?\s*c\b/i.test(name)) ports.push("USB-C");
  if (/\bdvi\b/i.test(name)) ports.push("DVI");
  return ports.join(" + ");
}

module.exports = {
  parseProductSpecChips,
  parseProductDetailSpecTable,
  normalizeResolutionFromTitle,
  extractMonitorPorts,
};
