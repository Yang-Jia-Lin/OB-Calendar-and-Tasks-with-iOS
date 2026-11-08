import {taskDisplayDate} from "../../../Shared/taskDates";
import { dayKey } from "../../../Shared/time";
import type { Task } from "../../../Shared/contracts";
/** Shared by main and desktop widget. It owns display state, never timer/sync state. */
export class MonthCalendar {
  private month: Date; private tasks: Task[] = [];private signature="";
  constructor(private root: HTMLElement, private selected: string, private choose: (date: string) => void, private drop: (taskId: string, date: string) => void) { this.month = new Date(selected + "T12:00:00"); }
  update(tasks: Task[], selected = this.selected) { this.tasks = tasks; this.selected = selected;const signature=JSON.stringify([this.month.getFullYear(),this.month.getMonth(),selected,dayKey(),tasks.map(t=>taskDisplayDate(t)).filter(Boolean)]);if(signature===this.signature)return;this.signature=signature;this.render(); }
  private render() {
    this.root.replaceChildren(); const head = document.createElement("div"); head.className = "month-head";
    const previous = document.createElement("button"), next = document.createElement("button"), today = document.createElement("button"), label = document.createElement("strong");
    previous.textContent = "‹"; previous.setAttribute("aria-label", "上个月"); next.textContent = "›"; next.setAttribute("aria-label", "下个月"); today.textContent = "今天";
    label.textContent = `${this.month.getFullYear()}年 ${this.month.getMonth() + 1}月`;
    const move = (n: number) => { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1, 12); this.render(); };
    previous.onclick = () => move(-1); next.onclick = () => move(1); today.onclick = () => { this.month = new Date(); this.choose(dayKey()); };
    head.append(previous, label, today, next); this.root.append(head);
    const grid = document.createElement("div"); grid.className = "month-grid";
    for (const day of ["一", "二", "三", "四", "五", "六", "日"]) { const cell = document.createElement("span"); cell.className = "weekday"; cell.textContent = day; grid.append(cell); }
    const first = new Date(this.month.getFullYear(), this.month.getMonth(), 1, 12); first.setDate(first.getDate() - (first.getDay() + 6) % 7);
    const counts = new Map<string, number>(); for (const task of this.tasks){const date=taskDisplayDate(task);if(date)counts.set(date,(counts.get(date)||0)+1);}
    for (let i = 0; i < 42; i++) {
      const date = new Date(first); date.setDate(first.getDate() + i); const key = dayKey(+date), button = document.createElement("button");
      button.type = "button"; button.dataset.date = key; button.className = "day" + (key === this.selected ? " selected" : "") + (date.getMonth() !== this.month.getMonth() ? " muted" : "") + (key === dayKey() ? " today" : "");
      button.textContent = String(date.getDate()); button.setAttribute("aria-label", key + (counts.has(key) ? `，${counts.get(key)} 个待办` : ""));
      if (counts.has(key)) { const dot = document.createElement("small"); dot.textContent = String(counts.get(key)); button.append(dot); }
      button.onclick = () => this.choose(key);
      button.ondragover = e => { if (e.dataTransfer?.types.includes("application/x-ctt-task")) { e.preventDefault(); button.classList.add("drop-target"); } };
      button.ondragleave = () => button.classList.remove("drop-target");
      button.ondrop = e => { e.preventDefault(); button.classList.remove("drop-target"); const id = e.dataTransfer?.getData("application/x-ctt-task"); if (id) this.drop(id, key); };
      grid.append(button);
    }
    this.root.append(grid);
  }
}
