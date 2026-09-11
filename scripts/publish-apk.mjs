import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Builds the signed Android APK and publishes it for the website's
 * "Download our app" section:
 *
 *   public/downloads/resto237.apk   the file visitors download
 *   src/lib/app-release.json        version and size shown next to the button
 *
 *   npm run mobile:apk                    sync, build, publish
 *   npm run mobile:apk -- --skip-build    publish the last build again
 *
 * Bump versionCode (and versionName) in android/app/build.gradle before each
 * release: Android refuses to update an installed app to an equal or lower
 * versionCode.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = path.join(root, "android");
const built = path.join(android, "app/build/outputs/apk/release/app-release.apk");

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function run(command, args, cwd, env) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  // A shell is required to launch gradlew.bat and npx.cmd on Windows.
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: true });
  if (result.status !== 0) fail(`${command} failed (exit ${result.status ?? "signal"}).`);
}

if (!existsSync(path.join(android, "keystore.properties"))) {
  fail("android/keystore.properties is missing. The APK must be signed with the release key, or installed copies can never be updated. See docs/MOBILE_RELEASE.md.");
}
if (!existsSync(path.join(android, "app/google-services.json"))) {
  console.warn("WARNING: android/app/google-services.json is missing, so push notifications will not work in this build.");
}

if (!process.argv.includes("--skip-build")) {
  const env = { ...process.env };
  // Android Studio bundles a JDK; use it when none is configured.
  const studioJdk = "C:\\Program Files\\Android\\Android Studio\\jbr";
  if (!env.JAVA_HOME && existsSync(studioJdk)) env.JAVA_HOME = studioJdk;
  run("npx", ["cap", "sync", "android"], root, env);
  // Absolute path: Windows shells can be told not to search the current
  // directory (NoDefaultCurrentDirectoryInExePath), which hides gradlew.bat.
  const gradlew = path.join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  run(`"${gradlew}"`, ["assembleRelease", "--console=plain"], android, env);
}

if (!existsSync(built)) fail(`No signed APK at ${path.relative(root, built)}. Build it first.`);

const gradle = readFileSync(path.join(android, "app/build.gradle"), "utf8");
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
if (!versionName || !versionCode) fail("Could not read versionName/versionCode from android/app/build.gradle.");

const apk = readFileSync(built);
/*
  The version is in the file name. Every copy used to be "resto237.apk", so a
  phone's Download folder filled with "Resto237 (1)", "(2)"… and people opened
  an old one. One APK on the site at a time: older versions — and the
  unversioned name — are removed; /downloads/resto237.apk redirects to this
  one (next.config.ts).
*/
const fileName = `resto237-${versionName}.apk`;
const downloads = path.join(root, "public/downloads");
mkdirSync(downloads, { recursive: true });
for (const file of readdirSync(downloads)) {
  if (/^resto237.*\.apk$/i.test(file) && file !== fileName) rmSync(path.join(downloads, file));
}
copyFileSync(built, path.join(downloads, fileName));

const release = {
  android: {
    url: `/downloads/${fileName}`,
    versionName,
    versionCode,
    sizeBytes: apk.length,
    sha256: createHash("sha256").update(apk).digest("hex"),
    publishedAt: new Date().toISOString().slice(0, 10),
  },
};
writeFileSync(path.join(root, "src/lib/app-release.json"), `${JSON.stringify(release, null, 2)}\n`);

console.log(`\nPublished Resto237 ${versionName} (${versionCode}), ${(apk.length / 1_048_576).toFixed(1)} MB`);
console.log(`Commit public/downloads/${fileName} (and the removed old APK) with src/lib/app-release.json, then deploy.`);
