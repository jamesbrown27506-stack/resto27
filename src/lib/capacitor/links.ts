const ORIGIN = "https://resto237.online";

/** Only product pages may be reached through an untrusted link/push payload. */
export function safeNativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    let url: URL;
    if (value.startsWith("/")) {
      if (value.startsWith("//")) return null;
      url = new URL(value, ORIGIN);
    } else {
      url = new URL(value);
      if (url.protocol === "resto237:") {
        const path = `${url.hostname && url.hostname !== "app" ? `/${url.hostname}` : ""}${url.pathname || "/"}${url.search}${url.hash}`;
        return safeNativePath(path);
      }
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["resto237.online", "www.resto237.online"].includes(url.hostname)) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (/[\\\u0000-\u0020]/.test(decoded) || decoded.startsWith("//") ||
        /^\/(?:api|logout|auth)(?:\/|$)/.test(decoded)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}

/** Email confirmation/reset is allowed only from an OS-opened HTTPS link,
 * never from notification data. The server still verifies Supabase's PKCE code. */
export function nativeAuthCallback(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["resto237.online", "www.resto237.online"].includes(url.hostname) || url.pathname !== "/auth/callback") return null;
    const code = url.searchParams.get("code");
    if (!code || !/^[A-Za-z0-9_-]{8,2048}$/.test(code)) return null;
    const next = safeNativePath(url.searchParams.get("next")) ?? "/account";
    return `/auth/callback?${new URLSearchParams({ code, next })}`;
  } catch { return null; }
}
