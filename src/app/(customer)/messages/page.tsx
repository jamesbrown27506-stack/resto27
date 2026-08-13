import type { Metadata } from "next";
import { AccountShell } from "@/components/layout/account-shell";
import { ChatInbox } from "@/components/chat/chat-inbox";
import { requireUser } from "@/lib/auth/session";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// A conversation can start while this page is open; a cached copy would hide
// new threads until someone reloads.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["cmsg.title"] };
}

export default async function CustomerMessagesPage() {
  const user = await requireUser();
  const locale = await getLocale();

  return (
    <AccountShell
      user={user}
      title={DICTIONARIES[locale]["cmsg.title"]}
      description={DICTIONARIES[locale]["cmsg.subtitle"]}
    >
      <ChatInbox mode="customer" myId={user.id} />
    </AccountShell>
  );
}
