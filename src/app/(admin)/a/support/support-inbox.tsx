"use client";

import { useState, useTransition } from "react";
import { Check, LifeBuoy, Mail, Send } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatRelative } from "@/lib/format/datetime";
import { replyToSupport, resolveSupport } from "@/lib/data/platform-actions";
import type { SupportRow } from "@/lib/data/platform";
import { cn } from "@/lib/utils";

const STATUS: Record<SupportRow["status"], { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "warning" },
  replied: { label: "Replied", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
};

export function SupportInbox({ messages }: { messages: SupportRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [selectedId, setSelectedId] = useState<string | null>(messages[0]?.id ?? null);
  const [reply, setReply] = useState("");

  const selected = messages.find((m) => m.id === selectedId) ?? null;

  function act(
    fn: () => Promise<{ ok: boolean; error?: string; note?: string }>,
    success: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error ?? "Something went wrong.", "error");
      // Saved, but the email did not go — warn rather than claim success.
      if (result.note) return toast(result.note, "warning");
      toast(success, "success");
    });
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={<LifeBuoy />}
          title="Inbox empty"
          description="Messages sent through the public contact form arrive here."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      {/* ── Threads ────────────────────────────────────────────────────── */}
      <ul className="overflow-hidden rounded-lg border border-border bg-surface lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
        {messages.map((message) => (
          <li key={message.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => {
                setSelectedId(message.id);
                setReply("");
              }}
              aria-current={message.id === selectedId ? "true" : undefined}
              className={cn(
                "flex w-full items-start gap-3 p-4 text-left transition-colors",
                message.id === selectedId ? "bg-primary-light" : "hover:bg-surface-2",
              )}
            >
              <Avatar name={message.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{message.name}</p>
                  <Badge tone={STATUS[message.status].tone}>{STATUS[message.status].label}</Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-text-secondary">{message.subject}</p>
                <p className="mt-0.5 text-xs text-text-light">
                  {formatRelative(message.createdAt)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* ── Conversation ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface">
        {!selected ? (
          <EmptyState
            icon={<LifeBuoy />}
            title="Nothing selected"
            description="Pick a conversation on the left."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">{selected.subject}</h2>
                <p className="mt-0.5 text-sm text-text-secondary">
                  {selected.name} ·{" "}
                  <a href={`mailto:${selected.email}`} className="hover:text-primary hover:underline">
                    {selected.email}
                  </a>
                </p>
                <p className="tnum mt-0.5 text-xs text-text-light">
                  {formatDateTime(selected.createdAt)}
                </p>
              </div>

              {selected.status !== "resolved" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => act(() => resolveSupport(selected.id), "Marked as resolved.")}
                >
                  <Check className="size-3.5" aria-hidden />
                  <span>Mark resolved</span>
                </Button>
              )}
            </div>

            <div className="p-5">
              <blockquote className="rounded-md bg-surface-2 p-4 leading-relaxed text-text-secondary">
                {selected.body}
              </blockquote>

              {selected.replyBody && (
                <div className="mt-4 rounded-md border-l-2 border-primary bg-primary-light p-4">
                  <p className="text-xs font-bold tracking-wide text-primary uppercase">
                    Replied by {selected.repliedBy}
                  </p>
                  <p className="mt-1.5 text-sm text-text-secondary">{selected.replyBody}</p>
                </div>
              )}

              <div className="mt-6">
                <label htmlFor="support-reply" className="mb-2 block text-sm font-semibold">
                  {selected.replyBody ? "Reply again" : "Reply"}
                </label>
                <Textarea
                  id="support-reply"
                  rows={6}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={`Hello ${selected.name.split(" ")[0]},\n\n`}
                />

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    disabled={pending || reply.trim().length < 10}
                    loading={pending}
                    onClick={() =>
                      act(() => {
                        const promise = replyToSupport(selected.id, reply);
                        setReply("");
                        return promise;
                      }, "Reply sent.")
                    }
                  >
                    <Send className="size-4" aria-hidden />
                    <span>Send reply</span>
                  </Button>
                  <p className="flex items-center gap-1.5 text-xs text-text-light">
                    <Mail className="size-3.5" aria-hidden />
                    Saved on the ticket and emailed to {selected.email}.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
