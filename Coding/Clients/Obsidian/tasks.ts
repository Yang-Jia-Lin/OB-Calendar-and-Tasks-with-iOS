import type { App, TFile } from "obsidian";
import { uid, type Task } from "../../Shared/contracts";
import { orderByIds, reorderTaskSlots } from "./taskOrder";
import type { TaskRef } from "./api";
import type { TaskCompletion, TaskRepository } from "../../Shared/application";
const COMPLETIONS = /^\s*<!-- ctt-completions:([^\s<>]+) -->\s*$/;
export function parseCompletions(text: string): TaskCompletion[] {
  if (text.split(/\r?\n/).some(line => line.includes("<!-- ctt-completions:") && !COMPLETIONS.test(line))) throw new Error("完成记录元数据损坏，保留原文件。");
  const lines = text.split(/\r?\n/).filter(line => COMPLETIONS.test(line));
  if (!lines.length) return [];
  if (lines.length !== 1) throw new Error("完成记录元数据重复，保留原文件。");
  let events: unknown; try { events = JSON.parse(decodeURIComponent(lines[0].match(COMPLETIONS)![1])); } catch { throw new Error("完成记录元数据损坏，保留原文件。"); }
  if (!Array.isArray(events) || events.some(e => !e || typeof e.id !== "string" || typeof e.title !== "string" || typeof e.calendarId !== "string" || !Number.isFinite(e.completedAt) || e.completedAt < 0 || e.task?.kind !== "local" || typeof e.task.path !== "string" || typeof e.task.id !== "string") || new Set(events.map(e=>e.id)).size !== events.length) throw new Error("完成记录元数据无效，保留原文件。");
  return events;
}
export function setTaskCompletionText(text: string, task: Task, completed: boolean, now = Date.now(), makeId: () => string = uid) {
  const matches = parseTasks(text,task.path || "").filter(t=>t.id===task.id);
  if (matches.length !== 1) throw new Error("原待办不存在或 ID 重复。");
  const current = matches[0], events = parseCompletions(text);
  if (current.completed === completed) return text;
  const updated = updateTaskText(text,task,{completed},true);
  if (!completed) return updated;
  if (!Number.isFinite(now) || now < 0) throw new Error("完成时间无效。");
  events.push({id:makeId(),task:{kind:"local",path:task.path || "",id:task.id},title:current.title,calendarId:current.calendarId || "",completedAt:now});
  const marker = `<!-- ctt-completions:${encodeURIComponent(JSON.stringify(events))} -->`, eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (text.split(/\r?\n/).some(line=>COMPLETIONS.test(line))) return updated.split(/\r?\n/).map(line=>COMPLETIONS.test(line)?marker:line).join(eol);
  return updated + (updated.endsWith(eol)?"":eol) + marker + eol;
}
export function removeTaskText(text: string, task: Task) {
  const matches = parseTasks(text,task.path || "").filter(t=>t.id===task.id);
  if (matches.length !== 1) throw new Error("原待办不存在或 ID 重复。");
  updateTaskText(text,task,{},true); // Reject a stale editor before deleting its exact task.
  const eol=text.includes("\r\n")?"\r\n":"\n";
  return text.split(/\r?\n/).filter(line=>line.match(LINE)?.[4].match(MARK)?.[1]!==task.id&&line.match(CATEGORY_LINE)?.[1]!==task.id).join(eol);
}
export function restoreBoundTaskText(text: string, ref: TaskRef, seed: {title:string;due?:string;calendarId?:string}, validate: (task:Task)=>void = ()=>{}) {
  const matches=parseTasks(text,ref.path).filter(t=>t.id===ref.id);
  if(matches.length>1)throw new Error("任务 ID 重复，请先核对原待办。");
  const task=matches[0] || {...seed,id:ref.id,kind:"local" as const,path:ref.path,completed:false};validate(task);
  if(matches.length)return task.completed?setTaskCompletionText(text,task,false):text;
  const eol=text.includes("\r\n")?"\r\n":"\n";
  return text+(text.endsWith(eol)?"":eol)+taskLine(task.title,task.due,ref.id,task.calendarId).replace(/\n/g,eol)+eol;
}
export function configureBoundTaskText(text: string, ref: TaskRef, seed: {title:string;due?:string;calendarId?:string}) {
  const matches=parseTasks(text,ref.path).filter(t=>t.id===ref.id);
  if(matches.length>1)throw new Error("任务 ID 重复，请先核对原待办。");
  if(matches.length)return matches[0].calendarId===seed.calendarId?text:updateTaskText(text,matches[0],{calendarId:seed.calendarId},true);
  return restoreBoundTaskText(text,ref,seed);
}
const LINE = /^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/;
const MARK = /\s*<!--\s*simple-task:([a-zA-Z0-9-]+)\s*-->\s*$/;
const CATEGORY = /\s*<!--\s*ctt-category:([^\s<>]+)\s*-->/;
const CATEGORY_LINE = /^\s*<!--\s*ctt-category:([a-zA-Z0-9-]+):([^\s<>]+)\s*-->\s*$/;
const DUE = /(?:^|\s)📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/;
const ORDER = /^\s*<!--\s*ctt-task-order:([^\s<>]+)\s*-->\s*$/;
function storedOrder(text: string): string[] {
  const value = text.split(/\r?\n/).find(line => ORDER.test(line))?.match(ORDER)?.[1];
  if (!value) return [];
  try { const ids: unknown = JSON.parse(decodeURIComponent(value)); return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string"))] : []; } catch { return []; }
}
export function ensureTaskIds(text: string, makeId: () => string = uid) {
  const seen = new Set<string>(), eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.split(/\r?\n/).map(line => {
    const m = line.match(LINE); if (!m) return line;
    const id = m[4].match(MARK)?.[1];
    if (id && !seen.has(id)) { seen.add(id); return line; }
    const next = makeId(); seen.add(next); return line.replace(MARK, "") + ` <!-- simple-task:${next} -->`;
  }).join(eol);
}
export function parseTasks(text: string, path: string): Task[] {
  const categories = new Map(text.split(/\r?\n/).flatMap(line => { const m = line.match(CATEGORY_LINE); return m ? [[m[1], m[2]] as const] : []; }));
  const tasks = text.split(/\r?\n/).flatMap(line => {
    const m = line.match(LINE), id = m?.[4].match(MARK)?.[1]; if (!m || !id) return [];
    const body = m[4].replace(MARK, ""), category = categories.get(id) || body.match(CATEGORY)?.[1];
    let calendarId = ""; try { calendarId = category ? decodeURIComponent(category) : ""; } catch { /* keep an invalid category visible as unavailable */ calendarId = category || ""; }
    return [{ id, title: body.replace(CATEGORY, "").replace(DUE, "").trim(), due: body.match(DUE)?.[1] || "", calendarId,
      completed: m[2].toLowerCase() === "x", kind: "local" as const, path }];
  });
  return orderByIds(tasks, storedOrder(text));
}
export function reorderTaskText(text: string, nextIds: string[], expectedIds: string[], path = "") {
  const ordered = reorderTaskSlots(parseTasks(text, path), nextIds, expectedIds);
  const marker = `<!-- ctt-task-order:${encodeURIComponent(JSON.stringify(ordered.map(t => t.id)))} -->`;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/); let replaced = false;
  const updated = lines.flatMap(line => { if (!ORDER.test(line)) return [line]; if (replaced) return []; replaced = true; return [marker]; }).join(eol);
  return replaced ? updated : `${updated}${updated.endsWith(eol) ? "" : eol}${marker}${eol}`;
}
export function taskLine(title: string, due = "", id: string = uid(), calendarId = "", completed = false) {
  const clean = title.replace(/[\r\n]+/g, " ").replace(/<!--|-->/g, "").trim(); if (!clean) throw new Error("请填写待办名称。");
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due)) throw new Error("待办日期不正确。");
  // Put category metadata on its own non-task line, so the old timer still reads clean titles after rollback.
  return `- [${completed ? "x" : " "}] ${clean}${due ? ` 📅 ${due}` : ""} <!-- simple-task:${id} -->${calendarId ? `\n<!-- ctt-category:${id}:${encodeURIComponent(calendarId)} -->` : ""}`;
}
export function updateTaskText(text: string, task: Task, patch: Partial<Task>, check = true) {
  const current = parseTasks(text, task.path || "").find(t => t.id === task.id); if (!current) throw new Error("原待办已删除或移动。");
  if (check && ["title", "due", "calendarId", "completed"].some(k => (current[k as keyof Task] || "") !== (task[k as keyof Task] || ""))) throw new Error("待办已在其他位置修改，请重新打开。");
  const next = { ...current, ...patch };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const withoutCategory = text.split(/\r?\n/).filter(line => line.match(CATEGORY_LINE)?.[1] !== task.id).join(eol);
  return withoutCategory.replace(/[^\r\n]+/g, line => {
    const m = line.match(LINE);
    return m?.[4].match(MARK)?.[1] === task.id ? ((line.match(/^\s*/)?.[0] || "") + taskLine(next.title, next.due, next.id, next.calendarId, next.completed).replace(/\n/g, eol)) : line;
  });
}
export class MarkdownTasks implements TaskRepository {
  constructor(private app: App, private getPath: () => string) {}
  path() { const p = (this.getPath() || "待办计时/待办.md").replace(/\\/g, "/");
    if (p.startsWith("/") || p.split("/").some(s => s === ".." || s.startsWith(".")) || !p.endsWith(".md") || p.includes(":")) throw new Error("请使用笔记库内的普通 Markdown 文件路径。"); return p; }
  async file(create = false): Promise<TFile | null> {
    const p = this.path(); let file = this.app.vault.getAbstractFileByPath(p);
    if (!file && create) {
      let folder = ""; for (const part of p.split("/").slice(0, -1)) { folder = folder ? `${folder}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder); }
      file = await this.app.vault.create(p, "# 待办\n\n");
    }
    if (file && !("extension" in file)) throw new Error("待办路径指向文件夹。"); return file as TFile | null;
  }
  async list() { const file = await this.file(); if (!file) return [];
    let text = await this.app.vault.read(file); if (ensureTaskIds(text) !== text) { await this.app.vault.process(file, current => ensureTaskIds(current)); text = await this.app.vault.read(file); }
    return parseTasks(text, file.path); }
  async resolve(ref: TaskRef) {
    if (ref.kind !== "local" || ref.path !== this.path()) throw new Error("此任务不属于当前配置的待办文件，请核对绑定路径。");
    const file = await this.file(); if (!file) throw new Error("原待办文件不存在。");
    const matches = parseTasks(await this.app.vault.read(file), file.path).filter(t => t.id === ref.id);
    if (matches.length !== 1) throw new Error("任务 ID 不存在或重复，请在待办文件中核对。");
    return matches[0];
  }
  async add(title: string, due: string, calendarId: string) {
    if (!calendarId) throw new Error("请选择分类。"); const line = taskLine(title, due, uid(), calendarId), file = (await this.file(true))!;
    await this.app.vault.process(file, current => `${current.trimEnd()}\n${line}\n`);
  }
  async update(task: Task, patch: Partial<Task>, check = true) {
    const file = this.app.vault.getAbstractFileByPath(task.path || ""); if (!file || !("extension" in file)) throw new Error("找不到原待办文件。");
    await this.app.vault.process(file as TFile, current => updateTaskText(current, task, patch, check));
  }
  complete(task: Task) { return this.setCompleted(task,true); }
  async completions() { const file = await this.file(); return file ? parseCompletions(await this.app.vault.read(file)) : []; }
  async setCompleted(task: Task, completed: boolean) {
    if (task.path !== this.path()) throw new Error("任务不属于当前待办文件。");
    const file = await this.file(); if (!file) throw new Error("找不到原待办文件。");
    await this.app.vault.process(file,text=>setTaskCompletionText(text,task,completed));
  }
  async remove(task: Task) {
    if(task.path!==this.path())throw new Error("任务不属于当前待办文件。");
    const file=await this.file();if(!file)throw new Error("找不到原待办文件。");
    await this.app.vault.process(file,text=>removeTaskText(text,task));
  }
  async restoreBound(ref: TaskRef, seed: {title:string;due?:string;calendarId?:string}, validate: (task:Task)=>void) {
    if(ref.path!==this.path()||ref.kind!=="local"||!/^[a-zA-Z0-9-]+$/.test(ref.id))throw new Error("绑定已失效，请检查待办文件路径。");
    const file=(await this.file(true))!;
    await this.app.vault.process(file,text=>restoreBoundTaskText(text,ref,seed,validate));return this.resolve(ref);
  }
  async configureBound(ref: TaskRef, seed: {title:string;due?:string;calendarId?:string}) {
    if(ref.path!==this.path()||ref.kind!=="local"||!/^[a-zA-Z0-9-]+$/.test(ref.id))throw new Error("绑定路径已变化，请核对待办文件。");
    const file=(await this.file(true))!;await this.app.vault.process(file,text=>configureBoundTaskText(text,ref,seed));return this.resolve(ref);
  }
  async completeLocal(task: Task) {
    const file = this.app.vault.getAbstractFileByPath(task.path || ""); if (!file || !("extension" in file)) throw new Error("本地待办已删除或移动，请核对完成状态。");
    await this.app.vault.process(file as TFile, current => {
      const existing = parseTasks(current, file.path).find(t => t.id === task.id);
      if (!existing) throw new Error("本地待办已删除，请核对完成状态。");
      if (existing.completed) return current; // Crash after Markdown commit but before journal acknowledgement.
      return setTaskCompletionText(current, task, true);
    });
  }
  async reorder(nextIds: string[], expectedIds: string[]) {
    const file = await this.file(); if (!file) throw new Error("找不到待办文件。");
    await this.app.vault.process(file, current => reorderTaskText(current, nextIds, expectedIds, file.path));
  }
}
