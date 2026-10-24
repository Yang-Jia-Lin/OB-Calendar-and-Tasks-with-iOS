import { setIcon } from 'obsidian';

/**
 * Creates a beautiful calendar badge/colored dot.
 */
export function createColorDot(color: string): HTMLElement {
  const dot = createSpan({ cls: 'fc-lp-color-dot' });
  dot.style.backgroundColor = color;
  return dot;
}

/**
 * Creates a beautiful category pill.
 */
export function createCategoryPill(text: string, color?: string): HTMLElement {
  const pill = createSpan({ cls: 'fc-lp-category-pill', text });
  if (color) {
    pill.style.borderColor = color;
    pill.style.color = color;
  }
  return pill;
}

/**
 * Creates an interactive Lucide icon button with smooth hover effects.
 */
export function createIconButton(
  iconId: string,
  tooltip: string,
  onClick: (e: MouseEvent) => void
): HTMLElement {
  const btn = createEl('button', { cls: 'fc-lp-icon-button' });
  btn.setAttribute('aria-label', tooltip);
  setIcon(btn, iconId);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    onClick(e);
  });
  return btn;
}

/**
 * Creates a standard premium task checkbox.
 */
export function createTaskCheckbox(
  checked: boolean,
  onClick: (e: MouseEvent) => void
): HTMLElement {
  const checkbox = createEl('input', {
    attr: { type: 'checkbox' },
    cls: 'task-list-item-checkbox'
  });
  checkbox.checked = checked;
  checkbox.addEventListener('click', e => {
    e.stopPropagation();
    onClick(e);
  });
  return checkbox;
}
