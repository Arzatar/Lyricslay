'use strict';
// One-off script (plain Node, no deps) that writes assets/tray.png and assets/icon.png:
// a simple rounded purple square with a white music-note glyph.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function makePng(size) {
  const bg = [124, 58, 237, 255]; // purple
  const fg = [255, 255, 255, 255]; // white note

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  const cx = size * 0.5;
  const cy = size * 0.58;
  const noteR = size * 0.16;
  const stemX = cx + noteR * 0.85;
  const stemTop = size * 0.18;
  const stemBottom = cy;
  const cornerR = size * 0.18;

  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      // rounded-square background mask
      let inside = true;
      const corners = [
        [cornerR, cornerR],
        [size - cornerR, cornerR],
        [cornerR, size - cornerR],
        [size - cornerR, size - cornerR],
      ];
      if (x < cornerR && y < cornerR) inside = inCircle(x, y, cornerR, cornerR, cornerR);
      else if (x > size - cornerR && y < cornerR) inside = inCircle(x, y, size - cornerR, cornerR, cornerR);
      else if (x < cornerR && y > size - cornerR) inside = inCircle(x, y, cornerR, size - cornerR, cornerR);
      else if (x > size - cornerR && y > size - cornerR) inside = inCircle(x, y, size - cornerR, size - cornerR, cornerR);

      let r, g, b, a;
      if (!inside) {
        r = g = b = a = 0;
      } else {
        r = bg[0]; g = bg[1]; b = bg[2]; a = bg[3];

        const noteHead = inCircle(x, y, cx, cy, noteR);
        const stem = x >= stemX - size * 0.03 && x <= stemX + size * 0.03 && y >= stemTop && y <= stemBottom;
        const flag = x >= stemX && x <= stemX + size * 0.14 && y >= stemTop && y <= stemTop + size * 0.16 &&
          (y - stemTop) <= (x - stemX) * 1.3;

        if (noteHead || stem || flag) {
          r = fg[0]; g = fg[1]; b = fg[2]; a = fg[3];
        }
      }
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'tray.png'), makePng(32));
fs.writeFileSync(path.join(outDir, 'icon.png'), makePng(256));
console.log('icons written to', outDir);
