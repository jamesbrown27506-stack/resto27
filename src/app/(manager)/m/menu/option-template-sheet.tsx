"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/input";
import { Sheet, SheetActions } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { applyOptionTemplate } from "@/lib/data/modifier-actions";
import { OPTION_PRESETS, suggestDishes, templateProblem, type OptionTemplate } from "@/lib/menu/presets";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { MenuCategory, MenuItem } from "@/lib/data/manager";

/**
 * "Accompagnements & choix" — one list, many dishes.
 *
 * Step 1: a list, from the Cameroonian library or copied from a dish that
 * already has it, adjusted here (rename, add a side, give one a price).
 * Step 2: the dishes to put it on — the ones whose names suggest it are
 * ticked in advance. Applying replaces a list of the same name, so the same
 * sheet is how a list is changed everywhere later.
 */
export function OptionTemplateSheet({
  open,
  onClose,
  items,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  categories: MenuCategory[];
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [source, setSource] = useState<string>(OPTION_PRESETS[0].key);
  const [template, setTemplate] = useState<OptionTemplate>(() => structuredClone(OPTION_PRESETS[0].template));
  const [selected, setSelected] = useState<string[]>(() => suggestDishes(OPTION_PRESETS[0], items));
  const [replace, setReplace] = useState(true);

  /** Every distinct list already on the menu, to copy from. */
  const existing = useMemo(() => {
    const seen = new Map<string, OptionTemplate>();
    for (const item of items) {
      for (const group of item.optionGroups) {
        const key = `group:${group.id}`;
        if ([...seen.values()].some((g) => g.name.toLowerCase() === group.name.toLowerCase())) continue;
        seen.set(key, {
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          isRequired: group.isRequired,
          options: group.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })),
        });
      }
    }
    return seen;
  }, [items]);

  function choose(key: string) {
    setSource(key);
    const preset = OPTION_PRESETS.find((p) => p.key === key);
    if (preset) {
      setTemplate(structuredClone(preset.template));
      setSelected(suggestDishes(preset, items));
      return;
    }
    const copied = existing.get(key);
    if (copied) {
      setTemplate(structuredClone(copied));
      // Pre-tick the dishes that do not have this list yet is not knowable
      // reliably; start from the dishes that already have one of its name.
      setSelected(items.filter((i) => i.optionGroups.some((g) => g.name.toLowerCase() === copied.name.toLowerCase())).map((i) => i.id));
    }
  }

  function patchOption(index: number, changes: Partial<{ name: string; priceDelta: number }>) {
    setTemplate((current) => ({
      ...current,
      options: current.options.map((o, i) => (i === index ? { ...o, ...changes } : o)),
    }));
  }

  const single = template.maxSelect <= 1;
  const problem = templateProblem(template);
  const byCategory = useMemo(() => {
    const groups = categories.map((c) => ({ id: c.id, name: c.name, dishes: items.filter((i) => i.categoryId === c.id) }));
    const loose = items.filter((i) => !categories.some((c) => c.id === i.categoryId));
    if (loose.length) groups.push({ id: "none", name: t("mm.badge.uncategorised"), dishes: loose });
    return groups.filter((g) => g.dishes.length > 0);
  }, [categories, items, t]);

  function apply() {
    start(async () => {
      const result = await applyOptionTemplate({ template, menuItemIds: selected, replace });
      if (!result.ok) return toast(result.error ?? t("common.error"), "error");
      toast(t("ons.o.applied", { name: template.name, count: result.count ?? selected.length }), "success");
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("ons.o.title")}
      footer={
        <SheetActions>
          <Button variant="outline" disabled={pending} onClick={onClose}><span>{t("common.cancel")}</span></Button>
          <Button loading={pending} disabled={pending || Boolean(problem) || selected.length === 0} onClick={apply}>
            <span>{t("ons.o.apply", { count: selected.length })}</span>
          </Button>
        </SheetActions>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-text-secondary">{t("ons.o.body")}</p>

        {/* ── 1. The list ─────────────────────────────────────────────── */}
        <Field label={t("ons.o.source")} htmlFor="template-source">
          <Select id="template-source" value={source} onChange={(e) => choose(e.target.value)}>
            <optgroup label={t("ons.o.library")}>
              {OPTION_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{t(`ons.o.preset.${preset.key}` as TranslationKey)}</option>
              ))}
            </optgroup>
            {existing.size > 0 && (
              <optgroup label={t("ons.o.copyFrom")}>
                {[...existing.entries()].map(([key, group]) => <option key={key} value={key}>{group.name}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>

        <div className="rounded-md border border-border p-4">
          <Field label={t("ons.o.listName")} htmlFor="template-name">
            <Input id="template-name" value={template.name} maxLength={60} onChange={(e) => setTemplate((c) => ({ ...c, name: e.target.value }))} />
          </Field>
          <div className="mt-3 flex flex-col gap-3">
            <Switch
              label={t("ons.o.required")}
              checked={template.isRequired}
              onChange={(e) => setTemplate((c) => ({ ...c, isRequired: e.target.checked, minSelect: e.target.checked ? Math.max(1, c.minSelect) : 0 }))}
            />
            <Switch
              label={t("ons.o.several")}
              checked={!single}
              onChange={(e) => setTemplate((c) => ({ ...c, maxSelect: e.target.checked ? Math.max(2, c.options.length) : 1 }))}
            />
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {template.options.map((option, index) => (
              <li key={index} className="flex items-center gap-2">
                <Input className="min-w-0 flex-1" value={option.name} maxLength={60} aria-label={t("ons.o.optionName")}
                  onChange={(e) => patchOption(index, { name: e.target.value })} />
                <Input className="w-28" type="number" step={50} inputMode="numeric" suffix="F" value={String(option.priceDelta)}
                  aria-label={t("ons.o.optionPrice")}
                  onChange={(e) => patchOption(index, { priceDelta: Math.round(Number(e.target.value) || 0) })} />
                <Button variant="ghost" size="icon-sm" aria-label={t("common.delete")} disabled={template.options.length <= 1}
                  onClick={() => setTemplate((c) => ({ ...c, options: c.options.filter((_, i) => i !== index) }))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="mt-2" disabled={template.options.length >= 30}
            onClick={() => setTemplate((c) => ({ ...c, options: [...c.options, { name: "", priceDelta: 0 }] }))}>
            <Plus className="size-3.5" aria-hidden />{t("ons.o.addOption")}
          </Button>
          <p className="mt-2 text-xs text-text-light">{t("ons.o.priceHint")}</p>
        </div>

        {/* ── 2. The dishes ───────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t("ons.o.dishes", { count: selected.length })}</p>
            <button type="button" className="text-xs font-semibold text-primary hover:underline"
              onClick={() => setSelected(selected.length === items.length ? [] : items.map((i) => i.id))}>
              {selected.length === items.length ? t("ons.o.none") : t("ons.o.all")}
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {byCategory.map((category) => (
              <fieldset key={category.id}>
                <legend className="mb-1 text-xs font-bold tracking-wide text-text-light uppercase">{category.name}</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {category.dishes.map((dish) => (
                    <Checkbox
                      key={dish.id}
                      label={dish.name}
                      checked={selected.includes(dish.id)}
                      onChange={(e) => setSelected((current) => e.target.checked ? [...current, dish.id] : current.filter((id) => id !== dish.id))}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <Switch className="mt-4" label={t("ons.o.replace")} description={t("ons.o.replaceHint")}
            checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        </div>
      </div>
    </Sheet>
  );
}
