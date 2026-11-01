import { sameTask, type ActionResult, type TaskRef, type TimerState } from "./api";

/** Expected identity is captured when the native button is painted/clicked, before async work. */
export async function toggleNoteTimer(note: string, expected: string | null | undefined, host: {
  state(): TimerState; binding(note: string): TaskRef | undefined;
  start(note: string): Promise<ActionResult>; finish(id: string): Promise<ActionResult>;
}): Promise<ActionResult> {
  const state = host.state(), ref = host.binding(note), active = state.active;
  if (expected === null) return host.start(note);
  if (typeof expected === "string") {
    if (!ref || active?.id !== expected || !sameTask(active.task, ref)) return { ok: false, code: "stale-session", message: "卡片对应的计时已变化，请按最新状态重试。" };
    return host.finish(expected);
  }
  return active && ref && sameTask(active.task, ref) ? host.finish(active.id) : host.start(note);
}

/** Reject ambiguous labels so an unrelated same-name button is never intercepted. */
export function nativeTimerLabels(value: unknown): Set<string> {
  const components = (value as { components?: unknown[] } | null)?.components;
  if (!Array.isArray(components)) return new Set<string>();
  const timer = new Set<string>(), other = new Set<string>();
  for (const item of components) {
    const properties = (item as { properties?: unknown[] } | null)?.properties;
    if (!Array.isArray(properties)) continue;
    for (const input of properties) {
      const p = input as { type?: string; name?: string; alias?: string; options?: { action?: { type?: string; expression?: string } } } | null;
      if (p?.type !== "button") continue;
      const label = p.alias?.trimStart() ? p.alias : p.name;
      if (!label) continue;
      const action = p.options?.action;
      (action?.type === "runScript" && /^\s*CalendarTaskTimerStart\s*\(\s*\)\s*;?\s*$/.test(action.expression || "") ? timer : other).add(label);
    }
  }
  return new Set([...timer].filter(label => !other.has(label)));
}

export function componentTaskBindings(value: unknown): Record<string, TaskRef> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([note, input]) => {
    const ref = input as Partial<TaskRef> | null;
    if (!note.endsWith(".md") || !ref || ref.kind !== "local" || typeof ref.path !== "string" || !ref.path || typeof ref.id !== "string" || !ref.id) return [];
    return [[note, { kind: "local", path: ref.path, id: ref.id }]];
  }));
}
