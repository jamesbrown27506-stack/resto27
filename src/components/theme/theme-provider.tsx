"use client";

/**
 * Light or dark, with the device as the default.
 *
 * Until a person touches the toggle there is no stored preference, so the page
 * follows the operating system and follows later device theme changes too.
 * The first toggle creates the explicit preference that then wins.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "restolink-theme";

/**
 * Runs before first paint so the initial page follows a saved choice or the
 * device theme without a visible light-theme flash. A cookie is created only
 * after a person uses the theme toggle.
 */
export const themeScript = `(function(){
  try {
    var cookiePattern = /(?:^|;\s*)${THEME_COOKIE}=(light|dark)/;
    var stored = document.cookie.match(cookiePattern);
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var applySystemTheme = function(matches) {
      if (!document.cookie.match(cookiePattern)) {
        document.documentElement.setAttribute('data-theme', matches ? 'dark' : 'light');
      }
    };

    if (stored) {
      document.documentElement.setAttribute('data-theme', stored[1]);
    } else {
      applySystemTheme(media.matches);
      if (media.addEventListener) media.addEventListener('change', function(event) {
        applySystemTheme(event.matches);
      });
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();`.trim();

/**
 * THE DOM IS THE SOURCE OF TRUTH, not React state.
 *
 * The script above may have set a theme the server never knew about (first
 * visit, dark OS preference). Reading the attribute at click time means the
 * toggle always flips from what the user can actually see, instead of from a
 * stale value React was seeded with. There is no state, so there is nothing to
 * disagree with the server about — which is the whole point.
 */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(next: Theme): void {
  document.documentElement.setAttribute("data-theme", next);
  try {
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Cookies blocked — the theme still applies for this page view.
  }
}

export function toggleTheme(): void {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
