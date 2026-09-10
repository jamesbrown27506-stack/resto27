"use client";

import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

export function isNativeApp(): boolean { return Capacitor.isNativePlatform(); }
const subscribePlatform = () => () => undefined;

export function useNativeApp(): boolean {
  return useSyncExternalStore(subscribePlatform, isNativeApp, () => false);
}

export function nativePlatform(): "android" | "ios" | null {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios" ? platform : null;
}
