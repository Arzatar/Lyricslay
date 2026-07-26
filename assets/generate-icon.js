'use strict';
// One-off script (plain Node, no deps) that writes assets/tray.png and
// assets/icon.png: a circular black badge (transparent outside the circle,
// no square background) with a glossy upper-left highlight, and a cyan
// "synced lyric lines" glyph — three text-line bars with the middle one lit
// up bright, mirroring what the app's own overlay does (highlighting the
// currently active line). Picked over a generic music-note glyph
// specifically because it communicates *what this app does* rather than
// just "this is music-related".

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

function writePng(size, setPixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = setPixel(x, y);
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
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundedBarHit(x, y, left, top, w, h, radius) {
  if (x < left || x > left + w || y < top || y > top + h) return false;
  const rx = Math.min(radius, w / 2, h / 2);
  if (x < left + rx && y < top + rx) return (x - (left + rx)) ** 2 + (y - (top + rx)) ** 2 <= rx * rx;
  if (x > left + w - rx && y < top + rx) return (x - (left + w - rx)) ** 2 + (y - (top + rx)) ** 2 <= rx * rx;
  if (x < left + rx && y > top + h - rx) return (x - (left + rx)) ** 2 + (y - (top + h - rx)) ** 2 <= rx * rx;
  if (x > left + w - rx && y > top + h - rx) return (x - (left + w - rx)) ** 2 + (y - (top + h - rx)) ** 2 <= rx * rx;
  return true;
}

// Three lyric-line bars centered on the badge; the middle one reports full
// intensity (bright cyan = the active/highlighted line), the other two a
// dimmer intensity (unhighlighted lines) — same visual language as the
// overlay itself.
function lyricLinesGlyph(x, y, cx, cy, size) {
  // Bars sized thicker relative to the badge (and closer together) than a
  // pure linear scale would give — checked directly at 32px (the tray
  // icon's actual shipped size): thinner/lower-contrast bars anti-alias
  // into near-invisibility at that size, leaving what reads as a single
  // pill instead of three lines. The 256px app icon can afford finer bars,
  // but sharing one glyph across both sizes means it has to hold up at the
  // smaller one.
  const barH = size * 0.1;
  const gap = size * 0.045;
  const widths = [size * 0.34, size * 0.52, size * 0.28];
  const ys = [cy - gap - barH * 1.5, cy - barH / 2, cy + gap + barH / 2];
  for (let i = 0; i < 3; i++) {
    const w = widths[i];
    if (roundedBarHit(x, y, cx - w / 2, ys[i], w, barH, barH / 2)) {
      return i === 1 ? 1 : 0.55;
    }
  }
  return 0;
}

const CYAN = [0, 224, 255];
const DIM_CYAN = [70, 150, 165];

function makeBadge(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.48;
  const highlightCx = size * 0.36;
  const highlightCy = size * 0.32;
  const highlightR = size * 0.55;

  return writePng(size, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r) return [0, 0, 0, 0]; // transparent outside the circle

    // Glossy sphere shading: lighter near the highlight point, darker at the rim.
    const hDist = Math.sqrt((x - highlightCx) ** 2 + (y - highlightCy) ** 2) / highlightR;
    const glossT = Math.max(0, 1 - hDist);
    const edgeT = Math.max(0, (dist / r - 0.75) / 0.25);
    const baseGray = lerp(18, 4, edgeT);
    const bg = [
      Math.round(lerp(baseGray, 46, glossT * 0.6)),
      Math.round(lerp(baseGray, 50, glossT * 0.6)),
      Math.round(lerp(baseGray + 2, 55, glossT * 0.6)),
    ];

    const glyph = lyricLinesGlyph(x, y, cx, cy, size);
    if (glyph <= 0) return [...bg, 255];

    const col = glyph < 1 ? DIM_CYAN : CYAN;
    const lit = glossT * 0.25; // glyph picks up a touch of the same gloss
    const r2 = Math.round(lerp(bg[0], Math.min(255, col[0] + col[0] * lit), Math.min(1, glyph)));
    const g2 = Math.round(lerp(bg[1], Math.min(255, col[1] + col[1] * lit), Math.min(1, glyph)));
    const b2 = Math.round(lerp(bg[2], Math.min(255, col[2] + col[2] * lit), Math.min(1, glyph)));
    return [r2, g2, b2, 255];
  });
}

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'tray.png'), makeBadge(32));
fs.writeFileSync(path.join(outDir, 'icon.png'), makeBadge(256));
console.log('icons written to', outDir);
