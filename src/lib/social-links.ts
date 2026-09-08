import "server-only";
import { cache } from "react";
import { getSettingsMap } from "@/lib/settings-map";
import {
  SOCIAL_PLATFORMS,
  socialEnabledKey,
  socialUrlIsValid,
  socialUrlKey,
  type SocialLink,
} from "@/lib/social-platforms";

export const getSocialLinks = cache(async (): Promise<SocialLink[]> => {
  const settings = await getSettingsMap();

  return SOCIAL_PLATFORMS.flatMap((platform) => {
    const enabled = settings.get(socialEnabledKey(platform.id)) === "true";
    const url = settings.get(socialUrlKey(platform.id))?.trim() ?? "";

    if (!enabled || !socialUrlIsValid(platform.id, url)) return [];
    return [{ platform: platform.id, label: platform.label, url }];
  });
});
