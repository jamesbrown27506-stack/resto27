"use client";

import { Browser } from "@capacitor/browser";
import { Camera, CameraResultType, CameraSource, type Photo } from "@capacitor/camera";
import { Device } from "@capacitor/device";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Geolocation } from "@capacitor/geolocation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { isNativeApp } from "./native";

/** A single typed entry point for feature code that needs native device APIs. */
export const nativeDevice = {
  available: isNativeApp,

  takePhoto(): Promise<Photo> {
    return Camera.getPhoto({
      source: CameraSource.Prompt,
      resultType: CameraResultType.Uri,
      quality: 82,
      correctOrientation: true,
      saveToGallery: false,
    });
  },

  async currentLocation() {
    const permission = await Geolocation.requestPermissions({ permissions: ["location"] });
    if (permission.location !== "granted" && permission.coarseLocation !== "granted") {
      throw new Error("Location permission was not granted.");
    }
    return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  },

  share(options: { title?: string; text?: string; url?: string; files?: string[] }) {
    return Share.share({ ...options, dialogTitle: options.title });
  },

  async openExternal(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Only HTTPS links may be opened externally.");
    await Browser.open({ url: parsed.toString(), presentationStyle: "popover" });
  },

  info: () => Device.getInfo(),
  network: () => Network.getStatus(),
  impact: (style: ImpactStyle = ImpactStyle.Medium) => Haptics.impact({ style }),

  async saveText(path: string, data: string) {
    return Filesystem.writeFile({ path, data, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
  },

  preference: {
    get: (key: string) => Preferences.get({ key }),
    set: (key: string, value: string) => Preferences.set({ key, value }),
    remove: (key: string) => Preferences.remove({ key }),
  },

  async scheduleLocalReminder(options: { id: number; title: string; body: string; at: Date; extra?: Record<string, unknown> }) {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted") throw new Error("Notification permission was not granted.");
    return LocalNotifications.schedule({ notifications: [{
      id: options.id,
      title: options.title,
      body: options.body,
      schedule: { at: options.at },
      extra: options.extra,
      channelId: "resto237_operational",
    }] });
  },
};
