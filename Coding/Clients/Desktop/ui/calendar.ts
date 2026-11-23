import {taskDisplayDate} from "../../../Shared/taskDates";
import { dayKey, shiftDate } from "../../../Shared/time";
import type { Task } from "../../../Shared/contracts";
type CalendarLayout = { view: "month" | "week"; poolOpen: boolean; togglePool: () => void };
const startOfWeek = (date: string) => shiftDate(date, -(new Date(date + "T12:00:00").getDay() + 6) % 7);
/** Shared by main and desktop widget. It owns display state, never timer/sync state. */
export class MonthCalendar {
  private month: Date; private tasks: Task[] = [];private signature="";
  constructor(private root: HTMLElement, private selected: string, private choose: (date: string) => void, private drop: (taskId: string, date: string) => void, private layout?: CalendarLayout) { this.month = new Date(selected + "T12:00:00"); }
  update(tasks: Task[], selected = this.selected) {
    this.tasks = tasks; this.selected = selected;
    const today = dayKey(), dates = tasks.flatMap(task => {
      const date = taskDisplayDate(task, today);
      return date ? [[date, this.layout ? task.title : ""]] : [];
    });
    const signature = JSON.stringify([+this.month, selected, today, this.layout?.view, this.layout?.poolOpen, dates]);
    if(signature===this.signature)return;
    this.signature=signature; this.render();
  }
  private render() {
    this.root.replaceChildren(); const head = document.createElement("div"); head.className = "month-head";
    const previous = document.createElement("button"), next = document.createElement("button"), today = document.createElement("button"), label = document.createElement("strong");
    const week = this.layout?.view === "week", firstKey = startOfWeek(week ? dayKey(+this.month) : dayKey(+new Date(this.month.getFullYear(), this.month.getMonth(), 1, 12)));
    previous.textContent = "‹"; previous.setAttribute("aria-label", week ? "上一周" : "上个月"); next.textContent = "›"; next.setAttribute("aria-label", week ? "下一周" : "下个月"); today.textContent = "今天";
    label.textContent = week ? `${firstKey} — ${shiftDate(firstKey, 6)}` : `${this.month.getFullYear()}年${this.month.getMonth() + 1}月`;
    const move = (n: number) => {
      this.month = week ? new Date(shiftDate(dayKey(+this.month), 7 * n) + "T12:00:00") : new Date(this.month.getFullYear(), this.month.getMonth() + n, 1, 12);
      if (week) this.choose(dayKey(+this.month));
      this.update(this.tasks);
    };
    previous.onclick = () => move(-1); next.onclick = () => move(1); today.onclick = () => { this.month = new Date(); this.choose(dayKey()); };
    if (this.layout) {
      const toolbar = document.createElement("div"); toolbar.className = "calendar-controls";
      toolbar.append(today, previous, next);
      for (const [view, text] of [["month", "月"], ["week", "周"]] as const) {
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = text;
        toggle.setAttribute("aria-pressed", String(this.layout.view === view));
        toggle.onclick = () => {
          this.layout!.view = view;
          this.month = new Date(this.selected + "T12:00:00");
          this.update(this.tasks);
          this.root.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
        };
        toolbar.append(toggle);
      }
      const pool = document.createElement("button"); pool.type = "button"; pool.textContent = "任务池";
      pool.setAttribute("aria-expanded", String(this.layout.poolOpen)); pool.setAttribute("aria-controls", "calendar-task-pool");
      pool.onclick = this.layout.togglePool; toolbar.append(pool);
      head.append(label, toolbar);
    } else head.append(previous, label, today, next);
    this.root.append(head);
    const grid = document.createElement("div"); grid.className = "month-grid" + (week ? " week-grid" : "");
    for (const day of ["一", "二", "三", "四", "五", "六", "日"]) { const cell = document.createElement("span"); cell.className = "weekday"; cell.textContent = this.layout ? "周" + day : day; grid.append(cell); }
    const todayKey = dayKey(), tasksByDate = new Map<string, Task[]>();
    for (const task of this.tasks) {
      const date = taskDisplayDate(task, todayKey);
      if (!date) continue;
      let group = tasksByDate.get(date);
      if (!group) tasksByDate.set(date, group = []);
      group.push(task);
    }
    for (let i = 0; i < (week ? 7 : 42); i++) {
      const key = shiftDate(firstKey, i), date = new Date(key + "T12:00:00"), button = document.createElement("button");
      button.type = "button"; button.dataset.date = key; button.className = "day" + (key === this.selected ? " selected" : "") + (!week && date.getMonth() !== this.month.getMonth() ? " muted" : "") + (key === todayKey ? " today" : "");
      const dayTasks = tasksByDate.get(key) || [];
      const number = document.createElement("span"); number.className = "day-number"; number.textContent = String(date.getDate());
      button.append(number); button.setAttribute("aria-label", key + (dayTasks.length ? `，${dayTasks.length} 个待办` : ""));
      if (this.layout) {
        for (const task of dayTasks.slice(0, week ? 4 : 2)) {
          const chip = document.createElement("span"); chip.className = "calendar-task"; chip.textContent = task.title; button.append(chip);
        }
      }
      const more = dayTasks.length - (this.layout ? (week ? 4 : 2) : 0);
      if (more > 0) { const count = document.createElement("small"); count.textContent = this.layout ? `+${more}` : String(more); button.append(count); }
      button.onclick = () => this.choose(key);
      button.ondragover = e => { if (e.dataTransfer?.types.includes("application/x-ctt-task")) { e.preventDefault(); button.classList.add("drop-target"); } };
      button.ondragleave = () => button.classList.remove("drop-target");
      button.ondrop = e => { e.preventDefault(); button.classList.remove("drop-target"); const id = e.dataTransfer?.getData("application/x-ctt-task"); if (id) this.drop(id, key); };
      grid.append(button);
    }
    this.root.append(grid);
  }
}
