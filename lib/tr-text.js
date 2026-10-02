/**
 * Same result as value.toLocaleLowerCase("tr-TR"), ~10x faster: ICU locale casing is a hot spot
 * when 17k supplier rows are hydrated. Turkish only differs from root casing for I / İ / I+U+0307.
 */
function trLowerCase(value) {
  const text = String(value == null ? "" : value);
  if (!/[Iİ]/.test(text)) return text.toLowerCase();
  return text.replace(/I\u0307/g, "i").replace(/I/g, "ı").replace(/İ/g, "i").toLowerCase();
}

module.exports = { trLowerCase };
