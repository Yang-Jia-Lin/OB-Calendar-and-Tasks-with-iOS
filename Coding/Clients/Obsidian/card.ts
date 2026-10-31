import { sameTask, type TimerApi, type TaskRef, type TimerState, type EntryContext } from "./api";
import { elapsed, secondsText } from "../../Shared/time";

/** Plain DOM presentation shared by Markdown render children and the interaction preview. */
export function mountTaskCard(root: HTMLElement, api: TimerApi, ref: TaskRef, context: EntryContext) {
  const doc = root.ownerDocument;
  root.classList.add("ctt-card");
  const title = doc.createElement("div"), status = doc.createElement("div"), controls = doc.createElement("div"), message = doc.createElement("div");
  title.textContent = "任务计时"; title.className = "ctt-card-title";
  status.setAttribute("role", "status"); status.className = "ctt-card-status";
  controls.className = "ctt-card-controls"; message.className = "ctt-card-message"; message.setAttribute("role", "status");
  root.replaceChildren(title, status, controls, message);
  // Components cards open the note on a bubbling click. Keep controls in the current research page.
  const stop = (e: Event) => e.stopPropagation();
  for (const event of ["click", "dblclick", "pointerdown", "keydown"]) root.addEventListener(event, stop);
  let disposed = false, working = false, state: TimerState = api.getState(), controlKey = "";
  const run = async (action: () => ReturnType<TimerApi["start"]>) => {
    if (disposed || working) return;
    working = true; message.textContent = ""; render();
    try {
      const result = await action();
      if (!disposed) message.textContent = result.ok ? result.recordId ? result.warning || "工时已保存在本机，后台同步中。" : "" : result.message;
    } catch (e) { if (!disposed) message.textContent = (e as Error).message; }
    finally { working = false; if (!disposed) render(); }
  };
  const add = (label: string, action: () => ReturnType<TimerApi["start"]>) => {
    const button = doc.createElement("button"); button.type = "button"; button.textContent = label;
    button.disabled = working || !state.available; button.onclick = () => { void run(action); }; controls.append(button);
  };
  function render() {
    if (disposed) return;
    const active = state.active, own = active && sameTask(active.task, ref);
    const task = state.tasks.find(t => sameTask(t, ref));
    title.textContent = own ? active.title : task?.title || "任务计时";
    status.textContent = !state.available ? "计时插件已卸载" : own ? `${active.runningSince == null ? "已暂停" : "进行中"} · ${secondsText(elapsed(active))}`
      : active ? `正在计时：${active.title}；请先结束后切换` : task?.completed ? "任务已完成" : `尚未开始${state.pending ? ` · ${state.pending} 项待同步` : ""}`;
    const key = JSON.stringify([active?.id, active?.runningSince == null, working, state.available, task?.completed]);
    if (key === controlKey) return; controlKey = key;
    controls.replaceChildren();
    if (own) {
      const id = active.id;
      add(active.runningSince == null ? "继续" : "暂停", () => active.runningSince == null ? api.resume(id) : api.pause(id));
      add("结束只记时间", () => api.finish(id, false));
      add("结束并完成", () => api.finish(id, true));
    } else {
      add("开始任务", () => api.start(ref, context));
      if (active || task?.completed) (controls.firstElementChild as HTMLButtonElement).disabled = true;
    }
  }
  const unsubscribe = api.subscribe(next => { state = next; render(); });
  return () => {
    if (disposed) return; disposed = true; unsubscribe();
    for (const event of ["click", "dblclick", "pointerdown", "keydown"]) root.removeEventListener(event, stop);
    controls.replaceChildren();
  };
}

export function parseCardRef(source: string): TaskRef {
  const value: unknown = JSON.parse(source);
  const ref = value as TaskRef;
  if (!ref || ref.kind !== "local" || typeof ref.path !== "string" || typeof ref.id !== "string" || !ref.id || !ref.path) throw new Error("计时块需要 kind、path 和稳定任务 id。");
  return { kind: "local", path: ref.path, id: ref.id };
}
