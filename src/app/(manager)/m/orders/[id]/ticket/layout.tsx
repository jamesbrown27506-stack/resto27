/**
 * The printable ticket escapes the manager shell.
 *
 * An 80 mm thermal printer gets a bare document — no sidebar, no banner, no
 * navigation. This layout renders its children and nothing else (§14.4).
 */
export default function TicketLayout({ children }: { children: React.ReactNode }) {
  return <div data-theme="light" className="min-h-dvh bg-white">{children}</div>;
}
