(function (root) {
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

    const ram = text.match(/(\d+)\s*gb\s*ram\b/i);
    if (ram) add(ram[1] + " GB RAM");

    const ssd = text.match(/(\d+)\s*gb\s*ssd\b/i);
    if (ssd) add(ssd[1] + " GB SSD");

    const tb = text.match(/(\d+)\s*tb\b/i);
    if (tb && !ssd) add(tb[1] + " TB Depolama");

    const intelCore = text.match(/intel\s+core\s+(i[3579])\s*-?\s*(\d+[a-z]*)/i);
    if (intelCore) {
      add(
        "Intel Core " +
          intelCore[1].toLowerCase() +
          "-" +
          String(intelCore[2]).toUpperCase()
      );
    } else {
      const ultra = text.match(/ultra\s*(\d+)\s*(\d+[a-z]*)/i);
      if (ultra) add("Intel Core Ultra " + ultra[1] + " " + String(ultra[2]).toUpperCase());
    }

    const amd = text.match(/amd\s+ryzen\s*(\d+\s*\w*)/i);
    if (amd) add("AMD Ryzen " + amd[1].trim());

    if (/\bfreedos\b/i.test(text)) add("FreeDOS");
    else if (/\bwindows\s*11\b/i.test(text)) add("Windows 11");
    else if (/\bwindows\s*10\b/i.test(text)) add("Windows 10");

    if (/\bddr5\b/i.test(text)) add("DDR5");

    return chips.slice(0, 8);
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

  root.PatygoDetailSpecs = { parseProductSpecChips, parseProductDetailSpecTable };
})(typeof window !== "undefined" ? window : globalThis);
