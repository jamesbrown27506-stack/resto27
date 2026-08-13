/**
 * Synthesises the notification sound files into public/sounds/.
 *
 * Pure Node, no dependencies. WAV is fine for short UI sounds — every browser
 * plays it, and these files are a few KB each.
 *
 * Run:  node scripts/generate-sounds.mjs
 *
 * The file names MUST stay in sync with the `notification_sound` setting
 * (supabase/migrations/0018_notification_platform.sql) and the SOUNDS map in
 * the admin settings form.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "sounds");
mkdirSync(outDir, { recursive: true });

const RATE = 16000; // mono, 16 kHz — small files, plenty for a UI blip

function writeWav(name, samples) {
  const count = samples.length;
  const dataSize = count * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < count; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767 * 0.85), 44 + i * 2);
  }

  const path = join(outDir, `${name}.wav`);
  writeFileSync(path, buffer);
  console.log(`  wrote ${path} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

/** A tone with an exponential decay and a faint octave harmonic — bell-like. */
function bell(freq, duration, startAt = 0, gain = 1) {
  const samples = new Array(Math.floor((startAt + duration) * RATE)).fill(0);
  const start = Math.floor(startAt * RATE);
  for (let i = start; i < samples.length; i++) {
    const t = (i - start) / RATE;
    const decay = Math.exp(-t * 4.5);
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const harmonic = 0.35 * Math.sin(2 * Math.PI * freq * 2 * t);
    samples[i] += (fundamental + harmonic) * decay * gain;
  }
  return samples;
}

function pad(samples, seconds) {
  return [...samples, ...new Array(Math.floor(seconds * RATE)).fill(0)];
}

// ── chime: E5 → A5, the classic two-note "something arrived" ──────────────
writeWav("chime", pad([...bell(659.25, 0.55), ...bell(880, 0.7, 0.16)], 0.15));

// ── ding: one soft bell ────────────────────────────────────────────────────
writeWav("ding", pad(bell(880, 0.6), 0.2));

// ── pop: a short low blip, the least intrusive option ──────────────────────
{
  const samples = new Array(Math.floor(0.16 * RATE)).fill(0);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const freq = 520 - 260 * (t / 0.16); // downward sweep
    samples[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 22);
  }
  writeWav("pop", samples);
}

// ── triple: three quick rising notes — a bit more insistent ───────────────
writeWav("triple", pad([...bell(523.25, 0.3), ...bell(659.25, 0.3, 0.12), ...bell(783.99, 0.45, 0.24)], 0.15));

// ── alert: two descending tones, the "pay attention now" option ───────────
writeWav("alert", pad([...bell(783.99, 0.35, 0, 0.9), ...bell(659.25, 0.5, 0.2, 0.9)], 0.15));

// ── tri-tone: the bright three-note rise the iPhone made famous ───────────
// E♭5 → G5 → B♭5, plucked quickly, each note ringing into the next. Not a
// byte copy of Apple's chime — the same shape: fast attack, quick decay,
// a little harmonic brightness on top.
{
  const notes = [622.25, 783.99, 932.33]; // E♭5, G5, B♭5
  const startGap = 0.11; // seconds between note onsets
  const noteDur = 0.5;
  const total = startGap * (notes.length - 1) + noteDur + 0.15;
  const samples = new Array(Math.floor(total * RATE)).fill(0);
  notes.forEach((freq, n) => {
    const start = Math.floor(n * startGap * RATE);
    for (let i = start; i < samples.length; i++) {
      const t = (i - start) / RATE;
      const decay = Math.exp(-t * 11);
      const tone =
        Math.sin(2 * Math.PI * freq * t) +
        0.35 * Math.sin(2 * Math.PI * freq * 2 * t) +
        0.12 * Math.sin(2 * Math.PI * freq * 3 * t);
      samples[i] += tone * decay * 0.5;
    }
  });
  writeWav("tri-tone", samples);
}

console.log("Done. Files land in public/sounds/ and are served at /sounds/<name>.wav");
