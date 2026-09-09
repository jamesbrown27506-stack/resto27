// Generates the Resto237 PWA icon and monochrome notification badge.
// Run with: node scripts/generate-app-icon.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const PRIMARY = [0x5f, 0x72, 0x57];
const PRIMARY_DARK = [0x43, 0x54, 0x3d];
const CREAM = [0xff, 0xfc, 0xf5];
const ORANGE = [0xf2, 0x8a, 0x2e];

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = pixelAt(x, y, size);
      raw[offset++] = pixel[0];
      raw[offset++] = pixel[1];
      raw[offset++] = pixel[2];
      raw[offset++] = pixel[3];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function circle(x, y, cx, cy, radius, size) {
  return clamp((radius - Math.hypot(x - cx, y - cy)) * size + 0.5);
}

function roundedRect(x, y, left, top, right, bottom, radius, size) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return clamp((radius - Math.hypot(x - cx, y - cy)) * size + 0.5);
}

function mix(base, overlay, amount) {
  return [
    Math.round(base[0] + (overlay[0] - base[0]) * amount),
    Math.round(base[1] + (overlay[1] - base[1]) * amount),
    Math.round(base[2] + (overlay[2] - base[2]) * amount),
    255,
  ];
}

function markMask(x, y, size) {
  const dome = y <= 0.63 && y >= 0.34 ? circle(x, y, 0.5, 0.63, 0.285, size) : 0;
  const base = roundedRect(x, y, 0.16, 0.65, 0.84, 0.73, 0.04, size);
  const knob = circle(x, y, 0.5, 0.29, 0.055, size);
  return Math.max(dome, base, knob);
}

function appPixel(xi, yi, size) {
  const x = (xi + 0.5) / size;
  const y = (yi + 0.5) / size;
  const vignette = clamp((Math.hypot(x - 0.5, y - 0.5) - 0.27) * 1.7);
  let pixel = mix(PRIMARY, PRIMARY_DARK, vignette);
  pixel = mix(pixel, CREAM, markMask(x, y, size));

  const knob = circle(x, y, 0.5, 0.29, 0.055, size);
  pixel = mix(pixel, ORANGE, knob);

  const accent = roundedRect(x, y, 0.27, 0.648, 0.73, 0.686, 0.019, size);
  pixel = mix(pixel, ORANGE, accent);
  return pixel;
}

function badgePixel(xi, yi, size) {
  const x = (xi + 0.5) / size;
  const y = (yi + 0.5) / size;
  const alpha = Math.round(markMask(x, y, size) * 255);
  return [255, 255, 255, alpha];
}

for (const size of [180, 192, 512]) {
  const path = "public/app-icon-" + size + ".png";
  writeFileSync(path, encodePng(size, appPixel));
  console.log(path);
}

writeFileSync("public/notification-badge.png", encodePng(96, badgePixel));
console.log("public/notification-badge.png");
