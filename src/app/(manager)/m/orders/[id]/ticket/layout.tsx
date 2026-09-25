/**
 * The printable ticket's frame.
 *
 * An 80 mm thermal printer needs a bare document — no sidebar, no banner, no
 * navigation (§14.4). A nested layout CANNOT escape the manager shell above
 * it, so on screen the ticket still sits inside the chrome; in PRINT every
 * piece of that chrome carries `no-print` (manager-shell.tsx, globals.css)
 * and only this white block reaches the paper.
 */
export default function TicketLayout({ children }: { children: React.ReactNode }) {
  return <div data-theme="light" className="min-h-dvh bg-white print:min-h-0">{children}</div>;
}
