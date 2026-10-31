import type { TaskRef } from "./api";

export function componentTaskBindings(value: unknown): Record<string, TaskRef> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([note, input]) => {
    const ref = input as Partial<TaskRef> | null;
    if (!note.endsWith(".md") || !ref || ref.kind !== "local" || typeof ref.path !== "string" || !ref.path || typeof ref.id !== "string" || !ref.id) return [];
    return [[note, { kind: "local", path: ref.path, id: ref.id }]];
  }));
}
