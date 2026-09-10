export interface DeviceSettingsBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}

declare global {
  interface Window { Resto237DeviceSettings?: DeviceSettingsBridge }
}

export function deviceSettingsAvailable(): boolean {
  if (nativePlatform() === "android") return true;
  return typeof window !== "undefined" && typeof window.Resto237DeviceSettings?.postMessage === "function";
}

// A native acknowledgement means settings opened, never that permission was granted.
export async function openBatterySettings(): Promise<boolean> {
  if (nativePlatform() === "android") {
    return BatterySettings.open().then((result) => result.opened).catch(() => false);
  }
  const bridge = typeof window !== "undefined" ? window.Resto237DeviceSettings : undefined;
  if (!bridge || !deviceSettingsAvailable()) return false;
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const previous = bridge.onmessage;
    const finish = (opened: boolean) => {
      clearTimeout(timer);
      bridge.onmessage = previous;
      resolve(opened);
    };
    const timer = setTimeout(() => finish(false), 5000);
    bridge.onmessage = (event) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply.id === id) finish(reply.opened === true);
      } catch { /* Ignore unrelated or malformed native messages. */ }
    };
    try { bridge.postMessage(JSON.stringify({ id, action: "openBatterySettings" })); }
    catch { finish(false); }
  });
}
import { registerPlugin } from "@capacitor/core";
import { nativePlatform } from "@/lib/capacitor/platform";

interface BatterySettingsPlugin {
  open(): Promise<{ opened: boolean }>;
}

const BatterySettings = registerPlugin<BatterySettingsPlugin>("BatterySettings");
