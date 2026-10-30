import type { Calendar } from "../../Shared/contracts";

export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const node = parent.ownerDocument.createElement(tag); node.className = cls; if (text != null) node.textContent = text; parent.append(node); return node;
}
export function button(parent: HTMLElement, text: string, action: () => void, cls = "", label?: string) {
  const b = el(parent, "button", cls, text); b.type = "button"; if (label) { b.title = label; b.setAttribute("aria-label", label); } b.onclick = action; return b;
}
export function field(parent: HTMLElement, label: string, type: string, value: string) {
  const l = el(parent, "label", "ctt-field"); el(l, "span", "", label);
  const input = el(l, "input");
  input.type = type; input.value = value; input.setAttribute("aria-label", label); if (type === "datetime-local") input.step = "1"; return input;
}
export function options(select: HTMLSelectElement, sources: Calendar[], value: string, placeholder = "选择分类") {
  const signature = JSON.stringify(sources.map(c => [c.id, c.name]));
  if (select.dataset.options !== signature) {
    select.replaceChildren(); const empty = el(select, "option", "", placeholder); empty.value = "";
    for (const c of sources) { const o = el(select, "option", "", c.name); o.value = c.id; }
    select.dataset.options = signature;
  }
  if (value && !sources.some(c => c.id === value)) {
    if (!Array.from(select.options).some(o => o.value === value)) { const o = el(select, "option", "", "分类已不可用"); o.value = value; }
  }
  select.value = value;
}
