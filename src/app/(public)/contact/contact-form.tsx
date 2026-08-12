"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * Support form → `support_messages` (§14.1).
 *
 * The honeypot is a real field, visually hidden and out of the tab order, that
 * humans never fill. Server-side this must be paired with CSRF and a per-IP
 * rate limit (P3) — a honeypot alone stops naive bots, nothing more.
 */
export function ContactForm() {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    // Fixture behaviour. Becomes a Server Action in P14.
    window.setTimeout(() => {
      setSending(false);
      setSent(true);
      toast("Message envoyé. Nous répondons sous 24 heures.", "success");
    }, 700);
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

      <Button type="submit" size="lg" loading={sending} className="self-start">
        <Send className="size-4" aria-hidden />
        Envoyer le message
      </Button>
    </form>
  );
}
