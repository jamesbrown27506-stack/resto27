import { describe, expect, it } from "vitest";
import { isPushServiceEndpoint } from "./push-endpoint";

describe("isPushServiceEndpoint", () => {
  it("accepts the endpoints browsers actually hand out", () => {
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc:APA91b")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")).toBe(true);
    expect(isPushServiceEndpoint("https://web.push.apple.com/QGuQyavXutnMH")).toBe(true);
    expect(isPushServiceEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=BQYAAA")).toBe(true);
  });

  it("refuses any other host, scheme, port or credentials", () => {
    expect(isPushServiceEndpoint("https://attacker.example/hook")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com.attacker.example/x")).toBe(false);
    expect(isPushServiceEndpoint("https://evilfcm.googleapis.com.example/x")).toBe(false);
    expect(isPushServiceEndpoint("http://fcm.googleapis.com/fcm/send/x")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com:8443/fcm/send/x")).toBe(false);
    expect(isPushServiceEndpoint("https://user:pw@fcm.googleapis.com/fcm/send/x")).toBe(false);
    expect(isPushServiceEndpoint("not a url")).toBe(false);
    expect(isPushServiceEndpoint(`https://fcm.googleapis.com/${"a".repeat(2100)}`)).toBe(false);
  });
});
