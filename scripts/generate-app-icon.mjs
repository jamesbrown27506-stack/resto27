// Generates every app icon and launch screen from the brand logo.
// Run with: node scripts/generate-app-icon.mjs [path/to/logo.png]
//
// The source (default resources/logo.png) is the full logo — the symbol above
// the name — on a white ground: the same file uploaded in /a/settings.
// Icons use only the symbol, because at launcher size the name and tagline
// are unreadable; launch screens show the whole logo.
//
// Not generated here: public/notification-badge.png and the Android
// status-bar icon (drawable/ic_stat_resto237.xml). Both must be flat
// single-colour silhouettes, which a full-colour logo cannot be turned into.

import sharp from "sharp";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Files are regenerated in place; a cached handle blocks that on Windows.
sharp.cache(false);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...parts) => path.join(root, ...parts);
const source = path.resolve(root, process.argv[2] ?? "resources/logo.png");
if (!existsSync(source)) throw new Error(`Put the logo at ${path.relative(root, source)}, or pass its path.`);

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
/** How far from white a pixel must be to count as artwork, not antialiasing. */
const INK = 60;

/**
 * Splits the logo into horizontal bands of artwork separated by blank rows.
 * The symbol is every band until the first one much wider than all above it,
 * which is the name.
 */
function findRegions({ data, width, height }) {
  const ink = (x, y) => {
    const i = (y * width + x) * 3;
    return 765 - data[i] - data[i + 1] - data[i + 2] > INK;
  };
  const bands = [];
  let band = null;
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) if (ink(x, y)) { if (left < 0) left = x; right = x; }
    if (left < 0) { if (band) bands.push(band); band = null; continue; }
    if (!band) band = { top: y, bottom: y, left, right };
    else Object.assign(band, { bottom: y, left: Math.min(band.left, left), right: Math.max(band.right, right) });
  }
  if (band) bands.push(band);
  if (!bands.length) throw new Error("The logo is blank.");

  const merge = (a, b) => ({ top: a.top, bottom: b.bottom, left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) });
  let symbol = bands[0];
  for (const next of bands.slice(1)) {
    if (next.right - next.left > 1.5 * (symbol.right - symbol.left)) break;
    symbol = merge(symbol, next);
  }
  return { symbol, artwork: bands.reduce(merge) };
}

async function crop(box) {
  return sharp(source).flatten({ background: WHITE })
    .extract({ left: box.left, top: box.top, width: box.right - box.left + 1, height: box.bottom - box.top + 1 })
    .png().toBuffer();
}

/** Makes the white ground transparent without dulling antialiased edges. */
async function whiteToAlpha(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    let alpha = Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]) / 255;
    if (alpha < 4 / 255) alpha = 0;
    for (let c = 0; c < 3; c++) out[o + c] = alpha ? Math.round(255 - (255 - data[i + c]) / alpha) : 0;
    out[o + 3] = Math.round(alpha * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** The same shape in white, for Android 13+ themed icons. */
async function silhouette(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** `art` fitted into a centred square of `fraction` of the shorter side. */
async function place(art, width, height, fraction, background) {
  const box = Math.max(1, Math.round(Math.min(width, height) * fraction));
  const scaled = await sharp(art).resize(box, box, { fit: "inside" }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: scaled, gravity: "centre" }]).png().toBuffer();
}

/**
 * Encoded in memory and written by Node, retrying briefly: on Windows an
 * antivirus scan or an editor's file watcher can hold a file for a moment
 * after it changes, and dozens of images are rewritten here in a row.
 */
async function save(file, bytes) {
  for (let attempt = 1; ; attempt++) {
    try { writeFileSync(file, bytes); return; }
    catch (error) {
      if (attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}
const write = async (png, file) => save(file, await sharp(png).png({ compressionLevel: 9 }).toBuffer());
// App Store icons and launch images must not carry an alpha channel.
const writeOpaque = async (png, file) =>
  save(file, await sharp(png).flatten({ background: WHITE }).removeAlpha().png({ compressionLevel: 9 }).toBuffer());
const circleMask = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

const pixels = await sharp(source).flatten({ background: WHITE }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const regions = findRegions({ data: pixels.data, width: pixels.info.width, height: pixels.info.height });
console.log("symbol", regions.symbol, "whole logo", regions.artwork);

// Everything is placed from the transparent cut-outs: the logo's ground is
// only nearly white (254), which shows as a faint box on a pure-white canvas.
const symbol = await whiteToAlpha(await crop(regions.symbol));
const artwork = await whiteToAlpha(await crop(regions.artwork));
const symbolMono = await silhouette(symbol);
let count = 0;

// Android launcher icons. Adaptive layers are 108dp, of which launchers show
// the central 66dp circle-to-square, so the symbol stays inside that.
const res = at("android/app/src/main/res");
const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = path.join(res, `mipmap-${name}`);
  const launcher = Math.round(48 * scale);
  const layer = Math.round(108 * scale);
  await write(await place(symbol, launcher, launcher, 0.72, WHITE), path.join(dir, "ic_launcher.png"));
  const round = await place(symbol, launcher, launcher, 0.62, WHITE);
  await write(await sharp(round).composite([{ input: circleMask(launcher), blend: "dest-in" }]).png().toBuffer(),
    path.join(dir, "ic_launcher_round.png"));
  await write(await place(symbol, layer, layer, 0.52, CLEAR), path.join(dir, "ic_launcher_foreground.png"));
  await write(await place(symbolMono, layer, layer, 0.52, CLEAR), path.join(dir, "ic_launcher_monochrome.png"));
  // The adaptive background is @color/ic_launcher_background now.
  rmSync(path.join(dir, "ic_launcher_background.png"), { force: true });
  count += 4;
}

// Launch screens, every existing size. Dark-mode variants stay white: the
// logo's black outlines would vanish on a dark ground.
const iosSplash = at("ios/App/App/Assets.xcassets/Splash.imageset");
const splashes = [
  ...readdirSync(res).filter((dir) => dir.startsWith("drawable")).map((dir) => path.join(res, dir, "splash.png")),
  ...readdirSync(iosSplash).filter((file) => file.endsWith(".png")).map((file) => path.join(iosSplash, file)),
].filter((file) => existsSync(file));
for (const file of splashes) {
  const { width, height } = await sharp(readFileSync(file)).metadata();
  await writeOpaque(await place(artwork, width, height, 0.5, WHITE), file);
  count += 1;
}

// iOS, the web app's Home Screen icons, and the reference copies.
await writeOpaque(await place(symbol, 1024, 1024, 0.66, WHITE), at("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"));
for (const size of [180, 192, 512]) await writeOpaque(await place(symbol, size, size, 0.62, WHITE), at(`public/app-icon-${size}.png`));
await writeOpaque(await place(symbol, 1024, 1024, 0.66, WHITE), at("resources/icon.png"));
await writeOpaque(await place(artwork, 2732, 2732, 0.5, WHITE), at("resources/splash.png"));
count += 6;

console.log(`Wrote ${count} images. Rebuild the app (npm run mobile:apk) to ship them.`);
