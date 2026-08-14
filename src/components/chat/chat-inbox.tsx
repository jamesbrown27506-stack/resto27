"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, MessageSquare, Plus, Send, Store, X } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  closeConversation,
  getConversation,
  listBranchConversations,
  listChatTargets,
  listMyConversations,
  markConversationRead,
  sendMessage,
  startConversation,
  type ChatConversationSummary,
  type ChatMessage,
  type ChatThread,
} from "@/lib/data/chat-actions";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * The messaging screen, shared by every side.
 *
 *  · customer — /messages   : their threads + a "new conversation" form
 *    (pick a restaurant, or write to the RestoLink team);
 *  · staff    — /m/messages : the ACTIVE branch's threads (branch-scoped);
 *  · platform — /m/messages : the RESTAURANT'S OWN thread with the platform.
 *    Same screen, other direction: here the manager is the one writing, and
 *    an admin answers. Until this existed a tenant could be messaged by every
 *    diner in Douala and had no way to reach the operator they pay.
 *  · admin    — /a/messages : platform threads (restaurant_id IS NULL), which
 *    now carry restaurants as well as customers.
 *
 *  An open thread subscribes to Realtime INSERTs on conversation_messages,
 *  filtered by conversation id and RLS-scoped to participants, so a reply
 *  lands on screen without a refresh — and its arrival clears MY unread
 *  counter while I am looking at it.
 */

function timeLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay =
    new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type Mode = "customer" | "staff" | "admin" | "platform";

/** Modes whose user may OPEN a thread, not only answer one. */
const CAN_COMPOSE: Mode[] = ["customer", "platform"];

export function ChatInbox({
  mode,
  myId,
  restaurantId,
  platformName,
}: {
  mode: Mode;
  myId: string;
  /** Staff mode: the active branch. */
  restaurantId?: string | null;
  /**
   * THE PLATFORM'S OWN NAME, from /a/settings — not the string "RestoLink".
   *
   * Half this screen is about writing to "the team", and every one of those
   * sentences had the default brand name baked into the translation. Renaming
   * the platform therefore renamed it everywhere except the place where
   * customers talk to it. Every `{name}` in the chat dictionary is filled
   * from here.
   */
  platformName: string;
}) {
  const { locale, t: translate } = useLocale();
  const { toast } = useToast();
  const prefix =
    mode === "staff" ? "mchat" : mode === "platform" ? "msup" : mode === "admin" ? "achat" : "cmsg";

  // Every string on this screen may interpolate the platform name, so it is
  // supplied once here rather than at forty call sites.
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(key, { name: platformName, ...vars }),
    [translate, platformName],
  );
  const tKey = (key: string) => `${prefix}.${key}` as TranslationKey;
  void locale;

  const [list, setList] = useState<ChatConversationSummary[] | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread?.messages.length]);

  function refreshList() {
    // Both actions agree on the return; only listBranchConversations reads the
    // arg, so one signature serves both modes.
    const fn: (id: string) => Promise<ChatConversationSummary[]> =
      mode === "staff" ? listBranchConversations : listMyConversations;
    void fn(restaurantId ?? "")
      .then((rows) => setList(rows))
      .catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const fn: (id: string) => Promise<ChatConversationSummary[]> =
        mode === "staff" ? listBranchConversations : listMyConversations;
      // listMyConversations ignores the argument; only the staff list reads it.
      const rows = await fn(restaurantId ?? "");
      if (!cancelled) setList(rows);
    };
    void load().catch(() => {});
    // A conversation that arrived while the tab was elsewhere shows up on focus.
    const onVisible = () => refreshList();
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, restaurantId]);

  function open(id: string) {
    setSelectedId(id);
    startTransition(async () => {
      const [threadData, read] = await Promise.all([
        getConversation(id).catch(() => null),
        markConversationRead(id).catch(() => ({ ok: false as const })),
      ]);
      if (threadData) setThread(threadData);
      void read;
      setList((rows) =>
        rows ? rows.map((r) => (r.id === id ? { ...r, unread: 0 } : r)) : rows,
      );
    });
  }

  // Realtime: a new message lands in the open thread without a refresh.
  useEffect(() => {
    if (!selectedId) return;
    let channel: RealtimeChannel | null = null;

    const supabase = createClient();
    channel = supabase
      .channel(`chat-thread-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string;
            sender_role: "customer" | "manager" | "admin";
            body: string;
            read_at: string | null;
            created_at: string;
          };
          const incoming: ChatMessage = {
            id: row.id,
            senderId: row.sender_id,
            senderRole: row.sender_role,
            senderName: row.sender_id === myId ? t(tKey("you")) : (thread?.peerName ?? row.sender_role),
            body: row.body,
            read: false,
            createdAt: row.created_at,
          };
          setThread((t) => (t ? { ...t, messages: [...t.messages, incoming] } : t));
          // A reply while I am looking at it is read immediately — never a
          // badge I must clear myself.
          if (row.sender_id !== myId) {
            void markConversationRead(selectedId).catch(() => {});
            refreshList();
          }
        },
      )
      .subscribe();

    return () => {
      void channel?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, myId]);

  function send(body: string) {
    if (!selectedId || !body.trim()) return;
    startTransition(async () => {
      const result = await sendMessage({ conversationId: selectedId, body: body.trim() });
      if (!result.ok) return toast(result.error ?? t(tKey("failed")), "error");
      setDraft("");
      // The other side's server-side read of the counter just moved; refetch
      // the thread so read markers and canPost are truthful.
      const fresh = await getConversation(selectedId).catch(() => null);
      if (fresh) setThread(fresh);
      refreshList();
      toast(t(tKey("sent")), "success");
    });
  }

  function startNew(input: { restaurantId: string | null; subject: string; body: string }) {
    startTransition(async () => {
      const result = await startConversation(input);
      if (!result.ok) return toast(result.error ?? t(tKey("failed")), "error");
      setComposing(false);
      setDraft("");
      setSelectedId(result.conversationId!);
      const fresh = await getConversation(result.conversationId!).catch(() => null);
      if (fresh) setThread(fresh);
      refreshList();
      toast(t(tKey("started")), "success");
    });
  }

  function toggleClose() {
    if (!selectedId) return;
    startTransition(async () => {
      await closeConversation(selectedId);
      setThread((t) => (t ? { ...t, status: t.status === "closed" ? "open" : "closed", canPost: !t.canPost } : t));
      refreshList();
    });
  }

  if (list === null) {
    return <div className="p-8 text-center text-sm text-text-light">{t("common.loading")}</div>;
  }

  const selectedSummary = list.find((c) => c.id === selectedId);

  /*
    ONE PANE AT A TIME ON A PHONE.

    Both panes always rendered, so a phone showed the list AND, stacked under
    it, the other pane — which is why an inbox with conversations in it also
    displayed "No conversations" a few centimetres below them. The back arrow
    in the thread header has always implied master/detail; this is the half
    that was missing. Above lg both panes sit side by side as before.
  */
  const detailOpen = composing || Boolean(thread && selectedId);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      {/* ── The list ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "min-w-0 lg:block lg:border-r lg:border-border lg:pr-4",
          detailOpen && "hidden",
        )}
      >
        {CAN_COMPOSE.includes(mode) && (
          <Button
            variant="outline"
            fullWidth
            className="mb-3"
            disabled={pending}
            onClick={() => {
              setComposing(true);
              setSelectedId(null);
              setThread(null);
            }}
          >
            <Plus className="size-4" aria-hidden />
            <span>{t(tKey("new"))}</span>
          </Button>
        )}

        {list.length === 0 ? (
          <EmptyState icon={<MessageSquare />} title={t(tKey("empty"))} description={t(tKey("emptyBody"))} />
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                    selectedId === c.id
                      ? "border-primary bg-primary-light/40"
                      : "border-transparent hover:bg-surface-2",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <MessageSquare className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{c.peerName}</span>
                      <span className="shrink-0 text-[10px] text-text-light">{timeLabel(c.lastMessageAt)}</span>
                    </span>
                    {/* The platform inbox now holds restaurants as well as
                        diners, and "your order is on its way" answered to a
                        restaurant owner is a mistake worth one small tag. */}
                    {c.peerRole === "manager" && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-hover">
                        <Store className="size-2.5" aria-hidden />
                        <span>{t("mchat.peer.restaurant")}</span>
                      </span>
                    )}
                    <span className="mt-0.5 block truncate text-xs text-text-secondary">
                      {c.lastMessage ?? c.subject}
                    </span>
                  </span>
                  {c.unread > 0 && (
                    <span className="tnum grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-fg">
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── The thread (or the new-conversation form) ────────────────── */}
      <div className={cn("min-w-0", !detailOpen && "hidden lg:block")}>
        {composing && CAN_COMPOSE.includes(mode) ? (
          <NewConversationForm
            prefix={prefix}
            platformName={platformName}
            // A restaurant has exactly one correspondent here — the platform —
            // so there is no picker to show, and the server forces it anyway.
            pickTarget={mode === "customer"}
            pending={pending}
            onCancel={() => setComposing(false)}
            onSend={startNew}
          />
        ) : thread && selectedId ? (
          <div className="flex h-[68dvh] min-h-80 flex-col overflow-hidden rounded-lg border border-border lg:h-[32rem]">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label={t(tKey("back"))}
                  onClick={() => {
                    setSelectedId(null);
                    setThread(null);
                  }}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                </Button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {thread.subject ? thread.subject : thread.peerName}
                  </p>
                  <p className="truncate text-xs text-text-light">
                    {selectedSummary?.unread
                      ? `${t("notif.unreadCount", { count: selectedSummary.unread })} · `
                      : ""}
                    {thread.peerName}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={toggleClose}>
                <span>{t(tKey(thread.status === "closed" ? "reopen" : "close"))}</span>
              </Button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {thread.messages.length === 0 && (
                <p className="pt-10 text-center text-sm text-text-light">{t("common.loading")}</p>
              )}
              {thread.messages.map((m) => {
                const mine = m.senderId === myId;
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        // min-w-0 so the bubble may actually shrink, and
                        // wrap-anywhere so an unbroken 200-character URL
                        // breaks instead of pushing the whole thread — and
                        // the timestamp under it — off the side of a phone.
                        "min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[80%]",
                        mine
                          ? "rounded-br-sm bg-primary text-primary-fg"
                          : "rounded-bl-sm bg-surface-2 text-text",
                      )}
                    >
                      {!mine && (
                        <p className="mb-0.5 truncate text-[10px] font-semibold text-text-light">
                          {m.senderName}
                        </p>
                      )}
                      <p className="wrap-anywhere whitespace-pre-wrap">{m.body}</p>
                      <p className={cn("mt-1 text-right text-[10px]", mine ? "text-primary-fg/70" : "text-text-light")}>
                        {timeLabel(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {thread.canPost ? (
              <form
                className="flex items-end gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(draft);
                }}
              >
                <Textarea
                  value={draft}
                  rows={1}
                  placeholder={t(tKey("placeholder"))}
                  className="min-h-10 max-h-32 flex-1 resize-y"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(draft);
                    }
                  }}
                />
                <Button type="submit" size="icon" loading={pending} disabled={pending || !draft.trim()}>
                  <Send className="size-4" aria-hidden />
                </Button>
              </form>
            ) : (
              <div className="border-t border-border p-3 text-center text-sm text-text-light">
                {t(tKey("closed"))}
              </div>
            )}
          </div>
        ) : (
          /*
            DIFFERENT COPY FROM THE LIST'S EMPTY STATE, on purpose. This pane
            is "you have not opened one yet"; the list's is "there are none".
            Sharing one string made a full inbox announce that it was empty.
          */
          <EmptyState
            icon={<MessageSquare />}
            title={t(tKey(list.length === 0 ? "empty" : "pick"))}
            description={t(tKey(list.length === 0 ? "emptyBody" : "pickBody"))}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Open a thread: pick who it is with (customers only — a restaurant writes to
 * the platform and nobody else) and send the first message.
 */
function NewConversationForm({
  prefix,
  platformName,
  pickTarget,
  pending,
  onCancel,
  onSend,
}: {
  /** `cmsg` for the customer screen, `msup` for the restaurant's support. */
  prefix: string;
  platformName: string;
  pickTarget: boolean;
  pending: boolean;
  onCancel: () => void;
  onSend: (input: { restaurantId: string | null; subject: string; body: string }) => void;
}) {
  const { t: translate } = useLocale();
  const t = (key: TranslationKey) => translate(key, { name: platformName });
  const tKey = (key: string) => `${prefix}.${key}` as TranslationKey;
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null);
  const [restaurantId, setRestaurantId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!pickTarget) return;
    void listChatTargets()
      .then(setTargets)
      .catch(() => setTargets([]));
  }, [pickTarget]);

  const toPlatform = !pickTarget || restaurantId === "";
  const canSend = body.trim().length > 0;

  return (
    <div className="rounded-lg border border-border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{t(tKey("newTitle"))}</h2>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t("common.close")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {pickTarget && (
          <Field label={t(tKey("pickTarget"))}>
            <select
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
              className="h-10 rounded-md border border-border bg-bg px-3 text-sm"
            >
              <option value="">{t(tKey("platform"))}</option>
              {targets?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {targets === null && (
              <p className="mt-1 text-xs text-text-light">{t("common.loading")}</p>
            )}
          </Field>
        )}

        <Field label={t(tKey("subject"))}>
          <Input
            value={subject}
            placeholder={t(tKey("subjectPh"))}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>

        <Field label={t(tKey("body"))}>
          <Textarea
            value={body}
            rows={4}
            placeholder={t(tKey("bodyPh"))}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        <Button
          className="self-start"
          loading={pending}
          disabled={pending || !canSend}
          onClick={() => onSend({ restaurantId: toPlatform ? null : restaurantId, subject, body })}
        >
          <Send className="size-4" aria-hidden />
          <span>{t(tKey("send"))}</span>
        </Button>
      </div>
    </div>
  );
}
