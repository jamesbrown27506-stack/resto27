"use client";

/**
 * Light or dark. That's the whole model.
 *
 * There is no "system" option: on first visit the OS preference is used as the
 * starting point, and from the moment the user touches the toggle their choice
 * wins. A three-state control asks people to reason about a mode they mostly
 * don't think about, and the toggle is the thing they actually wanted.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "restolink-theme";

/**
 * Runs before first paint. Must be inline and synchronous in <head>: applying
 * the attribute from an effect paints the light theme first, so a dark-theme
 * user gets a white flash on every navigation.
 *
 * IT ALSO WRITES THE COOKIE. That is the part that matters beyond the flash —
 * once the cookie exists, the SERVER renders `data-theme` itself and this
 * script has nothing left to do. Without it the server would be permanently
 * blind to the choice, which is exactly the bug the locale had.
 */
export const themeScript = `
(function(){
  try {
    var m = document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)/);
    var theme = m ? m[1]
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    if (!m) document.cookie = '${THEME_COOKIE}=' + theme + '; path=/; max-age=31536000; samesite=lax';
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

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
