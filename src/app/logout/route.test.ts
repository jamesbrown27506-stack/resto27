import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ signOut: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("@/lib/data/firebase-actions", () => ({ removeFirebaseDevice: mocks.remove }));
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); });
it("never changes session state for a GET or link prefetch", async () => {
  expect(GET(new NextRequest("https://resto.example/logout")).status).toBe(303);
  expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it.each([undefined, "https://attacker.example"])("rejects a POST from origin %s", async origin => {
  const response = await POST(new NextRequest("https://resto.example/logout", { method: "POST", headers: origin ? { origin } : {} }));
  expect(response.status).toBe(403); expect(mocks.signOut).not.toHaveBeenCalled();
});
it("signs out and removes the device for a same-origin POST", async () => {
  expect((await POST(new NextRequest("https://resto.example/logout", { method: "POST", headers: { origin: "https://resto.example" } }))).status).toBe(303);
  expect(mocks.signOut).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledOnce();
});
it("preserves the actual request host when Next normalizes a loopback URL", async () => {
  const response = await POST(new NextRequest("http://localhost:3127/logout", {
    method: "POST", headers: { host: "127.0.0.1:3127", origin: "http://127.0.0.1:3127" },
  }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("http://127.0.0.1:3127/login");
  expect(mocks.signOut).toHaveBeenCalledOnce();
});
