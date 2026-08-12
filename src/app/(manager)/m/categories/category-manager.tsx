"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { DEFAULT_CATEGORY_ICON, NavIcon, isIconName } from "@/components/layout/icon";
import { IconPicker } from "@/components/menu/icon-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Switch } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createCategory, deleteCategory, updateCategory } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { MenuCategory } from "@/lib/data/manager";

/**
 * Category management.
 *
 * Reordering is UP/DOWN BUTTONS, not drag and drop. The old design showed a
 * drag handle it never implemented; buttons work on a phone in a kitchen, work
 * with a keyboard, work with a screen reader, and each press is one Server
 * Action that either succeeds or says why.
 *
 * The row is a COLUMN below `sm`. Reorder controls, icon, name, dish count and
 * two actions on one line at 360px meant sliding the page sideways to reach
 * Delete — which is the complaint this screen was rebuilt for.
 */

/** Derived from the action itself, so the two can never drift apart. */
type ActionResult = Awaited<ReturnType<typeof updateCategory>>;

interface Draft {
  id: string | null;
  name: string;
  icon: string;
  isActive: boolean;
}

export function CategoryManager({
  categories,
  canEdit,
}: {
  categories: MenuCategory[];
  canEdit: boolean;
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<MenuCategory | null>(null);

  /**
   * French counts zero as singular ("0 plat"), English does not ("0 dishes"),
   * so the plural variant is chosen here rather than baked into one string.
   */
  function plural(base: string, count: number): TranslationKey {
    const many = locale === "fr" ? count > 1 : count !== 1;
    return `${base}_${many ? "other" : "one"}` as TranslationKey;
  }

  /** `onSuccess` runs only when the action actually succeeded — see save(). */
  function run(fn: () => Promise<ActionResult>, success: string, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(result.error, "error");
      onSuccess?.();
      toast(success, "success");
    });
  }

  /**
   * Move a category one place.
   *
   * Two updates rather than a renumbering pass: only the pair actually moves,
   * so a concurrent edit elsewhere in the list is not clobbered.
   *
   * THE NEW ORDERS COME FROM THE POSITIONS, NOT FROM THE STORED VALUES. This
   * was a value swap, and `menu_categories` has no uniqueness on `sort_order`:
   * if the first update landed and the second did not, both rows were left
   * holding the same number. From then on every further press wrote that same
   * number to both, the pair became permanently unsortable, and the manager
   * just saw buttons that did nothing. Deriving from the index produces
   * distinct values even when the two rows currently share one, so a
   * half-applied move repairs itself on the next press.
   */
  function move(index: number, direction: -1 | 1) {
    const current = categories[index];
    const neighbour = categories[index + direction];
    if (!current || !neighbour) return;

    startTransition(async () => {
      const first = await updateCategory(current.id, { sortOrder: index + direction + 1 });
      if (!first.ok) return toast(first.error, "error");

      const second = await updateCategory(neighbour.id, { sortOrder: index + 1 });
      if (!second.ok) return toast(second.error, "error");
    });
  }

  function openNew() {
    setEditing({ id: null, name: "", icon: DEFAULT_CATEGORY_ICON, isActive: true });
  }

  function openEdit(category: MenuCategory) {
    setEditing({
      id: category.id,
      name: category.name,
      // A row saved before the registry was fixed can hold a name nothing can
      // draw. Opening on the fallback shows the manager what is actually on
      // their menu, and saving repairs the row.
      icon: isIconName(category.icon) ? category.icon : DEFAULT_CATEGORY_ICON,
      isActive: category.isActive,
    });
  }

  function save() {
    if (!editing) return;
    const { id, name, icon, isActive } = editing;

    // Closed only on success. The common refusal here is the
    // `unique (restaurant_id, name)` constraint surfacing as "you already have
    // a category with that name" — closing first meant the manager got a red
    // toast over an empty screen and had to retype the name, the icon and the
    // visibility toggle.
    run(
      () => (id ? updateCategory(id, { name, icon, isActive }) : createCategory({ name, icon })),
      id ? t("mc.saved") : t("mc.created"),
      () => setEditing(null),
    );
  }

  function remove(category: MenuCategory) {
    startTransition(async () => {
      const result = await deleteCategory(category.id);
      if (!result.ok) return toast(result.error, "error");

      // The action returns its own `note`, but only in English. The count is
      // known here, so the manager hears it in their own language instead.
      const orphaned = category.itemCount;
      toast(
        orphaned > 0
          ? t(plural("mc.deletedWithDishes", orphaned), { count: orphaned })
          : t("mc.deleted"),
        orphaned > 0 ? "warning" : "success",
      );
    });
  }

  return (
    <>
      {canEdit && (
        <div className="mb-5">
          <Button fullWidth className="sm:w-auto" onClick={openNew}>
            <Plus className="size-4" aria-hidden />
            <span>{t("mc.new")}</span>
          </Button>
        </div>
      )}

      <Card className="max-w-2xl">
        {categories.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            title={t("mc.empty")}
            description={canEdit ? t("mc.emptyBody") : t("mc.readOnly")}
            action={
              canEdit ? (
                <Button onClick={openNew}>
                  <Plus className="size-4" aria-hidden />
                  <span>{t("mc.new")}</span>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((category, index) => (
              <li
                key={category.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {canEdit && (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        aria-label={t("mc.moveUp", { name: category.name })}
                        disabled={index === 0 || pending}
                        onClick={() => move(index, -1)}
                        className="grid size-7 place-items-center rounded-md border border-border text-text-light transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronUp className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("mc.moveDown", { name: category.name })}
                        disabled={index === categories.length - 1 || pending}
                        onClick={() => move(index, 1)}
                        className="grid size-7 place-items-center rounded-md border border-border text-text-light transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronDown className="size-4" aria-hidden />
                      </button>
                    </div>
                  )}

                  <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                    <NavIcon name={category.icon} className="size-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* Each label in its own <span>: a conditional element beside
                        a bare text node is what breaks under Google Translate. */}
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                      <span className="min-w-0 break-words">{category.name}</span>
                      {!category.isActive && <Badge tone="neutral">{t("mc.hidden")}</Badge>}
                    </p>
                    <p className="text-sm text-text-light">
                      <span>
                        {t(plural("mc.dishes", category.itemCount), { count: category.itemCount })}
                      </span>
                    </p>
                  </div>
                </div>

                {canEdit && (
                  <div className="flex gap-2 sm:shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 sm:flex-none"
                      aria-label={t("mc.editCategory", { name: category.name })}
                      onClick={() => openEdit(category)}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      <span>{t("common.edit")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-error hover:bg-error-light hover:text-error sm:flex-none"
                      aria-label={t("mc.deleteCategory", { name: category.name })}
                      onClick={() => setDeleting(category)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      <span>{t("common.delete")}</span>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t("mc.editTitle") : t("mc.newTitle")}
        /* The actions live in the sheet's own footer, so a sixty-icon grid
           can never push Save out of reach. */
        footer={
          editing ? (
            <SheetActions>
              <Button variant="outline" onClick={() => setEditing(null)}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button loading={pending} disabled={editing.name.trim().length < 2} onClick={save}>
                <span>{editing.id ? t("common.save") : t("common.create")}</span>
              </Button>
            </SheetActions>
          ) : undefined
        }
      >
        {editing && (
          <div className="flex flex-col gap-5">
            <Field label={t("mc.name")} htmlFor="category-name" required hint={t("mc.nameHint")}>
              <Input
                id="category-name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t("mc.namePh")}
              />
            </Field>

            <Field label={t("mc.icon")} hint={t("mc.iconHint")}>
              <IconPicker
                value={editing.icon}
                onChange={(icon) => setEditing({ ...editing, icon })}
              />
            </Field>

            <div className="flex items-center gap-3 rounded-md border border-border p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
                <NavIcon name={editing.icon} className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                  <span>{t("mc.preview")}</span>
                </p>
                <p className="truncate text-sm font-semibold">
                  <span>
                    {editing.name.trim() ||
                      t(`icons.name.${editing.icon}` as TranslationKey)}
                  </span>
                </p>
              </div>
            </div>

            {editing.id && (
              <Switch
                label={t("mc.visible")}
                description={t("mc.visibleHint")}
                checked={editing.isActive}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
              />
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("mc.deleteTitle", { name: deleting?.name ?? "" })}
        /* Deliberately not blocked when the category holds dishes. The FK is
           `on delete set null`, so the dishes survive and become uncategorised
           — visible and fixable, rather than silently deleted with it. */
        message={
          deleting && deleting.itemCount > 0
            ? t(plural("mc.deleteBody", deleting.itemCount), { count: deleting.itemCount })
            : t("mc.deleteEmpty")
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={() => {
          if (deleting) remove(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}
