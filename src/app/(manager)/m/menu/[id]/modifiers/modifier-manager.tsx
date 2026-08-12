"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Switch } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatMoney, parseMoney } from "@/lib/format/currency";
import {
  createOption,
  createOptionGroup,
  deleteOption,
  deleteOptionGroup,
  setOptionAvailability,
} from "@/lib/data/manager-actions";
import { updateOptionGroup } from "@/lib/data/modifier-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { MenuItem, MenuOption, MenuOptionGroup } from "@/lib/data/manager";
import { cn } from "@/lib/utils";

/**
 * Option groups and their options (§3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TWO LEVELS, RENDERED AS TWO LEVELS.
 *
 *  A GROUP is a question — "Taille", "Suppléments" — and carries the answer
 *  rules: min_select, max_select, is_required. The OPTIONS nested inside it
 *  are the answers, and each carries a price delta that may be negative.
 *
 *  Flattening the two into one list is the standard way this model gets
 *  mangled, and it is lossy rather than merely ugly: "choose exactly one
 *  size" is a property of the QUESTION, so a flat list of sizes cannot
 *  express it. The nesting on screen is the nesting in the database.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every button here is a Server Action. Nothing is patched into local state
 * and hoped for — the rows you see after a mutation are the rows that are in
 * the database, because the route re-fetches rather than the array being
 * edited in place.
 */

/** Derived from an action, so the two can never drift apart. */
type ActionResult = Awaited<ReturnType<typeof createOptionGroup>>;

interface GroupDraft {
  /** null while creating. */
  id: string | null;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
}

interface OptionDraft {
  groupId: string;
  /** Only for the panel heading — the server re-derives everything else. */
  groupName: string;
  name: string;
  /**
   * Kept as typed TEXT rather than a number: "-" is a legal keystroke on the
   * way to "-500", and coercing it to 0 mid-word fights the person typing.
   */
  priceDelta: string;
}

const NEW_GROUP: GroupDraft = { id: null, name: "", minSelect: 1, maxSelect: 1, isRequired: true };

/**
 * The same four rules createOptionGroup and updateOptionGroup enforce.
 *
 * Duplicated on purpose, and the server remains the authority: this only buys
 * the manager an answer before the round trip. A group saved as "min 3, max 1"
 * would be a dish nobody can finish ordering.
 */
function validateGroup(draft: GroupDraft): TranslationKey | null {
  if (draft.name.trim().length < 2) return "mod.err.nameShort";
  if (draft.maxSelect < 1) return "mod.err.maxAtLeastOne";
  if (draft.maxSelect < draft.minSelect) return "mod.err.minMax";
  if (draft.isRequired && draft.minSelect < 1) return "mod.err.requiredMin";
  return null;
}

export function ModifierManager({ item, canEdit }: { item: MenuItem; canEdit: boolean }) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<MenuOptionGroup | null>(null);
  const [deletingOption, setDeletingOption] = useState<MenuOption | null>(null);

  /**
   * French counts zero as singular ("0 option"), English does not, so the
   * variant is chosen here rather than baked into one string.
   */
  function plural(base: string, count: number): TranslationKey {
    const many = locale === "fr" ? count > 1 : count !== 1;
    return `${base}_${many ? "other" : "one"}` as TranslationKey;
  }

  /**
   * Run a mutation and refresh.
   *
   * The create/delete actions in manager-actions.ts revalidate /m/menu, which
   * is the list they were written for — not this nested route. router.refresh()
   * is what makes the group the manager just added actually appear here.
   */
  function run(fn: () => Promise<ActionResult>, success: string, onDone?: () => void) {
    startTransition(async () => {
      const result = await fn();
      // The server's own wording wins: it knows about tenancy and constraint
      // failures the client cannot see from here.
      if (!result.ok) return toast(result.error, "error");

      onDone?.();
      router.refresh();
      toast(result.note ?? success, result.note ? "info" : "success");
    });
  }

  /* ── Groups ──────────────────────────────────────────────────────────── */

  function openEditGroup(group: MenuOptionGroup) {
    setGroupDraft({
      id: group.id,
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      isRequired: group.isRequired,
    });
  }

  function saveGroup() {
    if (!groupDraft) return;
    const { id, name, minSelect, maxSelect, isRequired } = groupDraft;

    run(
      () =>
        id
          ? updateOptionGroup(id, { name, minSelect, maxSelect, isRequired })
          : createOptionGroup({ menuItemId: item.id, name, minSelect, maxSelect, isRequired }),
      id ? t("mod.toast.groupSaved") : t("mod.toast.groupCreated"),
      // Closed only on success, so a refusal leaves everything typed in place.
      () => setGroupDraft(null),
    );
  }

  const groupProblem = groupDraft ? validateGroup(groupDraft) : null;
  /**
   * Silent while the name is still empty. A panel that shows "name too short"
   * the instant it opens is scolding someone for not having typed yet; the
   * disabled Save already says "not ready".
   */
  const shownGroupProblem =
    groupProblem && groupDraft && groupDraft.name.trim().length === 0 ? null : groupProblem;

  /* ── Options ─────────────────────────────────────────────────────────── */

  const draftDelta = optionDraft ? parseMoney(optionDraft.priceDelta) : null;
  const shownOptionProblem =
    optionDraft && optionDraft.priceDelta.trim().length > 0 && draftDelta === null
      ? t("mod.err.priceWhole")
      : undefined;

  function saveOption() {
    if (!optionDraft || draftDelta === null) return;
    const { groupId, name } = optionDraft;

    run(() => createOption({ groupId, name, priceDelta: draftDelta }), t("mod.toast.optionAdded"), () =>
      setOptionDraft(null),
    );
  }

  return (
    <>
      {/* Column below sm: on a 360px phone two side-by-side pills would push
          the primary action toward the edge, and this screen is reached from a
          phone in a dining room far more often than from a desk. */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/m/menu"
          className={buttonClasses({
            variant: "outline",
            size: "sm",
            fullWidth: true,
            className: "sm:w-auto",
          })}
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span>{t("mod.backToMenu")}</span>
        </Link>

        {canEdit && (
          <Button fullWidth className="sm:w-auto" onClick={() => setGroupDraft(NEW_GROUP)}>
            <Plus className="size-4" aria-hidden />
            <span>{t("mod.newGroup")}</span>
          </Button>
        )}
      </div>

      {/*
        The teaching paragraph, kept because min/max mean nothing until you
        know a group is a QUESTION. Each term is its own element rather than
        markup inside a translated string: dangerouslySetInnerHTML on
        translated content is how a dictionary becomes an injection surface.
      */}
      <div className="mb-5 rounded-lg border border-border bg-surface-2 p-4">
        <p className="text-sm leading-relaxed text-text-secondary">
          <strong className="mr-1 font-semibold text-text">{t("mod.explain.groupTerm")}</strong>
          <span>{t("mod.explain.groupBody")}</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          <strong className="mr-1 font-semibold text-text">{t("mod.explain.optionTerm")}</strong>
          <span>{t("mod.explain.optionBody")}</span>
        </p>
        {/* Deltas are relative, so the number they are relative to belongs on
            the same screen. */}
        <p className="tnum mt-3 text-sm font-medium text-text">
          <span>{t("mod.basePrice", { price: formatMoney(item.price) })}</span>
        </p>
      </div>

      {!canEdit && <p className="mb-5 text-sm text-text-light">{t("mod.readOnly")}</p>}

      {item.optionGroups.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<ListChecks />}
            title={t("mod.empty.title")}
            description={canEdit ? t("mod.empty.body") : t("mod.empty.readOnlyBody")}
            action={
              canEdit ? (
                <Button onClick={() => setGroupDraft(NEW_GROUP)}>
                  <Plus className="size-4" aria-hidden />
                  <span>{t("mod.empty.action")}</span>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {item.optionGroups.map((group) => {
            const rule =
              group.minSelect === 1 && group.maxSelect === 1
                ? t("mod.group.singleChoice")
                : group.minSelect > 0
                  ? t("mod.group.range", { min: group.minSelect, max: group.maxSelect })
                  : t("mod.group.upTo", { max: group.maxSelect });

            return (
              <li key={group.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                {/* ── The question ──────────────────────────────────────── */}
                <div className="flex flex-col gap-3 border-b border-border bg-surface-2/60 p-4 md:flex-row md:items-start md:justify-between md:gap-5">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-bold">
                      <span>{group.name}</span>
                    </h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={group.isRequired ? "primary" : "neutral"}>
                        <span>
                          {group.isRequired ? t("mod.group.required") : t("mod.group.optional")}
                        </span>
                      </Badge>
                      <Badge tone="info">
                        <span>{rule}</span>
                      </Badge>
                      <span className="text-xs text-text-light">
                        {t(plural("mod.group.optionCount", group.options.length), {
                          count: group.options.length,
                        })}
                      </span>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex w-full items-center gap-2 md:w-auto md:shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        fullWidth
                        className="md:w-auto"
                        aria-label={t("mod.group.editAria", { name: group.name })}
                        onClick={() => openEditGroup(group)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        <span>{t("common.edit")}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-error hover:bg-error-light"
                        aria-label={t("mod.group.deleteAria", { name: group.name })}
                        onClick={() => setDeletingGroup(group)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                {/* ── The answers ───────────────────────────────────────── */}
                {group.options.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm font-medium text-text-secondary">
                      <span>{t("mod.group.noOptions")}</span>
                    </p>
                    <p className="mt-1 text-xs text-text-light">
                      <span>{t("mod.group.noOptionsHint")}</span>
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {group.options.map((option) => (
                      <li
                        key={option.id}
                        className={cn(
                          "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4",
                          !option.isAvailable && "bg-surface-2/50",
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <p className="font-medium">
                            <span>{option.name}</span>
                          </p>
                          {!option.isAvailable && (
                            <Badge tone="neutral">
                              <span>{t("mod.option.unavailable")}</span>
                            </Badge>
                          )}
                        </div>

                        <p
                          className={cn(
                            "tnum shrink-0 text-sm font-semibold sm:text-right",
                            option.priceDelta === 0
                              ? "text-text-light"
                              : option.priceDelta > 0
                                ? "text-primary"
                                : "text-success",
                          )}
                        >
                          <span>
                            {option.priceDelta === 0
                              ? t("mod.option.included")
                              : formatMoney(option.priceDelta, { signed: true })}
                          </span>
                        </p>

                        {canEdit && (
                          <div className="flex w-full items-center justify-between gap-2 border-t border-border pt-3 sm:w-auto sm:shrink-0 sm:justify-end sm:border-0 sm:pt-0">
                            <Switch
                              label={t("mod.option.available")}
                              aria-label={t("mod.option.availabilityOf", { name: option.name })}
                              checked={option.isAvailable}
                              disabled={pending}
                              onChange={() =>
                                run(
                                  () => setOptionAvailability(option.id, !option.isAvailable),
                                  option.isAvailable
                                    ? t("mod.toast.optionOff", { name: option.name })
                                    : t("mod.toast.optionOn", { name: option.name }),
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-error hover:bg-error-light"
                              aria-label={t("mod.option.deleteAria", { name: option.name })}
                              onClick={() => setDeletingOption(option)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canEdit && (
                  <div className="border-t border-border p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      fullWidth
                      className="sm:w-auto"
                      onClick={() =>
                        setOptionDraft({
                          groupId: group.id,
                          groupName: group.name,
                          name: "",
                          priceDelta: "0",
                        })
                      }
                    >
                      <Plus className="size-3.5" aria-hidden />
                      <span>{t("mod.addOption")}</span>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Group editor ──────────────────────────────────────────────── */}
      <Sheet
        open={groupDraft !== null}
        onClose={() => setGroupDraft(null)}
        title={groupDraft?.id ? t("mod.editGroup") : t("mod.newGroup")}
        description={item.name}
        // Pinned in the footer, never at the end of the form: on a phone the
        // min/max row can push a trailing button off a short viewport, and a
        // panel with no visible way to confirm reads as broken.
        footer={
          groupDraft && (
            <SheetActions>
              <Button variant="outline" disabled={pending} onClick={() => setGroupDraft(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button loading={pending} disabled={groupProblem !== null} onClick={saveGroup}>
                <span>{groupDraft.id ? t("common.save") : t("common.add")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {groupDraft && (
          <div className="flex flex-col gap-4">
            <Field
              label={t("mod.field.name")}
              htmlFor="group-name"
              hint={t("mod.field.nameHint")}
              required
            >
              <Input
                id="group-name"
                value={groupDraft.name}
                placeholder={t("mod.field.namePlaceholder")}
                onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
              />
            </Field>

            <Switch
              label={t("mod.field.required")}
              description={t("mod.field.requiredHint")}
              checked={groupDraft.isRequired}
              onChange={(e) => {
                const isRequired = e.target.checked;
                // A required group with a minimum of 0 asks a question the
                // customer may ignore, which is what "optional" means. Lifting
                // the floor keeps the toggle honest instead of leaving an
                // invalid pair for Save to reject.
                setGroupDraft({
                  ...groupDraft,
                  isRequired,
                  minSelect: isRequired && groupDraft.minSelect < 1 ? 1 : groupDraft.minSelect,
                });
              }}
            />

            <div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("mod.field.min")} htmlFor="group-min">
                  <Input
                    id="group-min"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={String(groupDraft.minSelect)}
                    onChange={(e) =>
                      setGroupDraft({
                        ...groupDraft,
                        minSelect: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                      })
                    }
                  />
                </Field>
                <Field label={t("mod.field.max")} htmlFor="group-max">
                  <Input
                    id="group-max"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={String(groupDraft.maxSelect)}
                    onChange={(e) =>
                      setGroupDraft({
                        ...groupDraft,
                        maxSelect: Math.trunc(Number(e.target.value) || 0),
                      })
                    }
                  />
                </Field>
              </div>
              <p className="mt-1.5 text-xs text-text-light">{t("mod.field.minMaxHint")}</p>
              {shownGroupProblem && (
                <p role="alert" className="mt-1.5 text-xs font-medium text-error">
                  {t(shownGroupProblem)}
                </p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* ── Option editor ─────────────────────────────────────────────── */}
      <Sheet
        open={optionDraft !== null}
        onClose={() => setOptionDraft(null)}
        title={t("mod.addOption")}
        description={optionDraft?.groupName}
        footer={
          optionDraft && (
            <SheetActions>
              <Button variant="outline" disabled={pending} onClick={() => setOptionDraft(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                loading={pending}
                disabled={optionDraft.name.trim().length === 0 || draftDelta === null}
                onClick={saveOption}
              >
                <span>{t("common.add")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {optionDraft && (
          <div className="flex flex-col gap-4">
            <Field label={t("mod.option.name")} htmlFor="option-name" required>
              <Input
                id="option-name"
                value={optionDraft.name}
                placeholder={t("mod.option.namePlaceholder")}
                onChange={(e) => setOptionDraft({ ...optionDraft, name: e.target.value })}
              />
            </Field>

            <Field
              label={t("mod.option.price")}
              htmlFor="option-price"
              hint={t("mod.option.priceHint")}
              error={shownOptionProblem}
            >
              {/* step 1 and no decimals anywhere: XAF is zero-decimal (§13).
                  No inputMode="numeric" here, unlike min/max: that keypad has
                  no minus key on iOS, and this is the one field on the screen
                  where a negative number is the point. */}
              <Input
                id="option-price"
                type="number"
                step={1}
                suffix="FCFA"
                invalid={shownOptionProblem !== undefined}
                value={optionDraft.priceDelta}
                onChange={(e) => setOptionDraft({ ...optionDraft, priceDelta: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Sheet>

      {/* Deleting a group takes its options with it — the count is in the
          message because "delete this group" and "delete this group and its
          six options" are different decisions. */}
      <ConfirmDialog
        open={deletingGroup !== null}
        onClose={() => setDeletingGroup(null)}
        title={t("mod.deleteGroup.title", { name: deletingGroup?.name ?? "" })}
        message={
          deletingGroup && deletingGroup.options.length > 1
            ? t("mod.deleteGroup.msgMany", { count: deletingGroup.options.length })
            : deletingGroup?.options.length === 1
              ? t("mod.deleteGroup.msgOne")
              : t("mod.deleteGroup.msgNone")
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={() => {
          if (deletingGroup) {
            run(() => deleteOptionGroup(deletingGroup.id), t("mod.toast.groupDeleted"));
          }
          setDeletingGroup(null);
        }}
      />

      <ConfirmDialog
        open={deletingOption !== null}
        onClose={() => setDeletingOption(null)}
        title={t("mod.deleteOption.title", { name: deletingOption?.name ?? "" })}
        message={t("mod.deleteOption.message")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={() => {
          if (deletingOption) {
            run(() => deleteOption(deletingOption.id), t("mod.toast.optionDeleted"));
          }
          setDeletingOption(null);
        }}
      />
    </>
  );
}
