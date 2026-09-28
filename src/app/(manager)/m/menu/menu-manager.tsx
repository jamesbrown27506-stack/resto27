"use client";

/*
  DIETARY TAGS AND ALLERGENS ARE NO LONGER SHOWN, ANYWHERE.

  They were a straight import of a European menu convention. In Cameroon
  they are not what anyone reads a menu for — the labels went untouched by
  restaurants and unread by customers, while taking the most valuable strip
  of every dish row and every picker: the line directly under the name.

  The COLUMNS stay (`menu_items.dietary_tags`, `menu_items.allergens`), and
  so does lib/menu/tags. Nothing is dropped and nothing is migrated, so any
  restaurant that filled them in keeps its data and this is reversible by
  putting the markup back. What is gone is the UI.
*/
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ListChecks, Lock, Pencil, Plus, Sliders, Trash2, UtensilsCrossed } from "lucide-react";
import { FilterBar } from "@/components/data/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ImageUpload } from "@/components/ui/image-upload";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format/currency";
import {
  createMenuItem,
  deleteMenuItem,
  setItemAvailability,
  updateMenuItem,
  type MenuItemInput,
} from "@/lib/data/manager-actions";
import { uploadMenuImage } from "./image-actions";
import { OptionTemplateSheet } from "./option-template-sheet";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { MenuCategory, MenuItem } from "@/lib/data/manager";
import { cn } from "@/lib/utils";
import { localizeActionError } from "@/lib/i18n/staff-errors";

/**
 * Menu management.
 *
 * PLAN LIMIT ENFORCED HERE (§5). At the ceiling, existing items keep working
 * and only creation is refused — with a link to /m/billing. Breaking what a
 * restaurant already has because their card expired is how you lose a tenant
 * mid-service; refusing the 21st item is not.
 *
 * Every mutation is a Server Action. Nothing is edited in local state and
 * hoped for: the row you see after a save is the row that is in the database,
 * because the page revalidates rather than patching an array.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A ROW IS A CARD BELOW `md`, AND A LINE FROM `md` UP.
 *
 *  It used to be one wide flex line — name, price, availability switch,
 *  options, edit, delete — which on a 360px phone pushed the switch and the
 *  two buttons past the right edge of the screen. Marking a dish sold out
 *  mid-service meant scrolling the page sideways to reach a control, which is
 *  precisely the complaint this rebuild answers.
 *
 *  Stacked: title block, price, then a full-width row of actions. Nothing on
 *  this screen needs a horizontal scroll to be operated.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Derived from the action itself, so the two can never drift apart. */
type ActionResult = Awaited<ReturnType<typeof updateMenuItem>>;

/**
 * A photo chosen but NOT YET SENT, or the saved one marked for removal.
 *
 * Kept beside the draft rather than in it: `MenuItemInput.imageUrl` is a
 * string, a File is not, and choosing a file must behave like every other
 * field on the panel — nothing reaches the server until you press Save, and
 * Cancel throws the choice away.
 */
type PhotoChoice = { file: File; previewUrl: string } | { remove: true };

interface Editing {
  id: string | null;
  draft: MenuItemInput;
  photo: PhotoChoice | null;
}

const EMPTY: MenuItemInput = {
  categoryId: null,
  name: "",
  description: "",
  price: 0,
  imageUrl: null,
  isAvailable: true,
  isFeatured: false,
  prepMinutes: 15,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: null,
  dietaryTags: "",
  allergens: "",
  priceToConfirm: false,
  priceMax: null,
};

export function MenuManager({
  categories,
  items,
  limit,
  canEdit,
  canToggleAvailability = canEdit,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  /** null = unlimited */
  limit: number | null;
  canEdit: boolean;
  /**
   * `menu.availability` — the sold-out switch alone. The kitchen and the
   * cashier hold it without `menu.edit`: they see the switch, not the
   * edit / options / delete controls beside it.
   */
  canToggleAvailability?: boolean;
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availability, setAvailability] = useState("all");

  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);
  /** "Accompagnements & choix": one list applied to many dishes. */
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const atLimit = limit !== null && items.length >= limit;

  /**
   * French counts zero as singular ("0 plat"), English does not ("0 dishes"),
   * so the plural variant is chosen here rather than baked into one string.
   */
  function plural(base: string, count: number): TranslationKey {
    const many = locale === "fr" ? count > 1 : count !== 1;
    return `${base}_${many ? "other" : "one"}` as TranslationKey;
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== "all" && item.categoryId !== categoryFilter) return false;
      if (availability === "available" && !item.isAvailable) return false;
      if (availability === "unavailable" && item.isAvailable) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    });
  }, [items, query, categoryFilter, availability]);

  function run(fn: () => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast(localizeActionError(result.error, locale), "error");
      toast(success, "success");
    });
  }

  /* ── Editor ──────────────────────────────────────────────────────────── */

  function openNew() {
    setEditing({
      id: null,
      draft: { ...EMPTY, categoryId: categories[0]?.id ?? null },
      photo: null,
    });
  }

  function openEdit(item: MenuItem) {
    setEditing({
      id: item.id,
      draft: {
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        price: item.price,
        imageUrl: item.imageUrl,
        isAvailable: item.isAvailable,
        isFeatured: item.isFeatured,
        prepMinutes: item.prepMinutes,
        trackStock: item.trackStock,
        stockQuantity: item.stockQuantity,
        lowStockThreshold: item.lowStockThreshold,
        dietaryTags: item.dietaryTags,
        allergens: item.allergens,
        priceToConfirm: item.priceToConfirm ?? false,
        priceMax: item.priceMax ?? null,
      },
      photo: null,
    });
  }

  function patch(changes: Partial<MenuItemInput>) {
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...changes } } : current));
  }

  /** A blob: URL is a live handle — dropping the state without freeing it leaks. */
  function releasePreview(photo: PhotoChoice | null | undefined) {
    if (photo && "previewUrl" in photo) URL.revokeObjectURL(photo.previewUrl);
  }

  function choosePhoto(file: File) {
    // Both the createObjectURL and the revoke happen HERE, not inside the
    // updater: React may call an updater twice, and a side effect in one
    // leaks a URL or frees a live one.
    const previewUrl = URL.createObjectURL(file);
    releasePreview(editing?.photo);
    setEditing((current) => (current ? { ...current, photo: { file, previewUrl } } : current));
  }

  function undoPhoto() {
    releasePreview(editing?.photo);
    setEditing((current) => (current ? { ...current, photo: null } : current));
  }

  function removePhoto() {
    releasePreview(editing?.photo);
    // Marked, not applied. Save is still the thing that commits it.
    setEditing((current) => (current ? { ...current, photo: { remove: true } } : current));
  }

  function closeEditor() {
    releasePreview(editing?.photo);
    setEditing(null);
  }

  /**
   * Commit the dish, photo first.
   *
   * Photo first because it is the failure-prone half: the upload is refused by
   * content, not by file name, and stopping there leaves the panel open with
   * everything the manager typed still in it rather than saving a dish that
   * claims a picture it never got.
   */
  function save() {
    if (!editing) return;
    const { id, draft, photo } = editing;

    startTransition(async () => {
      let imageUrl = draft.imageUrl ?? null;

      if (photo && "remove" in photo) {
        imageUrl = null;
      } else if (photo) {
        const body = new FormData();
        body.append("file", photo.file);

        const upload = await uploadMenuImage(body);
        if (!upload.ok) {
          return toast(t(`mm.photoErr.${upload.reason}` as TranslationKey), "error");
        }
        imageUrl = upload.url;
      }

      const payload: MenuItemInput = { ...draft, imageUrl };
      const result = await (id ? updateMenuItem(id, payload) : createMenuItem(payload));
      if (!result.ok) return toast(result.error, "error");

      releasePreview(photo);
      setEditing(null);
      toast(id ? t("mm.saved") : t("mm.added"), "success");
    });
  }

  const pendingPhoto = editing?.photo ?? null;
  /** The pending blob if there is one, the marked-removal blank, else the saved value. */
  const preview = pendingPhoto
    ? "previewUrl" in pendingPhoto
      ? pendingPhoto.previewUrl
      : null
    : (editing?.draft.imageUrl ?? null);

  return (
    <>
      {atLimit && (
        <div
          role="status"
          className="mb-5 flex flex-col gap-3 rounded-md border border-warning/30 bg-warning-light p-4 text-warning sm:flex-row sm:items-center"
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">
              {t("mm.limit.reached", { used: items.length, limit: limit ?? 0 })}
            </span>
            <span className="block opacity-85">{t("mm.limit.body")}</span>
          </p>
          <Link
            href="/m/billing"
            className={buttonClasses({ size: "sm", fullWidth: true, className: "sm:w-auto" })}
          >
            <span>{t("mm.limit.changePlan")}</span>
          </Link>
        </div>
      )}

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder={t("mm.search")}
        onClear={() => {
          setQuery("");
          setCategoryFilter("all");
          setAvailability("all");
        }}
        selects={[
          {
            key: "category",
            label: t("mm.filter.category"),
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: [
              { value: "all", label: t("mm.filter.allCategories") },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ],
          },
          {
            key: "availability",
            label: t("mm.filter.availability"),
            value: availability,
            onChange: setAvailability,
            options: [
              { value: "all", label: t("mm.filter.all") },
              { value: "available", label: t("mm.filter.available") },
              { value: "unavailable", label: t("mm.filter.unavailable") },
            ],
          },
        ]}
        trailing={
          canEdit && (
            <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={items.length === 0} onClick={() => setTemplatesOpen(true)}>
              <ListChecks className="size-4" aria-hidden />
              <span>{t("ons.o.open")}</span>
            </Button>
            <Button
              disabled={atLimit || categories.length === 0}
              title={
                atLimit
                  ? t("mm.limit.hint")
                  : categories.length === 0
                    ? t("mm.needCategory")
                    : undefined
              }
              onClick={openNew}
            >
              <Plus className="size-4" aria-hidden />
              <span>{t("mm.new")}</span>
            </Button>
            </div>
          )
        }
      />

      {/* A dish with no category still shows on the carte, but nothing groups
          it — so the nudge stays until there is somewhere to file them. */}
      {categories.length === 0 && canEdit && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-text-secondary">{t("mm.noCategoryYet")}</p>
          <Link
            href="/m/categories"
            className={buttonClasses({
              variant: "outline",
              size: "sm",
              fullWidth: true,
              className: "sm:w-auto",
            })}
          >
            <span>{t("mm.createCategory")}</span>
          </Link>
        </div>
      )}

      {!canEdit && (
        <p className="mt-4 text-sm text-text-light">
          {canToggleAvailability ? t("mops.menu.availabilityOnly") : t("mm.readOnly")}
        </p>
      )}

      <p className="mt-4 flex flex-wrap items-center gap-x-2 text-sm text-text-secondary">
        <span>{t(plural("mm.count", visible.length), { count: visible.length })}</span>
        {limit !== null && (
          <>
            <span aria-hidden className="text-text-light">
              ·
            </span>
            <span className="text-text-light">
              {t("mm.usage", { used: items.length, limit })}
            </span>
          </>
        )}
      </p>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        {visible.length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed />}
            title={items.length === 0 ? t("mm.empty") : t("mm.none")}
            description={items.length === 0 ? t("mm.emptyBody") : t("mm.noneBody")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((item) => {
              const lowStock =
                item.trackStock &&
                item.stockQuantity !== null &&
                item.lowStockThreshold !== null &&
                item.stockQuantity <= item.lowStockThreshold;

              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-5",
                    !item.isAvailable && "bg-surface-2/50",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {item.imageUrl && (
                      /*
                        A plain <img>, like brand-mark and the uploader preview.
                        These files are uploaded, so their dimensions are
                        unknown, and next/image would need width and height we
                        do not have — or a remote pattern for a URL that may
                        not be local at all.
                      */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-14 shrink-0 rounded-md border border-border object-cover sm:size-16"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">
                          <span>{item.name}</span>
                        </p>
                        {!item.isAvailable && (
                          <Badge tone="neutral">
                            <span>{t("mm.badge.unavailable")}</span>
                          </Badge>
                        )}
                        {item.trackStock && (
                          <Badge tone={item.stockQuantity === 0 ? "error" : lowStock ? "warning" : "neutral"}>
                            <span>
                              {item.stockQuantity === 0
                                ? t("mm.badge.soldOut")
                                : t("mm.badge.stock", { count: item.stockQuantity ?? 0 })}
                            </span>
                          </Badge>
                        )}
                        {item.isFeatured && (
                          <Badge tone="accent">
                            <span>{t("mm.badge.featured")}</span>
                          </Badge>
                        )}
                        {item.optionGroups.length > 0 && (
                          <Badge tone="info">
                            <span>
                              {t(plural("mm.badge.options", item.optionGroups.length), {
                                count: item.optionGroups.length,
                              })}
                            </span>
                          </Badge>
                        )}
                        {!item.categoryId && (
                          <Badge tone="warning">
                            <span>{t("mm.badge.uncategorised")}</span>
                          </Badge>
                        )}
                      </div>

                      {item.description && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary">
                          <span>{item.description}</span>
                        </p>
                      )}

                    </div>
                  </div>

                  <p className="tnum font-display text-lg font-bold text-primary md:shrink-0 md:text-right">
                    <span>
                      {item.priceToConfirm && (item.priceMax ?? 0) > item.price
                        ? `${formatMoney(item.price)} – ${formatMoney(item.priceMax ?? item.price)}`
                        : formatMoney(item.price)}
                    </span>
                    {item.priceToConfirm && (
                      <span className="block text-xs font-normal text-text-secondary">{t("ons.d.toConfirmShort")}</span>
                    )}
                  </p>

                  {canToggleAvailability && !canEdit && (
                    <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-3 md:w-auto md:shrink-0 md:border-0 md:pt-0">
                      <Switch
                        label={t("mm.available")}
                        aria-label={t("mm.availabilityOf", { name: item.name })}
                        checked={item.isAvailable}
                        disabled={pending}
                        onChange={() =>
                          run(
                            () => setItemAvailability(item.id, !item.isAvailable),
                            item.isAvailable
                              ? t("mm.markedSoldOut", { name: item.name })
                              : t("mm.markedAvailable", { name: item.name }),
                          )
                        }
                      />
                    </div>
                  )}

                  {canEdit && (
                    <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-3 md:w-auto md:shrink-0 md:border-0 md:pt-0">
                      <Switch
                        label={t("mm.available")}
                        aria-label={t("mm.availabilityOf", { name: item.name })}
                        checked={item.isAvailable}
                        disabled={pending}
                        className="mr-auto md:mr-1"
                        onChange={() =>
                          run(
                            () => setItemAvailability(item.id, !item.isAvailable),
                            item.isAvailable
                              ? t("mm.markedSoldOut", { name: item.name })
                              : t("mm.markedAvailable", { name: item.name }),
                          )
                        }
                      />
                      <Link
                        href={`/m/menu/${item.id}/modifiers`}
                        aria-label={t("mm.optionsOf", { name: item.name })}
                        className={buttonClasses({ variant: "outline", size: "sm" })}
                      >
                        <Sliders className="size-3.5" aria-hidden />
                        <span>{t("mm.options")}</span>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("mm.editDish", { name: item.name })}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("mm.deleteDish", { name: item.name })}
                        className="text-error hover:bg-error-light"
                        onClick={() => setDeleting(item)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      <Sheet
        open={editing !== null}
        onClose={closeEditor}
        title={editing?.id ? t("mm.editTitle") : t("mm.newTitle")}
        // Pinned, so adding a dish never requires scrolling past the allergen
        // list to find the button that commits it.
        footer={
          editing && (
            <SheetActions>
              <Button variant="outline" disabled={pending} onClick={closeEditor}>
                <span>{t("common.cancel")}</span>
              </Button>
              <Button
                loading={pending}
                disabled={editing.draft.name.trim().length < 2}
                onClick={save}
              >
                <span>{editing.id ? t("common.save") : t("common.add")}</span>
              </Button>
            </SheetActions>
          )
        }
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <Field label={t("mm.name")} htmlFor="item-name" required>
              <Input
                id="item-name"
                value={editing.draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder={t("mm.namePh")}
              />
            </Field>

            <Field label={t("mm.description")} htmlFor="item-description">
              <Textarea
                id="item-description"
                rows={3}
                value={editing.draft.description ?? ""}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder={t("mm.descriptionPh")}
              />
            </Field>

            {/* Choosing is not saving: the file waits here and is sent by Save,
                like every other field on the panel. */}
            <ImageUpload
              label={t("mm.photo")}
              shape="wide"
              hint={t("mm.photoHint")}
              previewUrl={preview}
              dirty={pendingPhoto !== null}
              disabled={pending}
              onSelect={choosePhoto}
              onUndo={undoPhoto}
              onRemove={removePhoto}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              {/*
                inputMode="numeric" and a whole-franc step. XAF is zero-decimal:
                there is no 2 500,50 FCFA, and letting the field accept one only
                produces a validation error the server has to explain later.
              */}
              <Field
                label={editing.draft.priceToConfirm ? t("ons.d.minPrice") : t("mm.price")}
                htmlFor="item-price"
                required
                hint={editing.draft.priceToConfirm ? t("ons.d.minPriceHint") : t("mm.priceHint")}
              >
                <Input
                  id="item-price"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={String(editing.draft.price)}
                  onChange={(e) => patch({ price: Math.trunc(Number(e.target.value) || 0) })}
                />
              </Field>

              <Field label={t("mm.prep")} htmlFor="item-prep">
                <Input
                  id="item-prep"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={String(editing.draft.prepMinutes ?? 15)}
                  onChange={(e) => patch({ prepMinutes: Math.trunc(Number(e.target.value) || 0) })}
                />
              </Field>
            </div>

            {/*
              CUSTOMIZABLE DISH (0069). One switch instead of twenty option
              lists: the customer says what they want, the restaurant confirms
              the price when accepting — before anyone pays — within the range.
            */}
            <div className="flex flex-col gap-3 rounded-md border border-border p-4">
              <Switch
                label={t("ons.d.toggle")}
                description={t("ons.d.toggleHint")}
                checked={editing.draft.priceToConfirm ?? false}
                onChange={(e) => patch({ priceToConfirm: e.target.checked })}
              />
              {editing.draft.priceToConfirm && (
                <Field label={t("ons.d.maxPrice")} htmlFor="item-price-max" hint={t("ons.d.maxPriceHint")}>
                  <Input
                    id="item-price-max"
                    type="number"
                    min={editing.draft.price}
                    step={1}
                    inputMode="numeric"
                    suffix="FCFA"
                    value={editing.draft.priceMax ? String(editing.draft.priceMax) : ""}
                    onChange={(e) => patch({ priceMax: Math.trunc(Number(e.target.value) || 0) || null })}
                  />
                </Field>
              )}
            </div>

            <Field
              label={t("mm.category")}
              htmlFor="item-category"
              hint={!editing.draft.categoryId ? t("mm.uncategorisedHint") : undefined}
            >
              <Select
                id="item-category"
                value={editing.draft.categoryId ?? ""}
                onChange={(e) => patch({ categoryId: e.target.value || null })}
              >
                <option value="">{t("mm.badge.uncategorised")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-col gap-3 rounded-md border border-border p-4">
              <Switch
                label={t("mm.availableToOrder")}
                checked={editing.draft.isAvailable ?? true}
                onChange={(e) => patch({ isAvailable: e.target.checked })}
              />
              <Switch
                label={t("mm.featured")}
                checked={editing.draft.isFeatured ?? false}
                onChange={(e) => patch({ isFeatured: e.target.checked })}
              />
              <Switch
                label={t("mm.trackStock")}
                checked={editing.draft.trackStock ?? false}
                onChange={(e) =>
                  patch({
                    trackStock: e.target.checked,
                    // Cleared rather than left behind: a stale count that
                    // reappears the day tracking is re-enabled is worse than
                    // no count at all.
                    stockQuantity: e.target.checked ? (editing.draft.stockQuantity ?? 0) : null,
                    lowStockThreshold: e.target.checked ? editing.draft.lowStockThreshold : null,
                  })
                }
              />

              {editing.draft.trackStock && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("mm.stock")} htmlFor="item-stock">
                    <Input
                      id="item-stock"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={String(editing.draft.stockQuantity ?? 0)}
                      onChange={(e) => patch({ stockQuantity: Math.trunc(Number(e.target.value) || 0) })}
                    />
                  </Field>
                  <Field label={t("mm.threshold")} htmlFor="item-threshold" hint={t("mm.thresholdHint")}>
                    <Input
                      id="item-threshold"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={String(editing.draft.lowStockThreshold ?? 0)}
                      onChange={(e) =>
                        patch({ lowStockThreshold: Math.trunc(Number(e.target.value) || 0) })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>

            {/*
              The tag IDS come from lib/menu/tags.ts — they are what is stored
              in the row. Their LABELS come from this screen's dictionary, so
              the same stored "sans-gluten" reads as "Sans gluten" or "Gluten
              free" without a single database write.
            */}
          </div>
        )}
      </Sheet>

      {templatesOpen && (
        <OptionTemplateSheet open onClose={() => setTemplatesOpen(false)} items={items} categories={categories} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("mm.deleteTitle", { name: deleting?.name ?? "" })}
        // True, and worth saying: order_items snapshots the name and price, so
        // past orders keep reading correctly after the dish is gone (§12).
        message={t("mm.deleteBody")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (deleting) run(() => deleteMenuItem(deleting.id), t("mm.deleted"));
          setDeleting(null);
        }}
      />
    </>
  );
}
