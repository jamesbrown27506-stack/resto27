import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmailHtml, type EmailBrand } from "./email-layout";

const BRAND: EmailBrand = {
  name: "Resto237",
  tagline: "Commandez vos plats préférés à Douala",
  logoUrl: null,
  siteUrl: "https://resto237.online",
  supportEmail: "contact@resto237.online",
};

describe("renderEmailHtml", () => {
  it("escapes what the sender wrote — a support reply is user text", () => {
    const html = renderEmailHtml({ subject: "Re: <b>", body: "Merci <script>alert(1)</script>" }, BRAND);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`"&'`)).toBe("&quot;&amp;&#39;");
  });

  it("turns the action into a button and drops its bare URL from the text", () => {
    const url = "https://resto237.online/orders/RL-0147";
    const html = renderEmailHtml(
      { subject: "Commande confirmée", body: `Commande confirmée\n\nChez Marcel a confirmé.\n${url}\n\n— Resto237`, action: { label: "Suivre", url } },
      BRAND,
    );
    expect(html).toContain(">Suivre</a>");
    // Once in the button, once in the copy-this-link fallback — not a third time in the body.
    expect(html.split(`href="${url}"`).length - 1).toBe(2);
  });

  it("uses the title as the heading instead of repeating it as the first paragraph", () => {
    const html = renderEmailHtml({ subject: "Nouvelle commande", body: "Nouvelle commande\n\nRL-0147 · 7 500 FCFA" }, BRAND);
    expect(html.match(/Nouvelle commande/g)?.length).toBe(2); // <title> and <h1>
  });

  it("links bare URLs and falls back to the app icon without a logo", () => {
    const html = renderEmailHtml({ subject: "Hi", body: "Sign in at https://resto237.online/login" }, BRAND);
    expect(html).toContain('<a href="https://resto237.online/login"');
    expect(html).toContain("https://resto237.online/app-icon-192.png");
  });

  it("shows the test-mode notice when a message was diverted", () => {
    const html = renderEmailHtml({ subject: "Hi", body: "Body", notice: "TEST → a@b.cm" }, BRAND);
    expect(html).toContain("TEST → a@b.cm");
  });
});
