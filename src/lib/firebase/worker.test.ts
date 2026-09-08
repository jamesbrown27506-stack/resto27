import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  let background: (message: unknown) => unknown = () => undefined;
  const showNotification = vi.fn();
  const listeners: Record<string, (event: unknown) => unknown> = {};
  runInNewContext(readFileSync("public/firebase-messaging-sw.js", "utf8"), {
    URL, importScripts: vi.fn(),
    self: { location: { origin: "https://resto237.vercel.app" },
      addEventListener: (type: string, fn: (event: unknown) => unknown) => { listeners[type] = fn; },
      registration: { showNotification } },
    firebase: { initializeApp: vi.fn(), messaging: () => ({ onBackgroundMessage: (fn: typeof background) => { background = fn; } }) },
  });
  return { background, showNotification, listeners };
}

it("does not duplicate Firebase Console notifications", () => {
  const w = worker();
  w.background({ notification: { title: "Console test" } });
  expect(w.showNotification).not.toHaveBeenCalled();
});

it("displays operational messages with safe links and action buttons", () => {
  const w = worker();
  w.background({ data: { payload: JSON.stringify({ title: "Order ready", href: "https://external.example", tag: "order-1", requireInteraction: true,
    actions: [{ action: "view", title: "View order", href: "/orders/1" }] }) } });
  expect(w.showNotification).toHaveBeenCalledOnce();
  expect(w.showNotification.mock.calls[0][1]).toMatchObject({ tag: "order-1", requireInteraction: true,
    data: { url: "https://resto237.vercel.app/", actionUrls: { view: "https://resto237.vercel.app/orders/1" } } });
});

it("ignores malformed payloads", () => {
  const w = worker();
  w.background({ data: { payload: "not json" } });
  expect(w.showNotification).not.toHaveBeenCalled();
});
