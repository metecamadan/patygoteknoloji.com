const test = require("node:test");
const assert = require("node:assert/strict");
const { buildXlsx, crc32, columnName, safeSheetName, MAX_CELL_TEXT } = require("../lib/xlsx");
const { unzipEntries, sheetRows } = require("./helpers/unzip");

test("crc32 and column names follow the zip / spreadsheet conventions", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.from("6789"), crc32(Buffer.from("12345"))), 0xcbf43926);
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
  assert.equal(columnName(51), "AZ");
  assert.equal(columnName(52), "BA");
  assert.equal(safeSheetName("Fiyat/Alarm: [Talepler]*?"), "Fiyat Alarm   Talepler");
  assert.equal(safeSheetName("x".repeat(40)).length, 31);
});

test("workbook is a valid zip with typed cells, a frozen header and an autofilter", async () => {
  const buffer = await buildXlsx({
    sheetName: "XML Ürünleri",
    columns: [
      { header: "Ürün adı", width: 40 },
      { header: "Fiyat", type: "money" },
      { header: "Aktif" },
      { header: "Not" },
    ],
    rows: [
      ["Kablo <HDMI> & Adaptör \"2m\"", 1234.5, true, "=HYPERLINK(\"http://x\")"],
      ["Kontrol\u0001karakteri", null, false, "x".repeat(MAX_CELL_TEXT + 50)],
      ["Boş fiyat", Number.NaN, undefined, ""],
    ],
  });
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  const files = unzipEntries(buffer);
  assert.deepEqual(Object.keys(files).sort(), [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
  ]);
  assert.match(files["xl/workbook.xml"], /<sheet name="XML Ürünleri" sheetId="1" r:id="rId1"\/>/);
  assert.match(files["xl/workbook.xml"], /'XML Ürünleri'!\$A\$1:\$D\$4/);

  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<autoFilter ref="A1:D4"\/>/);
  assert.match(sheet, /<col min="1" max="1" width="40" customWidth="1"\/>/);
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sheet, /<c r="B2" s="2"><v>1234.5<\/v><\/c>/);
  // Formula-looking text stays a string cell; Excel never evaluates it.
  assert.match(sheet, /<c r="D2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;http:\/\/x&quot;\)<\/t>/);
  assert.doesNotMatch(sheet, /<f>/);
  assert.doesNotMatch(sheet, /<c r="B3"/);
  assert.doesNotMatch(sheet, /<c r="B4"/);

  const rows = sheetRows(sheet);
  assert.deepEqual(rows[0], ["Ürün adı", "Fiyat", "Aktif", "Not"]);
  assert.equal(rows[1][0], 'Kablo <HDMI> & Adaptör "2m"');
  assert.equal(rows[1][2], "Evet");
  assert.equal(rows[2][0], "Kontrolkarakteri");
  assert.equal(rows[2][2], "Hayır");
  assert.equal(rows[2][3].length, MAX_CELL_TEXT);
  assert.ok(rows[2][3].endsWith("…"));
});

test("large sheets stream through without blocking and keep every row", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ["Ürün " + i, i]);
  const files = unzipEntries(await buildXlsx({ sheetName: "Büyük", columns: [{ header: "Ad" }, { header: "No" }], rows }));
  const parsed = sheetRows(files["xl/worksheets/sheet1.xml"]);
  assert.equal(parsed.length, 2501);
  assert.deepEqual(parsed[2500], ["Ürün 2499", "2499"]);
});
