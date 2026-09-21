import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function clickWorker(windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const openWindow = vi.fn(async () => undefined);
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL,
    self: {
      location: { origin: "https://resto237.online" },
      navigator: {},
      addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
      clients: { matchAll: vi.fn(async () => windows), openWindow },
      registration: {},
    },
  });
  return { click: listeners.notificationclick, openWindow };
}

it("opens the exact table request when an existing browser tab refuses navigation", async () => {
  const window = {
    url: "https://resto237.online/m",
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(async () => { throw new Error("window cannot navigate"); }),
  };
  const worker = clickWorker([window]);
  let completion: Promise<unknown> | undefined;
  worker.click({
    action: "",
    notification: { close: vi.fn(), data: { url: "/m/table-order?session=abc" } },
    waitUntil: (promise: Promise<unknown>) => { completion = promise; },
  });
  await completion;
  expect(worker.openWindow).toHaveBeenCalledWith("https://resto237.online/m/table-order?session=abc");
});

it("focuses a matching restaurant tab without opening a search or duplicate tab", async () => {
  const window = {
    url: "https://resto237.online/m/table-order?session=abc",
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(),
  };
  const worker = clickWorker([window]);
  let completion: Promise<unknown> | undefined;
  worker.click({
    action: "",
    notification: { close: vi.fn(), data: { url: "/m/table-order?session=abc" } },
    waitUntil: (promise: Promise<unknown>) => { completion = promise; },
  });
  await completion;
  expect(window.focus).toHaveBeenCalledOnce();
  expect(window.navigate).not.toHaveBeenCalled();
  expect(worker.openWindow).not.toHaveBeenCalled();
});
