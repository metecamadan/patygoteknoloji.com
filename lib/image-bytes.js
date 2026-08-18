"use strict";

function imageExtensionFromBytes(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (
    b.length >= 12 &&
    b.slice(0, 4).toString("ascii") === "RIFF" &&
    b.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return "";
}

module.exports = {
  imageExtensionFromBytes,
};
