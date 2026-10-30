import test from "node:test";
import assert from "node:assert/strict";
import { parseTasks, taskLine, reorderTaskText, updateTaskText, MarkdownTasks } from "../Clients/Obsidian/tasks";
import { sortedTasks, taskSort } from "../Clients/Obsidian/taskOrder";
const lines = ["# Inbox", "keep this note", taskLine("Zulu", "2026-11-03", "a", "research"), "notes below a", taskLine("Bravo", "", "b", "work"), taskLine("Alpha", "2026-11-01", "c", "research"), taskLine("Done", "", "d", "work", true), "## Footer", "keep this too"].join("\n").replace(/\n/g, "\r\n") + "\r\n";
const ids = (text: string) => parseTasks(text, "todo.md").map(t => t.id);
test("manual sorting persists by stable IDs without moving notes or task lines", () => {
  const output = reorderTaskText(lines, ["c", "b", "a"], ["a", "b", "c"]);
  assert.deepEqual(ids(output), ["c", "b", "a", "d"]); assert.ok(output.startsWith(lines));
  assert.ok(!/(?<!\r)\n/.test(output)); assert.equal(parseTasks(output, "todo.md").find(t => t.id === "d")!.completed, true);
});
test("sorting a filtered category leaves hidden tasks in their occupied slots", () => {
  const output = reorderTaskText(lines, ["c", "a"], ["a", "c"]);
  assert.deepEqual(ids(output), ["c", "b", "a", "d"]);
  assert.equal(parseTasks(output, "todo.md")[0].calendarId, "research");
});
test("task updates and completion preserve the saved order", () => {
  let output = reorderTaskText(lines, ["c", "a"], ["a", "c"]);
  const a = parseTasks(output, "todo.md").find(t => t.id === "a")!;
  output = updateTaskText(output, a, { title: "Renamed", completed: true });
  assert.deepEqual(ids(output), ["c", "b", "a", "d"]); assert.equal(parseTasks(output, "todo.md")[2].title, "Renamed");
});
test("new tasks append and deleted IDs do not corrupt manual sorting", () => {
  let output = reorderTaskText(lines, ["c", "a"], ["a", "c"]);
  output += taskLine("New", "", "new", "work") + "\r\n";
  output = output.replace(/^.*simple-task:b.*\r\n/gm, "");
  assert.deepEqual(ids(output), ["c", "a", "d", "new"]);
});
test("concurrent reordering and completion are rejected rather than overwritten", () => {
  const output = reorderTaskText(lines, ["c", "a"], ["a", "c"]);
  assert.throws(() => reorderTaskText(output, ["c", "a"], ["a", "c"]), /已变化/);
  const completed = updateTaskText(lines, parseTasks(lines, "todo.md")[0], { completed: true });
  assert.throws(() => reorderTaskText(completed, ["c", "a"], ["a", "c"]), /已变化/);
  assert.throws(() => reorderTaskText(lines, ["a", "a"], ["a", "c"]), /无效/);
});
test("date and title ordering are stable and never mutate manual order", () => {
  const tasks = parseTasks(lines, "todo.md").filter(t => !t.completed);
  assert.deepEqual(sortedTasks(tasks, "due").map(t => t.id), ["c", "a", "b"]);
  assert.deepEqual(sortedTasks(tasks, "title").map(t => t.id), ["c", "b", "a"]);
  assert.deepEqual(tasks.map(t => t.id), ["a", "b", "c"]); assert.equal(taskSort("unknown"), "manual");
});
test("corrupt ordering metadata cannot hide tasks and a reorder repairs it", () => {
  const broken = lines + "<!-- ctt-task-order:broken -->\r\n";
  assert.deepEqual(ids(broken), ["a", "b", "c", "d"]);
  const fixed = reorderTaskText(broken, ["c", "a"], ["a", "c"]);
  assert.deepEqual(ids(fixed), ["c", "b", "a", "d"]); assert.equal(fixed.match(/ctt-task-order:/g)?.length, 1);
});
test("atomic Markdown reorder failure leaves original tasks intact", async () => {
  let stored = lines;
  const app = { vault: { getAbstractFileByPath: () => ({ path: "todo.md", extension: "md" }), process: async (_file: unknown, edit: (text: string) => string) => { edit(stored); throw new Error("disk full"); } } };
  const tasks = new MarkdownTasks(app as any, () => "todo.md");
  await assert.rejects(tasks.reorder(["c", "a"], ["a", "c"]), /disk full/); assert.equal(stored, lines);
});
