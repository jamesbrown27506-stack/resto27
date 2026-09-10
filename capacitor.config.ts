import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim() || "https://resto237.online";
const origin = new URL(serverUrl);
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("CAPACITOR_SERVER_URL must be an HTTPS origin without credentials, path, query, or fragment.");
}

const config: CapacitorConfig = {
  appId: "online.resto237.app",
  appName: "Resto237",
  webDir: "mobile-shell",
  server: {
    url: serverUrl,
    cleartext: false,
    errorPath: "index.html",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      // Matches the launch images, which put the logo on white.
      backgroundColor: "#FFFFFF",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#F7F4ED",
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    FirebaseMessaging: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
