"use strict";

/**
 * Minimal single-sheet .xlsx writer (Office Open XML in a zip). Strings are written as
 * inline strings, so a cell starting with "=" stays text and is never evaluated as a formula.
 */
const zlib = require("zlib");

const MAX_CELL_TEXT = 32767;
const ROWS_PER_TICK = 400;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf, previous) {
  let c = ((previous || 0) ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cellText(value) {
  let text = String(value).replace(INVALID_XML_CHARS, "");
  if (text.length > MAX_CELL_TEXT) {
    text = text.slice(0, MAX_CELL_TEXT - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
  }
  return escapeXml(text);
}

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const STYLE_HEADER = 1;
const STYLE_MONEY = 2;

function cellXml(ref, value, style) {
  if (value === null || value === undefined || value === "") return "";
  const s = style ? ' s="' + style + '"' : "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? '<c r="' + ref + '"' + s + "><v>" + value + "</v></c>" : "";
  }
  const text = typeof value === "boolean" ? (value ? "Evet" : "Hayır") : value;
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + cellText(text) + "</t></is></c>";
}

function safeSheetName(name) {
  const cleaned = String(name || "Sayfa1").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned || "Sayfa1";
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

const WORKBOOK_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="' + NS_REL + '/styles" Target="styles.xml"/>' +
  "</Relationships>";

const STYLES =
  XML_HEAD +
  '<styleSheet xmlns="' + NS_MAIN + '">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

function workbookXml(sheetName, lastRef) {
  const quoted = "'" + escapeXml(sheetName).replace(/'/g, "''") + "'";
  return (
    XML_HEAD +
    '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
    '<sheets><sheet name="' + escapeXml(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
    quoted + "!$A$1:" + lastRef.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2") +
    "</definedName></definedNames>" +
    "</workbook>"
  );
}

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

function deflateEntry(name, text) {
  const raw = Buffer.from(text, "utf8");
  return { name, crc: crc32(raw), size: raw.length, data: zlib.deflateRawSync(raw) };
}

async function deflateSheet(columns, rows) {
  const deflate = zlib.createDeflateRaw({ level: 6 });
  const out = [];
  deflate.on("data", (chunk) => out.push(chunk));
  const finished = new Promise((resolve, reject) => {
    deflate.on("end", resolve);
    deflate.on("error", reject);
  });
  let crc = 0;
  let size = 0;
  const write = async (text) => {
    const buf = Buffer.from(text, "utf8");
    crc = crc32(buf, crc);
    size += buf.length;
    if (!deflate.write(buf)) await new Promise((resolve) => deflate.once("drain", resolve));
  };

  const lastCol = columnName(Math.max(0, columns.length - 1));
  const lastRow = rows.length + 1;
  let head =
    XML_HEAD +
    '<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/><cols>';
  columns.forEach((column, i) => {
    const width = Math.max(6, Math.min(80, Number(column.width) || 14));
    head += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>';
  });
  head += '</cols><sheetData><row r="1">';
  columns.forEach((column, i) => {
    head += cellXml(columnName(i) + "1", String(column.header || ""), STYLE_HEADER);
  });
  head += "</row>";
  await write(head);

  for (let start = 0; start < rows.length; start += ROWS_PER_TICK) {
    let chunk = "";
    const end = Math.min(rows.length, start + ROWS_PER_TICK);
    for (let r = start; r < end; r += 1) {
      const rowNumber = r + 2;
      const values = rows[r] || [];
      chunk += '<row r="' + rowNumber + '">';
      for (let c = 0; c < columns.length; c += 1) {
        const style = columns[c].type === "money" && typeof values[c] === "number" ? STYLE_MONEY : 0;
        chunk += cellXml(columnName(c) + rowNumber, values[c], style);
      }
      chunk += "</row>";
    }
    await write(chunk);
    await new Promise((resolve) => setImmediate(resolve));
  }
  await write('</sheetData><autoFilter ref="A1:' + lastCol + lastRow + '"/></worksheet>');
  deflate.end();
  await finished;
  return { name: "xl/worksheets/sheet1.xml", crc, size, data: Buffer.concat(out), lastRef: lastCol + lastRow };
}

function zipEntries(entries, when) {
  const { time, day } = dosDateTime(when);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat(centrals, [end]));
}

/**
 * columns: [{ header, width?, type?: "money" }]; rows: arrays aligned with columns.
 * Numbers stay numeric (summable in Excel); booleans become "Evet"/"Hayır".
 */
async function buildXlsx(options) {
  const opts = options || {};
  const columns = Array.isArray(opts.columns) ? opts.columns : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const sheetName = safeSheetName(opts.sheetName);
  const sheet = await deflateSheet(columns, rows);
  return zipEntries(
    [
      deflateEntry("[Content_Types].xml", CONTENT_TYPES),
      deflateEntry("_rels/.rels", ROOT_RELS),
      deflateEntry("xl/workbook.xml", workbookXml(sheetName, sheet.lastRef)),
      deflateEntry("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
      deflateEntry("xl/styles.xml", STYLES),
      sheet,
    ],
    opts.now
  );
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

module.exports = { buildXlsx, crc32, columnName, safeSheetName, XLSX_MIME, MAX_CELL_TEXT };
