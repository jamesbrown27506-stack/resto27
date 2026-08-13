// Generates public/app-icon-{180,192,512}.png — the PWA/app icon.
//
// Web Push on iOS requires the site to be installed to the home screen, which
// needs a web app manifest, which needs icons. Rather than shipping a binary
// PNG in the repo, this draws one from the brand color (#5f7257) with a
// white notification disc — a stand-in until a real logo is designed.
//
// A minimal PNG encoder (zlib is built into Node; CRC32 is ~10 lines) — no
// image library dependency.
//
//   node scripts/generate-app-icon.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const PRIMARY = [0x5f, 0x72, 0x57]; // --primary from globals.css
const WHITE = [0xff, 0xff, 0xff];

// ── CRC32 (PNG chunk checksums) ─────────────────────────────────────────
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y, size);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A white disc in the middle of the brand colour — reads as a notification
// badge at 16px and at 512px.
function pixelAt(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  // 1px anti-aliasing: blend the ring edge instead of hard-clipping it.
  const dist = Math.sqrt(dx * dx + dy * dy);
  const t = Math.min(1, Math.max(0, r - dist + 1));
  if (t <= 0) return PRIMARY;
  return [
    Math.round(PRIMARY[0] + (WHITE[0] - PRIMARY[0]) * t),
    Math.round(PRIMARY[1] + (WHITE[1] - PRIMARY[1]) * t),
    Math.round(PRIMARY[2] + (WHITE[2] - PRIMARY[2]) * t),
  ];
}

for (const size of [180, 192, 512]) {
  writeFileSync(`public/app-icon-${size}.png`, encodePng(size, pixelAt));
  console.log(`public/app-icon-${size}.png`);
}
