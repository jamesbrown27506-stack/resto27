"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Bell,
  Bike,
  CreditCard,
  Gift,
  LayoutDashboard,
  Palette,
  ReceiptText,
  Save,
  Share2,
  Settings as Cog,
} from "lucide-react";
import { SocialIcon } from "@/components/icons/social-icon";
import { Button } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ImageUpload } from "@/components/ui/image-upload";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateSettings } from "@/lib/data/platform-actions";
import { clearBrandingAsset, uploadBrandingAsset } from "@/lib/data/profile-actions";
import { SoundPicker } from "./sound-picker";
import type { SettingRow } from "@/lib/data/platform";
import { cn } from "@/lib/utils";
import {
  SOCIAL_PLATFORMS,
  socialEnabledKey,
  socialUrlKey,
} from "@/lib/social-platforms";

/**
 * Tabbed settings.
 *
 * The flat list this replaced put branding, money and payment toggles in one
 * column — every setting equally prominent and nothing grouped by the decision
 * it belongs to. Tabs put you in one context at a time, which is how these are
 * actually changed: you come here to adjust billing, not to read all fifteen.
 *
 * Grouping is driven by `settings.category`, but a category ALSO needs an
 * entry in `TABS` below — see the note there. A category with no entry is not
 * a missing tab, it is settings nobody can reach.
 */
/**
 * EVERY CATEGORY NEEDS A ROW HERE, and the file header used to claim otherwise.
 *
 * `visibleTabs` filters this list against the categories actually present, so
 * the effect of a missing entry is not a missing tab — it is settings that
 * exist, are saved, are read by the app, and cannot be reached from the admin
 * screen at all. `loyalty` and `operations` had been in that state: nine keys
 * governing the points scheme and the platform delivery fee, editable only by
 * hand in the database.
 *
 * The `homepage` category was about to join them.
 */
const TABS = [
  { id: "branding", label: "Branding", icon: Palette, hint: "Read by every page, tab, email and share card." },
  { id: "social", label: "Social presence", icon: Share2, hint: "Choose the profiles shown publicly. A platform appears only when it is enabled and has a valid URL." },
  { id: "homepage", label: "Home page", icon: LayoutDashboard, hint: "Which figures the landing page advertises. Hide the ones that measure how small the platform is; keep the ones that measure how good it is. All four off removes the band entirely." },
  { id: "money", label: "Money", icon: Banknote, hint: "XAF is zero-decimal — every amount is whole francs." },
  { id: "billing", label: "Billing", icon: ReceiptText, hint: "Grace exists because mobile money renewal is not instant." },
  { id: "loyalty", label: "Loyalty", icon: Gift, hint: "Points are earned per 1 000 FCFA spent. The minimum is what a customer must hold before any of it can be spent." },
  { id: "operations", label: "Operations", icon: Bike, hint: "Defaults for restaurants that do not carry their own riders." },
  { id: "notifications", label: "Notifications", icon: Bell, hint: "The sound played on realtime notifications, and the web push master switch." },
  { id: "payments", label: "Payments", icon: CreditCard, hint: "Switch on only once the provider is verified end to end." },
  { id: "general", label: "General", icon: Cog, hint: "" },
] as const;

/**
 * The two image settings, DELIBERATELY EXCLUDED FROM `draft`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS EXCLUSION IS A BUG FIX, NOT A TIDY-UP.
 *
 *  `draft` is seeded from `settings` exactly once — useState ignores every
 *  later value of its argument. So while these keys lived in the draft it
 *  held whatever they were on first render, forever. A logo that arrived
 *  afterwards showed as a phantom "unsaved change", and pressing Save posted
 *  the stale empty string straight over the URL — which is exactly why the
 *  logo vanished the moment you saved it.
 *
 *  A file is not a string, so it does not belong in a Record<string, string>
 *  anyway. These live in `assets` instead: the chosen File plus a local blob:
 *  URL for the preview, sent by Save alongside the text settings.
 * ─────────────────────────────────────────────────────────────────────────
 */
const ASSET_KEY_LIST = ["brand_logo_url", "brand_favicon_url", "brand_icon_url"] as const;
type AssetKey = (typeof ASSET_KEY_LIST)[number];

const ASSET_KEYS: ReadonlySet<string> = new Set(ASSET_KEY_LIST);

export function SettingsForm({ settings }: { settings: SettingRow[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /** The text and boolean settings — everything Save is responsible for. */
  const original = useMemo(
    () =>
      Object.fromEntries(
        settings.filter((s) => !ASSET_KEYS.has(s.key)).map((s) => [s.key, s.value ?? ""]),
      ),
    [settings],
  );
  const [draft, setDraft] = useState<Record<string, string>>(original);

  /** Read straight from the server on every render — no local copy to drift. */
  const assetValue = (key: string) => settings.find((s) => s.key === key)?.value || null;

  /**
   * Files chosen but NOT YET SENT.
   *
   * A `blob:` URL renders the preview locally, so nothing reaches the server
   * until Save — which is what makes these behave like every other field on
   * the page. Discard throws the choice away and the saved image is untouched.
   */
  type PendingAsset = { file: File; url: string } | { remove: true };
  const [assets, setAssets] = useState<Partial<Record<AssetKey, PendingAsset>>>({});

  function selectAsset(key: AssetKey, file: File) {
    // Both the createObjectURL and the revoke happen HERE, not inside the
    // updater: React may call an updater twice, and a side effect in one leaks
    // a URL or frees a live one.
    const url = URL.createObjectURL(file);
    const previous = assets[key];
    if (previous && "url" in previous) URL.revokeObjectURL(previous.url);

    setAssets((prev) => ({ ...prev, [key]: { file, url } }));
  }

  function undoAsset(key: AssetKey) {
    const previous = assets[key];
    if (previous && "url" in previous) URL.revokeObjectURL(previous.url);

    setAssets((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function removeAsset(key: AssetKey) {
    const previous = assets[key];
    if (previous && "url" in previous) URL.revokeObjectURL(previous.url);

    // Marked, not applied. Save is still the thing that commits it.
    setAssets((prev) => ({ ...prev, [key]: { remove: true } }));
  }

  function clearPendingAssets() {
    for (const pending of Object.values(assets)) {
      if (pending && "url" in pending) URL.revokeObjectURL(pending.url);
    }
    setAssets({});
  }

  /** The pending blob if there is one, the marked-removal blank, else the saved value. */
  function previewOf(key: AssetKey): string | null {
    const pending = assets[key];
    if (!pending) return assetValue(key);
    return "url" in pending ? pending.url : null;
  }

  const categories = useMemo(
    () => [...new Set(settings.map((s) => s.category))],
    [settings],
  );
  const visibleTabs = TABS.filter((t) => categories.includes(t.id));
  const [active, setActive] = useState<string>(visibleTabs[0]?.id ?? "branding");

  const changed = Object.entries(draft).filter(([key, value]) => original[key] !== value);

  /** Text settings and pending files count together — one Save commits both. */
  const pendingAssetKeys = Object.keys(assets) as AssetKey[];
  const dirtyCount = changed.length + pendingAssetKeys.length;

  /**
   * Commit everything, files first.
   *
   * Files first because they are the failure-prone half: an upload can be
   * refused by the content sniffer, and stopping there leaves the text
   * settings untouched rather than half-applied. The label reads the same
   * either way — nothing is claimed saved unless it was.
   */
  function saveAll() {
    startTransition(async () => {
      for (const key of pendingAssetKeys) {
        const pendingAsset = assets[key]!;
        if ("remove" in pendingAsset) {
          const result = await clearBrandingAsset(key);
          if (!result.ok) return toast(result.error, "error");
          continue;
        }

        const formData = new FormData();
        formData.append("file", pendingAsset.file);
        const result = await uploadBrandingAsset(key, formData);
        if (!result.ok) return toast(result.error ?? "Upload failed.", "error");
      }

      if (changed.length > 0) {
        const result = await updateSettings(Object.fromEntries(changed));
        if (!result.ok) return toast(result.error, "error");
      }

      clearPendingAssets();
      toast(`${dirtyCount} setting(s) saved.`, "success");

      // Re-read the settings: the free-mode countdown hint computes its end
      // date from the row's updated_at, which this save just bumped — a stale
      // hint would promise yesterday's deadline.
      router.refresh();
    });
  }

  if (settings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={<Cog />}
          title="No settings"
          description="Run migration 0005_admin_complete.sql to create the settings table and seed the platform defaults."
        />
      </div>
    );
  }

  const rows = settings.filter((s) => s.category === active && !ASSET_KEYS.has(s.key));
  const activeTab = TABS.find((t) => t.id === active);

  return (
    <div className="max-w-4xl">
      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border"
      >
        {visibleTabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-text",
              )}
            >
              <tab.icon className="size-4" aria-hidden />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab?.hint && (
        <p className="mt-4 text-sm text-text-secondary">{activeTab.hint}</p>
      )}

      <div className="mt-5 flex flex-col gap-6">
        {/* ── Branding assets ────────────────────────────────────────── */}
        {active === "branding" && (
          <Panel
            title="Logo and favicon"
            description="Uploaded to your own server, not to Supabase."
          >
            <CardBody className="flex flex-col gap-7">
              <ImageUpload
                label="Logo"
                shape="wide"
                hint="Shown beside the platform name in the header, on invoices and in share cards. PNG or WebP, 512 px wide or more."
                previewUrl={previewOf("brand_logo_url")}
                dirty={Boolean(assets.brand_logo_url)}
                disabled={pending}
                onSelect={(file) => selectAsset("brand_logo_url", file)}
                onUndo={() => undoAsset("brand_logo_url")}
                onRemove={() => removeAsset("brand_logo_url")}
              />

              <ImageUpload
                label="Favicon"
                shape="square"
                hint="The browser-tab icon. A square PNG of 64–256 px, or an .ico."
                previewUrl={previewOf("brand_favicon_url")}
                dirty={Boolean(assets.brand_favicon_url)}
                disabled={pending}
                onSelect={(file) => selectAsset("brand_favicon_url", file)}
                onUndo={() => undoAsset("brand_favicon_url")}
                onRemove={() => removeAsset("brand_favicon_url")}
              />

              <ImageUpload
                label="App icon (PWA)"
                shape="square"
                hint="The icon on the home screen and in the install prompt when someone installs the app — iOS uses it for the home screen and Web Push too. A square PNG or WebP, ideally 512×512."
                previewUrl={previewOf("brand_icon_url")}
                dirty={Boolean(assets.brand_icon_url)}
                disabled={pending}
                onSelect={(file) => selectAsset("brand_icon_url", file)}
                onUndo={() => undoAsset("brand_icon_url")}
                onRemove={() => removeAsset("brand_icon_url")}
              />

              {/*
                §9 — uploads are validated by their actual bytes, not by the
                file name or the MIME header the browser claims.
              */}
              <p className="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-secondary">
                Files are checked by their <strong className="text-text">contents</strong>, not by
                their name — renaming a script to <code className="font-mono">.png</code> will not
                get it through. SVG is not accepted: it is XML, it can carry scripts, and it would
                be served from your own domain. Maximum 2 MB.
              </p>
            </CardBody>
          </Panel>
        )}

        {active === "social" && (
          <Panel
            title="Social profiles"
            description="Keep each link in one place. Disabled profiles stay saved here but disappear from the public site."
          >
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_PLATFORMS.map((platform) => {
                const enabledKey = socialEnabledKey(platform.id);
                const urlKey = socialUrlKey(platform.id);
                const enabled = draft[enabledKey] === "true";

                return (
                  <section
                    key={platform.id}
                    className={cn(
                      "rounded-lg border p-4 transition-colors",
                      enabled ? "border-primary/35 bg-primary-light/55" : "border-border bg-surface-2",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 place-items-center rounded-full bg-surface text-text shadow-sm">
                        <SocialIcon platform={platform.id} className="size-4.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{platform.label}</p>
                        <p className="text-xs text-text-light">
                          {enabled ? "Visible on the public site" : "Hidden from the public site"}
                        </p>
                      </div>
                      <Switch
                        label={`Show ${platform.label}`}
                        className="shrink-0 [&>span:last-child]:sr-only"
                        checked={enabled}
                        onChange={(event) =>
                          setDraft((previous) => ({
                            ...previous,
                            [enabledKey]: event.target.checked ? "true" : "false",
                          }))
                        }
                      />
                    </div>

                    <Field
                      className="mt-4"
                      label={`${platform.label} profile URL`}
                      htmlFor={`set-${urlKey}`}
                      hint={enabled && !draft[urlKey]?.trim() ? "Add the URL before this profile can appear." : undefined}
                    >
                      <Input
                        id={`set-${urlKey}`}
                        type="url"
                        value={draft[urlKey] ?? ""}
                        placeholder={platform.placeholder}
                        autoComplete="url"
                        onChange={(event) =>
                          setDraft((previous) => ({ ...previous, [urlKey]: event.target.value }))
                        }
                      />
                    </Field>
                  </section>
                );
              })}
            </CardBody>
          </Panel>
        )}

        {/* ── The category's own settings ────────────────────────────── */}
        {rows.length > 0 && active !== "social" && (
          <Panel title={activeTab?.label ?? "Settings"}>
            <CardBody className="flex flex-col gap-5">
              {rows.map((setting) => {
                const value = draft[setting.key] ?? "";

                if (setting.key === "notification_sound") {
                  return (
                    <Field
                      key={setting.key}
                      label={setting.label ?? setting.key}
                      htmlFor={`set-${setting.key}`}
                      hint={setting.description ?? undefined}
                    >
                      <SoundPicker
                        value={value}
                        onChange={(next) =>
                          setDraft((prev) => ({ ...prev, [setting.key]: next }))
                        }
                      />
                      <p className="mt-1 font-mono text-[10px] text-text-light">{setting.key}</p>
                    </Field>
                  );
                }

                if (setting.key === "payment_mode") {
                  return (
                    <Field
                      key={setting.key}
                      label={setting.label ?? setting.key}
                      htmlFor={`set-${setting.key}`}
                      hint={setting.description ?? undefined}
                    >
                      <Select
                        id={`set-${setting.key}`}
                        value={value}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [setting.key]: e.target.value }))
                        }
                      >
                        <option value="sandbox">sandbox — simulated, no money moves</option>
                        <option value="live">live — real charges through CamerPay</option>
                      </Select>
                      <p className="mt-1 font-mono text-[10px] text-text-light">{setting.key}</p>
                    </Field>
                  );
                }

                if (setting.key === "platform_delivery_fee") {
                  return (
                    <Field
                      key={setting.key}
                      label={setting.label ?? setting.key}
                      htmlFor={`set-${setting.key}`}
                      hint={setting.description ?? undefined}
                    >
                      <Input
                        id={`set-${setting.key}`}
                        value={value}
                        inputMode="numeric"
                        suffix="XAF"
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [setting.key]: e.target.value }))
                        }
                      />
                      <p className="mt-1 text-xs text-text-light">
                        Applied to restaurants without their own delivery riders.
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-text-light">{setting.key}</p>
                    </Field>
                  );
                }

                if (setting.key === "platform_free_mode_days") {
                  // The countdown ends updated_at + days (migration 0031). The
                  // date is computed here so the admin sees the consequence of
                  // the number they are about to save, not a promise of one.
                  const days = Math.max(0, Number(value) || 0);
                  const endsAt = setting.updatedAt
                    ? new Date(new Date(setting.updatedAt).getTime() + days * 86_400_000)
                    : null;
                  const endLabel = endsAt
                    ? endsAt.toLocaleDateString("en-CM", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : null;

                  return (
                    <Field
                      key={setting.key}
                      label={setting.label ?? setting.key}
                      htmlFor={`set-${setting.key}`}
                      hint={
                        days > 0 && endLabel
                          ? `Free mode ends on ${endLabel} (the last save plus ${days} day(s)).`
                          : setting.description ?? undefined
                      }
                    >
                      <Input
                        id={`set-${setting.key}`}
                        value={value}
                        inputMode="numeric"
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [setting.key]: e.target.value }))
                        }
                      />
                      <p className="mt-1 font-mono text-[10px] text-text-light">{setting.key}</p>
                    </Field>
                  );
                }

                if (setting.valueType === "boolean") {
                  return (
                    <Switch
                      key={setting.key}
                      label={setting.label ?? setting.key}
                      description={setting.description ?? undefined}
                      checked={value === "true"}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [setting.key]: e.target.checked ? "true" : "false",
                        }))
                      }
                    />
                  );
                }

                return (
                  <Field
                    key={setting.key}
                    label={setting.label ?? setting.key}
                    htmlFor={`set-${setting.key}`}
                    hint={setting.description ?? undefined}
                  >
                    <Input
                      id={`set-${setting.key}`}
                      value={value}
                      inputMode={setting.valueType === "integer" ? "numeric" : undefined}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [setting.key]: e.target.value }))
                      }
                    />
                    <p className="mt-1 font-mono text-[10px] text-text-light">{setting.key}</p>
                  </Field>
                );
              })}
            </CardBody>
          </Panel>
        )}
      </div>

      {/* Sticky, because these values are read across the whole app and an
          unsaved change should never be easy to walk away from. */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 z-50 mt-6 rounded-lg border border-primary bg-surface p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong className="font-semibold">{dirtyCount} unsaved change(s)</strong>
              <span className="ml-2 text-text-light">
                {[...changed.map(([k]) => k), ...pendingAssetKeys].join(", ")}
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setDraft(original);
                  clearPendingAssets();
                }}
              >
                Discard
              </Button>
              <Button loading={pending} disabled={pending} onClick={saveAll}>
                <Save className="size-4" aria-hidden />
                <span>Save</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
