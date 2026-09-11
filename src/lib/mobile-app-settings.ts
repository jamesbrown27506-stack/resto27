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
/** Off by default: a new version is offered, not imposed (migration 0050). */
export const UPDATE_REQUIRED_SETTING = "app_update_required";

export async function getMobileAppVisibility(): Promise<{ appDownload: boolean; pwaInstall: boolean; updateRequired: boolean }> {
  const map = await getSettingsMap();
  return {
    appDownload: settingBool(map, APP_DOWNLOAD_SETTING, true),
    pwaInstall: settingBool(map, PWA_INSTALL_SETTING, true),
    updateRequired: settingBool(map, UPDATE_REQUIRED_SETTING, false),
  };
}
