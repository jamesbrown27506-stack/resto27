"use client";

import { useState, useTransition } from "react";
import { Megaphone, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Panel } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Radio, Switch, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format/datetime";
import { sendBroadcast } from "@/lib/data/platform-actions";
import type { BroadcastRow } from "@/lib/data/platform";

const AUDIENCES = [
  { value: "everyone", label: "Everyone", countKey: "everyone" },
  { value: "managers", label: "Restaurant owners", countKey: "managers" },
  { value: "customers", label: "Customers", countKey: "customers" },
  { value: "admins", label: "Administrators", countKey: "admins" },
] as const;

export function BroadcastComposer({
  history,
  counts,
}: {
  history: BroadcastRow[];
  counts: Record<string, number>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [audience, setAudience] = useState<string>("managers");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const selected = AUDIENCES.find((a) => a.value === audience)!;
  const recipientCount = counts[selected.countKey] ?? 0;
  const ready = subject.trim().length >= 4 && body.trim().length >= 10 && recipientCount > 0;

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Panel title="Audience" description="Counts are live active accounts, not estimates.">
            <CardBody>
              <fieldset>
                <legend className="sr-only">Choose an audience</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AUDIENCES.map((a) => (
                    <Radio
                      key={a.value}
                      name="audience"
                      checked={audience === a.value}
                      onChange={() => setAudience(a.value)}
                      label={a.label}
                      trailing={String(counts[a.countKey] ?? 0)}
                    />
                  ))}
                </div>
              </fieldset>
            </CardBody>
          </Panel>

          <Panel title="Message">
            <CardBody className="flex flex-col gap-5">
              <Field label="Subject" htmlFor="bc-subject" required>
                <Input
                  id="bc-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="New: detailed sales reports"
                />
              </Field>

              <Field label="Message" htmlFor="bc-body" required>
                <Textarea
                  id="bc-body"
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Hello,&#10;&#10;…"
                />
              </Field>

              <Switch
                label="Also send by email"
                description="Each recipient who has email notifications enabled also gets this in their inbox. Recipients can mute it in their settings."
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
            </CardBody>
          </Panel>

          <Panel title="Previous broadcasts">
            {history.length === 0 ? (
              <EmptyState
                icon={<Megaphone />}
                title="Nothing sent yet"
                description="Broadcasts you send appear here with their real delivered count."
              />
            ) : (
              <ul className="divide-y divide-border">
                {history.map((b) => (
                  <li key={b.id} className="px-5 py-4">
                    <p className="font-medium">{b.subject}</p>
                    <p className="mt-0.5 text-sm text-text-secondary">
                      {b.audience} · {b.recipientCount} recipient
                      {b.recipientCount === 1 ? "" : "s"} · {b.channels}
                    </p>
                    <p className="tnum mt-0.5 text-xs text-text-light">
                      {formatDateTime(b.sentAt)} by {b.sentByEmail}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-24">
          <Card>
            <CardBody>
              <Users className="size-5 text-primary" aria-hidden />
              <p className="tnum mt-3 font-display text-3xl font-bold">{recipientCount}</p>
              <p className="mt-1 text-sm text-text-secondary">{selected.label}</p>

              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-4">
                <Badge tone="primary">In-app</Badge>
                {sendEmail && <Badge tone="info">Email</Badge>}
              </div>

              <Button
                fullWidth
                size="lg"
                className="mt-5"
                disabled={!ready || pending}
                loading={pending}
                onClick={() => setConfirming(true)}
              >
                <Send className="size-4" aria-hidden />
                <span>Send</span>
              </Button>

              {!ready && (
                <p className="mt-2 text-center text-xs text-text-light">
                  {recipientCount === 0
                    ? "This audience has no active members."
                    : "Add a subject and a message."}
                </p>
              )}
            </CardBody>
          </Card>

          <Card className="bg-surface-2">
            <CardBody>
              <Megaphone className="size-4 text-text-light" aria-hidden />
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                A broadcast cannot be recalled once sent. Read the subject back — it is what most
                people will see.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          startTransition(async () => {
            const result = await sendBroadcast({ subject, body, audience, sendEmail });
            if (result.ok) {
              setSubject("");
              setBody("");
              toast(`Sent to ${recipientCount} recipient(s).`, "success");
            } else {
              toast(result.error, "error");
            }
          });
        }}
        title="Send this broadcast?"
        message={`It will reach ${recipientCount} active ${selected.label.toLowerCase()} as an in-app notification${sendEmail ? " and by email" : ""}. This cannot be undone.`}
        confirmLabel="Send now"
      />
    </>
  );
}
