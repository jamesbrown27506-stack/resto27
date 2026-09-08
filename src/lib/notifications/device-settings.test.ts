import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceSettingsAvailable, openBatterySettings, type DeviceSettingsBridge } from "./device-settings";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("native battery settings", () => {
  it("does not offer native access on the server or a regular browser", async () => {
    expect(deviceSettingsAvailable()).toBe(false);
    expect(await openBatterySettings()).toBe(false);
    vi.stubGlobal("window", {});
    expect(deviceSettingsAvailable()).toBe(false);
  });
  it("waits for a matching native acknowledgement", async () => {
    const bridge: DeviceSettingsBridge = {
      onmessage: null,
      postMessage(raw) {
        const { id, action } = JSON.parse(raw);
        expect(action).toBe("openBatterySettings");
        bridge.onmessage?.({ data: "invalid" });
        bridge.onmessage?.({ data: JSON.stringify({ id: "unrelated", opened: true }) });
        bridge.onmessage?.({ data: JSON.stringify({ id, opened: true }) });
      },
    };
    vi.stubGlobal("window", { Resto237DeviceSettings: bridge });
    expect(await openBatterySettings()).toBe(true);
    expect(bridge.onmessage).toBe(null);
  });
  it("falls back when the wrapper never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { Resto237DeviceSettings: { onmessage: null, postMessage() {} } });
    const result = openBatterySettings();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe(false);
  });
  it("falls back when the bridge throws", async () => {
    vi.stubGlobal("window", { Resto237DeviceSettings: { onmessage: null, postMessage() { throw new Error("Unavailable"); } } });
    expect(await openBatterySettings()).toBe(false);
  });
});
