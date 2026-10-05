"use client";

import { useRef, useState } from "react";
import { Camera, Mail, Phone, ShieldCheck, User } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { PasswordInput, PasswordStrength, passwordMeetsPolicy } from "@/components/auth/auth-parts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  changeOwnPassword,
  updateOwnProfile,
  uploadOwnAvatar,
} from "@/lib/data/profile-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { SessionUser } from "@/lib/session";

export function ProfileClient({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const { t } = useLocale();

  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function saveInfo() {
    setBusy(true);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("phone", phone);
    const result = await updateOwnProfile(formData);
    setBusy(false);
    if (result.ok) toast(t("cpf.saved"), "success");
    else toast(result.error, "error");
  }

  async function savePassword() {
    setBusy(true);
    const formData = new FormData();
    formData.set("current", current);
    formData.set("password", password);
    formData.set("confirm", confirm);
    const result = await changeOwnPassword(formData);
    setBusy(false);
    if (result.ok) {
      setCurrent("");
      setPassword("");
      setConfirm("");
      toast(t("cpf.passwordChanged"), "success");
    } else {
      toast(result.error, "error");
    }
  }

  async function uploadAvatar(file: File) {
    setBusy(true);
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadOwnAvatar(formData);
    setBusy(false);
    if (result.ok) toast(t("cpf.photoUpdated"), "success");
    else toast(result.error ?? t("cpf.photoFailed"), "error");
  }

  return (
    <AccountShell user={user} title={t("cpf.title")} description={t("cpf.subtitle")}>
      <div className="flex flex-col gap-6">
        <Panel title={t("cpf.photo")}>
          <div className="flex flex-wrap items-center gap-5 p-5">
            <Avatar name={user.name} src={user.avatarUrl} size="xl" />
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAvatar(file);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Camera className="size-4" aria-hidden />
                {t("cpf.pickImage")}
              </Button>
              <p className="mt-2 text-xs text-text-light">{t("cpf.photoHint")}</p>
            </div>
          </div>
        </Panel>

        <Panel title={t("cpf.info")}>
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label={t("cpf.name")} htmlFor="pf-name" required>
              <Input
                id="pf-name"
                icon={<User />}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </Field>

            <Field
              label={t("cpf.phone")}
              htmlFor="pf-phone"
              required
              hint={t("cpf.phoneHint")}
            >
              <Input
                id="pf-phone"
                type="tel"
                icon={<Phone />}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </Field>

            <Field
              label={t("cpf.email")}
              htmlFor="pf-email"
              className="sm:col-span-2"
              hint={t("cpf.emailHint")}
            >
              <Input
                id="pf-email"
                type="email"
                icon={<Mail />}
                value={user.email}
                disabled
                autoComplete="email"
              />
            </Field>
          </div>

          <div className="border-t border-border p-5">
            <Button disabled={busy} onClick={saveInfo}>
              {t("cpf.saveInfo")}
            </Button>
          </div>
        </Panel>

        <Panel
          title={t("cpf.password")}
          description={t("cpf.passwordBody")}
        >
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label={t("cpf.currentPassword")} htmlFor="pf-current" required className="sm:col-span-2">
              <PasswordInput
                id="pf-current"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>

            <Field label={t("cpf.newPassword")} htmlFor="pf-new" required className="sm:col-span-2">
              <PasswordInput
                id="pf-new"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrength value={password} />
            </Field>

            <Field
              label={t("cpf.confirm")}
              htmlFor="pf-confirm"
              required
              className="sm:col-span-2"
              error={mismatch ? t("cpf.mismatch") : undefined}
            >
              <PasswordInput
                id="pf-confirm"
                autoComplete="new-password"
                invalid={mismatch}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-border p-5">
            <Button
              disabled={busy || !current || !passwordMeetsPolicy(password) || password !== confirm}
              onClick={savePassword}
            >
              {t("cpf.changePassword")}
            </Button>
            {/* Changing the password must revoke every other session (§14.2). */}
            <p className="flex items-center gap-2 text-xs text-text-light">
              <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
              {t("cpf.sessionsNote")}
            </p>
          </div>
        </Panel>
      </div>
    </AccountShell>
  );
}