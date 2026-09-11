"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface AppUpdaterPlugin {
  /** Downloads the APK into the app's cache; emits "progress" as it goes. */
  download(options: { url: string; fileName: string }): Promise<{ fileName: string; bytes: number }>;
  /** Opens Android's installer, or its "install unknown apps" setting first. */
  install(options: { fileName: string }): Promise<{ status: "installer-opened" | "needs-permission" }>;
  addListener(event: "progress", listener: (progress: { percent: number }) => void): Promise<PluginListenerHandle>;
}

/** The native updater (android/.../AppUpdaterPlugin.java), shipped from app 1.4. */
export const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

/** False in builds that predate the updater: they fall back to a browser download. */
export function inAppUpdateAvailable(): boolean {
  return Capacitor.isPluginAvailable("AppUpdater");
}
