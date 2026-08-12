"use client";

import { useState, useTransition } from "react";
import { Mail, Phone, ShieldCheck, User } from "lucide-react";
import { ImageUpload } from "@/components/ui/image-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format/datetime";
import {
  changeOwnPassword,
  updateOwnProfile,
  uploadOwnAvatar,
} from "@/lib/data/profile-actions";

export interface OwnProfile {
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
}

export function ProfileForm({ profile }: { profile: OwnProfile }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  /**
   * The photo is chosen now and sent on Save, like the branding assets.
   * A picker that uploads the instant you touch it is the one control on a
   * form that cannot be undone by walking away.
   */
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);

  function selectPhoto(file: File) {
    const url = URL.createObjectURL(file);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto({ file, url });
  }

  function undoPhoto() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
  }

  const detailsDirty = name !== profile.name || phone !== (profile.phone ?? "");
  const passwordReady =
    password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password) && password === confirm;
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Panel title="Photo">
        <CardBody className="flex flex-col gap-4">
          <ImageUpload
            label="Profile photo"
            shape="circle"
            hint="Shown beside your name in the header. PNG, JPEG or WebP, up to 2 MB."
            previewUrl={photo?.url ?? profile.avatarUrl}
            dirty={photo !== null}
            disabled={pending}
            onSelect={selectPhoto}
            onUndo={undoPhoto}
          />

          {photo && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                loading={pending}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const formData = new FormData();
                    formData.append("file", photo.file);
                    const result = await uploadOwnAvatar(formData);
                    if (!result.ok) return toast(result.error ?? "Upload failed.", "error");

                    undoPhoto();
                    toast("Photo saved.", "success");
                  })
                }
              >
                Save photo
              </Button>
              <span className="text-sm text-text-light">Chosen, not saved yet.</span>
            </div>
          )}
        </CardBody>
      </Panel>

      <Panel title="Your details">
        <CardBody className="flex flex-col gap-5">
          <Field label="Full name" htmlFor="pf-name" required>
            <Input
              id="pf-name"
              icon={<User />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </Field>

          <Field label="Phone" htmlFor="pf-phone" hint="Optional. Used to reach you about incidents.">
            <Input
              id="pf-phone"
              type="tel"
              icon={<Phone />}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </Field>

          {/*
            Read-only on purpose. The email IS the login identity, so changing
            it needs a verification round-trip through Supabase Auth — letting
            it be edited here would either lock you out or quietly do nothing.
          */}
          <Field
            label="Email"
            htmlFor="pf-email"
            hint="This is your sign-in identity. Changing it needs email verification, so it is not editable here yet."
          >
            <Input id="pf-email" icon={<Mail />} value={profile.email} disabled readOnly />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!detailsDirty || pending}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const formData = new FormData();
                  formData.append("name", name);
                  formData.append("phone", phone);
                  const result = await updateOwnProfile(formData);
                  if (result.ok) toast("Profile saved.", "success");
                  else toast(result.error, "error");
                })
              }
            >
              Save changes
            </Button>
            {!detailsDirty && <span className="text-sm text-text-light">No changes.</span>}
          </div>
        </CardBody>
      </Panel>

      <Panel title="Password" description="Use one you do not use anywhere else.">
        <CardBody className="flex flex-col gap-5">
          <Field
            label="New password"
            htmlFor="pf-password"
            required
            hint="At least 8 characters, with an uppercase letter and a digit."
          >
            <Input
              id="pf-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Field
            label="Confirm"
            htmlFor="pf-confirm"
            required
            error={mismatch ? "The two passwords do not match." : undefined}
          >
            <Input
              id="pf-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              invalid={mismatch}
              autoComplete="new-password"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <Button
              disabled={!passwordReady || pending}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const formData = new FormData();
                  formData.append("password", password);
                  formData.append("confirm", confirm);
                  const result = await changeOwnPassword(formData);
                  if (result.ok) {
                    setPassword("");
                    setConfirm("");
                    toast("Password changed. Your other sessions were signed out.", "success");
                  } else {
                    toast(result.error, "error");
                  }
                })
              }
            >
              Change password
            </Button>
            <p className="flex items-center gap-2 text-xs text-text-light">
              <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
              Your other sessions will be signed out.
            </p>
          </div>
        </CardBody>
      </Panel>

      <Panel title="Account">
        <CardBody>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-secondary">Role</dt>
              <dd>
                <Badge tone="accent">{profile.role}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-secondary">Member since</dt>
              <dd className="tnum font-medium">{formatDate(profile.createdAt)}</dd>
            </div>
          </dl>
        </CardBody>
      </Panel>
    </div>
  );
}
