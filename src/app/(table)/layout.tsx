/**
 * A focused shell for QR table service: no marketing header or footer, no
 * account navigation.
 *
 * THE RESTAURANT COMES FIRST. The header used to carry the platform's logo,
 * so the first thing a guest saw after scanning the table QR was "Resto237"
 * instead of the restaurant they were sitting in. The page now draws its own
 * header with the restaurant's logo and name (it knows which restaurant; this
 * layout does not), and the platform is a quiet "Propulsé par" line at the
 * bottom.
 */
export default function TableServiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <main id="main">{children}</main>
    </div>
  );
}
