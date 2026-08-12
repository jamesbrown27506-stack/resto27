/**
 * The kitchen display escapes the manager shell entirely.
 *
 * No sidebar, no subscription banner, no page chrome — every pixel goes to the
 * tickets. This layout renders its children and nothing else, which is the
 * whole reason it exists (§14.4).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT USED TO FORCE `data-theme="dark"` HERE, AND NO LONGER DOES.
 *
 *  The argument for forcing it was real: this screen is read from across a
 *  kitchen, often on a wall-mounted tablet, and white-on-dark at large sizes
 *  carries further under fluorescent light. But it is an argument, not a
 *  fact about every kitchen — and overriding a preference the user set two
 *  minutes ago reads as a bug whatever the reasoning behind it.
 *
 *  The screen now follows the theme like everything else. Anyone who wants
 *  the dark display gets it from the toggle, and it persists.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-bg text-text">{children}</div>;
}
