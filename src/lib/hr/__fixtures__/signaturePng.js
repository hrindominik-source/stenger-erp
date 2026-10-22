// Realisticky podpis 200x60 (DB vyzaduje 100 B - 300 kB).
// Testovaci "podpis" pre integracne testy (PNG s cmarou, bez zavislosti).
import zlib from "node:zlib";

export function signaturePng(seed = 0) {
  const w = 200, h = 60, raw = Buffer.alloc((w * 4 + 1) * h, 255);
  for (let x = 10; x < 190; x++) {
    const y = Math.round(30 + 18 * Math.sin(x / 12 + seed));
    for (let dy = -1; dy <= 1; dy++) {
      const o = (y + dy) * (w * 4 + 1) + 1 + x * 4;
      raw[o] = raw[o + 1] = raw[o + 2] = 20;
    }
  }
  for (let r = 0; r < h; r++) raw[r * (w * 4 + 1)] = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
