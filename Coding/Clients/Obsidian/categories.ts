import type { Calendar } from "../../Shared/contracts";
import { el, button } from "./dom";
export interface CategoryPreferences { categoryOrder?: string[]; hiddenCategoryIds?: string[] }
export function categoryPreferences(value?: CategoryPreferences): Required<CategoryPreferences> {
  const ids = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === "string" && !!id))] : [];
  return { categoryOrder: ids(value?.categoryOrder), hiddenCategoryIds: ids(value?.hiddenCategoryIds) };
}
export function orderedCategories(calendars: Calendar[], value?: CategoryPreferences, visibleOnly = false) {
  const prefs = categoryPreferences(value), positions = new Map(prefs.categoryOrder.map((id, i) => [id, i]));
  return calendars.filter(c => !visibleOnly || !prefs.hiddenCategoryIds.includes(c.id))
    .map((c, i) => ({ c, i })).sort((a, b) => (positions.get(a.c.id) ?? Infinity) - (positions.get(b.c.id) ?? Infinity) || a.i - b.i).map(x => x.c);
}
export function renderCategorySettings(root: HTMLElement, calendars: Calendar[], initial: CategoryPreferences,
  save: (value: Required<CategoryPreferences>) => Promise<void>) {
  let prefs = categoryPreferences(initial), busy = false, error = "";
  root.classList.add("ctt-category-settings");
  const update = async (next: Required<CategoryPreferences>, focusId?: string) => {
    if (busy) return; const before = prefs; busy = true; error = ""; prefs = next; draw();
    try { await save(next); } catch (e) { prefs = before; error = (e as Error).message; }
    finally { busy = false; draw(); if (focusId) root.querySelector<HTMLInputElement>(`[data-category-index="${orderedCategories(calendars, prefs).findIndex(c => c.id === focusId)}"] input`)?.focus(); }
  };
  const draw = () => {
    root.replaceChildren(); el(root, "p", "ctt-muted", "排序和隐藏仅影响待办筛选栏。“全部”仍包含所有待办。");
    const list = el(root, "div", "ctt-category-setting-list");
    const categories = orderedCategories(calendars, prefs);
    if (!categories.length) el(list, "p", "ctt-muted", "连接日历后可设置分类。");
    categories.forEach((c, index) => {
      const row = el(list, "div", "ctt-category-setting"); row.dataset.categoryIndex = String(index);
      const label = el(row, "label", "ctt-category-visibility"), checkbox = el(label, "input"); checkbox.type = "checkbox"; checkbox.checked = !prefs.hiddenCategoryIds.includes(c.id); checkbox.disabled = busy; checkbox.setAttribute("aria-label", `显示分类 ${c.name}`);
      const dot = el(label, "span", "ctt-category-dot"); dot.style.background = c.color || "var(--interactive-accent)"; dot.setAttribute("aria-hidden", "true"); el(label, "span", "", c.name);
      checkbox.onchange = () => { void update({ ...prefs, hiddenCategoryIds: checkbox.checked ? prefs.hiddenCategoryIds.filter(id => id !== c.id) : [...prefs.hiddenCategoryIds, c.id] }, c.id); };
      const move = (offset: number) => {
        const order = categories.map(c => c.id), other = index + offset; [order[index], order[other]] = [order[other], order[index]];
        void update({ ...prefs, categoryOrder: [...order, ...prefs.categoryOrder.filter(id => !order.includes(id))] }, c.id);
      };
      const up = button(row, "↑", () => move(-1), "ctt-category-move", `上移 ${c.name}`); up.disabled = busy || index === 0;
      const down = button(row, "↓", () => move(1), "ctt-category-move", `下移 ${c.name}`); down.disabled = busy || index === categories.length - 1;
    });
    const message = el(root, "div", "ctt-dialog-error", error); message.setAttribute("role", "alert");
    const reset = button(root, "恢复默认排序与显示", () => { void update({ categoryOrder: [], hiddenCategoryIds: [] }); }, "ctt-quiet"); reset.disabled = busy;
  };
  draw();
}
