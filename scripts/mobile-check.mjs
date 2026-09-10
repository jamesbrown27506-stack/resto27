import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appId = "online.resto237.app";
const target = process.argv[2];
if (target && !["android", "ios"].includes(target)) throw new Error("Use mobile-check.mjs [android|ios]");
const failures = [];
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
function check(label, verify) {
  try { verify(); console.log(`OK: ${label}`); }
  catch (error) { failures.push(label); console.error(`MISSING/INVALID: ${label}: ${error.message}`); }
}
if (!target || target === "android") check("Android Firebase configuration", () => {
  const config = JSON.parse(read("android/app/google-services.json"));
  if (config.project_info?.project_id !== "resto237-da372" ||
      !config.client?.some((client) => client.client_info?.android_client_info?.package_name === appId)) {
    throw new Error(`Download the Firebase Android configuration for ${appId} in resto237-da372.`);
  }
});
if (!target || target === "ios") {
  check("iOS Firebase configuration", () => {
    const config = read("ios/App/App/GoogleService-Info.plist");
    if (!/<key>BUNDLE_ID<\/key>\s*<string>online\.resto237\.app<\/string>/.test(config) ||
        !/<key>PROJECT_ID<\/key>\s*<string>resto237-da372<\/string>/.test(config)) {
      throw new Error(`Download the Firebase iOS configuration for ${appId} in resto237-da372.`);
    }
    if (!read("ios/App/App.xcodeproj/project.pbxproj").includes("GoogleService-Info.plist in Resources")) {
      throw new Error("Add GoogleService-Info.plist to the App target's Copy Bundle Resources in Xcode.");
    }
  });
  check("iOS privacy manifest", () => {
    if (!existsSync(path.join(root, "ios/App/App/PrivacyInfo.xcprivacy"))) throw new Error("Missing privacy manifest.");
  });
}
console.log("Also verify migration 0048, deployed web changes, signing, app links and physical-device tests. See docs/MOBILE_RELEASE.md.");
if (failures.length) process.exitCode = 1;
