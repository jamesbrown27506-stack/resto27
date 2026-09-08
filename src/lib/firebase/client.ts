import { getApp, getApps, initializeApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";

// Public Firebase web identifiers supplied for Resto237, not server credentials.
const firebaseConfig = {
  apiKey: "AIzaSyDSsnrhDiwsdkUhFhO0DgTdaaGR3yFRDXI",
  authDomain: "resto237-da372.firebaseapp.com",
  projectId: "resto237-da372",
  storageBucket: "resto237-da372.firebasestorage.app",
  messagingSenderId: "1052805248703",
  appId: "1:1052805248703:web:c3aebfb283c313cc3ab80a",
  measurementId: "G-BPRG3GNM82",
};

export function getFirebaseApp() {
  return getApps().some((app) => app.name === "[DEFAULT]")
    ? getApp()
    : initializeApp(firebaseConfig);
}

let analyticsPromise: Promise<Analytics | null> | undefined;

/** Analytics is browser-only; share initialization across React remounts. */
export function initializeFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  analyticsPromise ??= (async () => {
    const app = getFirebaseApp();
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    return (await isSupported()) ? getAnalytics(app) : null;
  })().catch((error: unknown) => {
    console.warn("[firebase] Analytics initialization unavailable", error);
    analyticsPromise = undefined;
    return null;
  });
  return analyticsPromise;
}
