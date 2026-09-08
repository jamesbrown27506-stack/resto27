export const SOCIAL_PLATFORMS = [
  {
    id: "facebook",
    label: "Facebook",
    placeholder: "https://www.facebook.com/resto237",
    hosts: ["facebook.com", "fb.com"],
  },
  {
    id: "instagram",
    label: "Instagram",
    placeholder: "https://www.instagram.com/resto237",
    hosts: ["instagram.com"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    placeholder: "https://wa.me/237600000000",
    hosts: ["wa.me", "whatsapp.com"],
  },
  {
    id: "tiktok",
    label: "TikTok",
    placeholder: "https://www.tiktok.com/@resto237",
    hosts: ["tiktok.com"],
  },
  {
    id: "youtube",
    label: "YouTube",
    placeholder: "https://www.youtube.com/@resto237",
    hosts: ["youtube.com", "youtu.be"],
  },
  {
    id: "x",
    label: "X",
    placeholder: "https://x.com/resto237",
    hosts: ["x.com", "twitter.com"],
  },
] as const;

export type SocialPlatformId = (typeof SOCIAL_PLATFORMS)[number]["id"];

export interface SocialLink {
  platform: SocialPlatformId;
  label: string;
  url: string;
}

export function socialUrlIsValid(platform: SocialPlatformId, value: string): boolean {
  if (!value.trim()) return false;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const definition = SOCIAL_PLATFORMS.find((item) => item.id === platform);
    return Boolean(
      definition?.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
    );
  } catch {
    return false;
  }
}

export function socialEnabledKey(platform: SocialPlatformId) {
  return `social_${platform}_enabled`;
}

export function socialUrlKey(platform: SocialPlatformId) {
  return `social_${platform}_url`;
}
