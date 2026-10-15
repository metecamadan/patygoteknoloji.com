const zlib = require("node:zlib");
const { crc32 } = require("../../lib/xlsx");

/** Reads a zip via its central directory; verifies each entry's CRC and size. Returns { name: text }. */
function unzipEntries(buffer) {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error("zip end record missing");
  const count = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central header");
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const compSize = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLen);
    if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("bad local header for " + name);
    const localName = buffer.readUInt16LE(offset + 26);
    const localExtra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const raw = buffer.subarray(start, start + compSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (data.length !== size) throw new Error("size mismatch for " + name);
    if (crc32(data) !== crc) throw new Error("crc mismatch for " + name);
    files[name] = data.toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Sheet rows as arrays of cell text (inline strings and numbers), header row first. */
function sheetRows(sheetXml) {
  const rows = [];
  const rowRe = /<row r="(\d+)">([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetXml))) {
    const cells = [];
    const cellRe = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const col = cellMatch[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const inner = cellMatch[2] || "";
      const textMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const raw = textMatch ? textMatch[1] : valueMatch ? valueMatch[1] : "";
      cells[col] = raw
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
    }
    rows.push(cells);
  }
  return rows;
}

/** Header row + data rows as objects keyed by header text. */
function sheetObjects(sheetXml) {
  const [header, ...rest] = sheetRows(sheetXml);
  return rest.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] === undefined ? "" : cells[i]])));
}

module.exports = { unzipEntries, sheetRows, sheetObjects };
