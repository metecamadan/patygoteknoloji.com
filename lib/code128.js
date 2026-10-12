"use strict";

// Code 128 bar/space module widths, indexed by symbol value (ISO/IEC 15417 table).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;
const QUIET_MODULES = 10;

/** Code set B symbol values with the mod-103 check symbol; printable ASCII only. */
function encodeCode128B(text) {
  const value = String(text || "");
  if (!value || !/^[\x20-\x7e]+$/.test(value)) {
    throw new Error("Barkod yalnızca yazdırılabilir ASCII karakter içerebilir.");
  }
  const codes = [START_B];
  for (let i = 0; i < value.length; i += 1) codes.push(value.charCodeAt(i) - 32);
  let sum = START_B;
  for (let i = 1; i < codes.length; i += 1) sum += codes[i] * i;
  codes.push(sum % 103, STOP);
  return codes;
}

/** SVG in module units; the caller sets the printed width (keep a module above ~0.25 mm for branch scanners). */
function code128Svg(text, options) {
  const opts = options || {};
  const height = Number(opts.heightModules) || 60;
  const codes = encodeCode128B(text);
  let x = QUIET_MODULES;
  const bars = [];
  for (const code of codes) {
    const widths = PATTERNS[code];
    for (let i = 0; i < widths.length; i += 1) {
      const w = Number(widths[i]);
      if (i % 2 === 0) bars.push('<rect x="' + x + '" y="0" width="' + w + '" height="' + height + '"/>');
      x += w;
    }
  }
  const total = x + QUIET_MODULES;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    total +
    " " +
    height +
    '" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="' +
    String(text).replace(/[<>&"]/g, "") +
    '"' +
    (opts.width ? ' width="' + opts.width + '"' : "") +
    (opts.height ? ' height="' + opts.height + '"' : "") +
    '><rect width="100%" height="100%" fill="#fff"/><g fill="#000">' +
    bars.join("") +
    "</g></svg>"
  );
}

module.exports = { PATTERNS, encodeCode128B, code128Svg };
