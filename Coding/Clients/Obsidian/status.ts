import type { Session, Task } from "../../Shared/contracts";
import { elapsed, secondsText } from "../../Shared/time";
import { sortedTasks, type TaskSort } from "./taskOrder";
export function updateStatus(node: HTMLElement, active: Session | null, tasks: Task[], mode: TaskSort = "manual") {
  const next = sortedTasks(tasks.filter(t => !t.completed), mode)[0];
  const text = active ? `◷ ${active.runningSince == null ? "已暂停 · " : ""}${active.title} · ${secondsText(elapsed(active))}` : next ? `下一项 · ${next.title}` : "◷ 暂无待办";
  node.textContent = text; node.title = `${text}\n点击打开计时与待办`; node.setAttribute("aria-label", `${text}，打开计时与待办`);
}
export function setupStatus(node: HTMLElement, open: () => void) {
  node.classList.add("ctt-statusbar-item"); node.setAttribute("role", "button"); node.tabIndex = 0; node.onclick = open;
  node.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
}
