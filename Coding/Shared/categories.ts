import type { Calendar } from "./contracts";
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
