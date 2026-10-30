export interface Appearance { fontSize: number; fontWeight: number }
export const DEFAULT_APPEARANCE: Appearance = { fontSize: 15, fontWeight: 500 };
export function appearance(value?: Partial<Appearance>): Appearance {
  return {
    fontSize: Number.isFinite(value?.fontSize) ? Math.max(13, Math.min(20, value!.fontSize!)) : DEFAULT_APPEARANCE.fontSize,
    fontWeight: [400, 500, 600].includes(value?.fontWeight ?? 0) ? value!.fontWeight! : DEFAULT_APPEARANCE.fontWeight
  };
}
export function applyAppearance(root: HTMLElement, value?: Partial<Appearance>) {
  const normalized = appearance(value);
  root.style.setProperty("--ctt-font-size", `${normalized.fontSize}px`);
  root.style.setProperty("--ctt-font-weight", String(normalized.fontWeight));
}
// A dedicated mount keeps Obsidian/theme padding and overflow rules off the application root.
export function mountTimerView(content: HTMLElement) {
  content.classList.add("ctt-view-host"); content.style.padding = "0"; content.style.overflow = "hidden";
  const mount = content.ownerDocument.createElement("div"); content.replaceChildren(mount); return mount;
}
