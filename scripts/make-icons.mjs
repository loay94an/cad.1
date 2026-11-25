// Writes the app icons (PNG) into public/ without any image library.
// Run with: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [37, 99, 235, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel((x + 0.5) / size, (y + 0.5) / size);
      raw.set(p, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A small floor plan: outer walls with an entrance, one inner wall with a door gap. u, v in 0..1. */
function glyph(u, v) {
  const t = 0.085;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const entrance = v > 1 - t && u > 0.18 && u < 0.42;
  const outer = (u < t || u > 1 - t || v < t || v > 1 - t) && !entrance;
  const inner = Math.abs(u - 0.56) < t / 2 && v < 0.64;
  const inner2 = Math.abs(v - 0.46) < t / 2 && u > 0.56 && (u < 0.7 || u > 0.9);
  return outer || inner || inner2;
}

function icon(size, { maskable }) {
  const inset = maskable ? 0.25 : 0.2; // maskable icons keep content in the central 60-80%
  const radius = maskable ? 0 : 0.18;
  return png(size, (x, y) => {
    if (radius) {
      const cx = Math.min(Math.max(x, radius), 1 - radius);
      const cy = Math.min(Math.max(y, radius), 1 - radius);
      if (Math.hypot(x - cx, y - cy) > radius) return CLEAR;
    }
    const u = (x - inset) / (1 - 2 * inset);
    const v = (y - inset) / (1 - 2 * inset);
    return glyph(u, v) ? WHITE : BLUE;
  });
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', icon(192, { maskable: false }));
writeFileSync('public/icon-512.png', icon(512, { maskable: false }));
writeFileSync('public/icon-maskable-512.png', icon(512, { maskable: true }));
console.log('Wrote public/icon-192.png, icon-512.png, icon-maskable-512.png');
