import "server-only";
import { getSettingsMap, settingBool } from "@/lib/settings-map";

/**
 * The admin's two switches for the mobile app on the public site (migration
 * 0049, /a/settings → Mobile app).
 *
 * Both default to ON — the site as it was before the switches existed — so a
 * database without the rows renders the same pages. Neither matters inside the
 * native app, which hides the download section and the install popup itself.
 */
export const APP_DOWNLOAD_SETTING = "app_download_visible";
export const PWA_INSTALL_SETTING = "pwa_install_prompt";

export async function getMobileAppVisibility(): Promise<{ appDownload: boolean; pwaInstall: boolean }> {
  const map = await getSettingsMap();
  return {
    appDownload: settingBool(map, APP_DOWNLOAD_SETTING, true),
    pwaInstall: settingBool(map, PWA_INSTALL_SETTING, true),
  };
}
