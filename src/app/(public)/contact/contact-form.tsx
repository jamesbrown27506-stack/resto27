"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { submitSupportMessage } from "@/lib/data/platform-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * Support form → `support_messages` (§14.1).
 *
 * The honeypot is a real field, visually hidden and out of the tab order, that
 * humans never fill — the server discards any submission that contains one.
 * Server-side there is also a per-IP rate limit (P3); a honeypot alone stops
 * naive bots, nothing more.
 */
export function ContactForm() {
  const { toast } = useToast();
  const { t } = useLocale();
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await submitSupportMessage({
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        subject: String(data.get("subject") ?? ""),
        body: String(data.get("body") ?? ""),
        website: String(data.get("website") ?? ""),
      });

      if (result.ok) {
        setSent(true);
        toast(t("mk.contact.form.sentToast"), "success");
      } else {
        toast(result.error ?? t("mk.contact.form.failedToast"), "error");
      }
    });
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-success/30 bg-success-light p-8 text-center">
        <h2 className="font-display text-xl font-bold text-success">
          {t("mk.contact.form.sentTitle")}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">{t("mk.contact.form.sentBody")}</p>
        <Button variant="outline" className="mt-5" onClick={() => setSent(false)}>
          {t("mk.contact.form.sendAnother")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("mk.contact.form.name")} htmlFor="c-name" required>
          <Input
            id="c-name"
            name="name"
            required
            autoComplete="name"
            placeholder={t("mk.contact.form.namePh")}
          />
        </Field>
        <Field label={t("mk.contact.form.email")} htmlFor="c-email" required>
          <Input
            id="c-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t("mk.contact.form.emailPh")}
          />
        </Field>
      </div>

      <Field label={t("mk.contact.form.subject")} htmlFor="c-subject" required>
        <Input
          id="c-subject"
          name="subject"
          required
          placeholder={t("mk.contact.form.subjectPh")}
        />
      </Field>

      <Field label={t("mk.contact.form.message")} htmlFor="c-body" required>
        <Textarea
          id="c-body"
          name="body"
          required
          rows={6}
          placeholder={t("mk.contact.form.messagePh")}
        />
      </Field>

      {/* Honeypot — hidden from sight AND from the tab order. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="c-website">{t("mk.contact.form.honeypot")}</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" size="lg" loading={pending} disabled={pending} className="self-start">
        <Send className="size-4" aria-hidden />
        {t("mk.contact.form.send")}
      </Button>
    </form>
  );
}
