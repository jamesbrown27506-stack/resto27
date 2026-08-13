"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { submitSupportMessage } from "@/lib/data/platform-actions";

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
        toast("Message envoyé. Nous répondons sous 24 heures.", "success");
      } else {
        toast(result.error ?? "Impossible d'envoyer le message.", "error");
      }
    });
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-success/30 bg-success-light p-8 text-center">
        <h2 className="font-display text-xl font-bold text-success">Message bien reçu</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Notre équipe vous répond par email sous 24 heures ouvrées.
        </p>
        <Button variant="outline" className="mt-5" onClick={() => setSent(false)}>
          Envoyer un autre message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom complet" htmlFor="c-name" required>
          <Input id="c-name" name="name" required autoComplete="name" placeholder="Marie Ngo" />
        </Field>
        <Field label="Email" htmlFor="c-email" required>
          <Input
            id="c-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="vous@exemple.cm"
          />
        </Field>
      </div>

      <Field label="Sujet" htmlFor="c-subject" required>
        <Input id="c-subject" name="subject" required placeholder="Comment pouvons-nous aider ?" />
      </Field>

      <Field label="Message" htmlFor="c-body" required>
        <Textarea id="c-body" name="body" required rows={6} placeholder="Décrivez votre demande…" />
      </Field>

      {/* Honeypot — hidden from sight AND from the tab order. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="c-website">Ne pas remplir</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" size="lg" loading={pending} disabled={pending} className="self-start">
        <Send className="size-4" aria-hidden />
        Envoyer le message
      </Button>
    </form>
  );
}
