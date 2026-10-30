import type { Task } from "../../Shared/contracts";
export type TaskSort = "manual" | "due" | "title";
export const TASK_SORT_LABELS: Record<TaskSort, string> = { manual: "手动排序", due: "按日期", title: "按标题" };
export function taskSort(value: unknown): TaskSort { return value === "due" || value === "title" ? value : "manual"; }
export function orderByIds(tasks: Task[], ids: string[]) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return tasks.map((task, index) => ({ task, index })).sort((a, b) =>
    (rank.get(a.task.id) ?? Infinity) - (rank.get(b.task.id) ?? Infinity) || a.index - b.index).map(x => x.task);
}
export function sortedTasks(tasks: Task[], mode: TaskSort = "manual") {
  return tasks.map((task, index) => ({ task, index })).sort((a, b) => {
    const cmp = mode === "due" ? (a.task.due || "9999").localeCompare(b.task.due || "9999") :
      mode === "title" ? a.task.title.localeCompare(b.task.title, "zh-CN", { numeric: true }) : 0;
    return cmp || a.index - b.index;
  }).map(x => x.task);
}
// A category filter reorders only its occupied slots, preserving hidden tasks.
export function reorderTaskSlots(tasks: Task[], nextIds: string[], expectedIds: string[]) {
  const selected = new Set(expectedIds);
  if (!expectedIds.length || selected.size !== expectedIds.length || new Set(nextIds).size !== nextIds.length ||
      nextIds.length !== expectedIds.length || nextIds.some(id => !selected.has(id))) throw new Error("排序列表无效。");
  const current = tasks.filter(t => selected.has(t.id));
  if (current.length !== expectedIds.length || current.some((t, i) => t.completed || t.id !== expectedIds[i])) throw new Error("待办顺序或完成状态已变化，请刷新后重试。");
  const byId = new Map(current.map(t => [t.id, t])); let i = 0;
  return tasks.map(t => selected.has(t.id) ? byId.get(nextIds[i++])! : t);
}
