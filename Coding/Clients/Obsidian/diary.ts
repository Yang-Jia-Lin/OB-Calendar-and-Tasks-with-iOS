import type { Calendar, TimelineRow } from "../../Shared/contracts";
import { dateParts } from "../../Shared/time";

export const DIARY_START = "<!-- ctt-diary-timeline:start -->";
export const DIARY_END = "<!-- ctt-diary-timeline:end -->";
export const DIARY_BUTTON = "```calendar-task-timer-diary\n```";
export const DEFAULT_DIARY_FOLDER = "00-Record/Calendar/Daily";
export const DEFAULT_DIARY_LAYOUT_PATH = "Others/Template/日记时间轴模板.md";
export const DEFAULT_DIARY_LAYOUT = `### 当天时间轴

{{timeline}}

> 日记日期：{{date}} · 快照更新：{{updated}}
> 来源：日历当前已加载数据及本机已结束工时；日历同步完成后可再次更新。
`;

export function diaryPath(value: unknown, fallback: string) {
  const p = typeof value === "string" ? value.trim().replace(/\\/g, "/").replace(/\/$/, "") : fallback;
  if (!p || p.startsWith("/") || p.split("/").some(s => !s || s === "." || s === ".." || s.startsWith(".")) || /[:\x00-\x1f]/.test(p)) throw new Error("日记路径须为库内普通文件夹或文件路径。");
  return p;
}
export function validDiaryDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const n = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}
export function diaryDate(path: string, property: unknown, folder = DEFAULT_DIARY_FOLDER) {
  if (!path.startsWith(`${diaryPath(folder, DEFAULT_DIARY_FOLDER)}/`) || !path.endsWith(".md")) throw new Error("请打开日记目录内的 Markdown 日记。");
  const match = path.split("/").at(-1)!.slice(0, -3).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+.*)?$/);
  if (!match) throw new Error("日记文件名需要包含年月日。");
  const fromName = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  if (!validDiaryDay(fromName)) throw new Error("日记文件名中的日期无效。");
  if (property !== undefined && property !== null && property !== "") {
    if (!validDiaryDay(property)) throw new Error("日记日期属性无效，请使用 YYYY-MM-DD。");
    return property;
  }
  return fromName;
}

function inline(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()!|~]/g, c => `\\${c}`);
}
export function renderDiary(date: string, rows: TimelineRow[], calendars: Calendar[], layout = DEFAULT_DIARY_LAYOUT, now = Date.now()) {
  if (!validDiaryDay(date)) throw new Error("日记日期无效。");
  if (layout.split("{{timeline}}").length !== 2 || layout.includes(DIARY_START) || layout.includes(DIARY_END)) throw new Error("时间轴模板须且只能包含一个 {{timeline}}，不能包含生成区标记。");
  const start = +new Date(`${date}T00:00:00`), next = new Date(start); next.setDate(next.getDate() + 1);
  const end = +next, names = new Map(calendars.map(c => [c.id, c.name]));
  for (const r of rows) if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start) throw new Error("日历存在无效时间段，保留原时间轴。");
  const visible = rows.filter(r => r.start < end && r.end > start).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start || a.key.localeCompare(b.key));
  const lines = visible.map(r => {
    const time = r.allDay ? "全天" : `${r.start < start ? "00:00" : dateParts(r.start).time.slice(0, 5)}–${r.end >= end ? "24:00" : dateParts(r.end).time.slice(0, 5)}${r.start < start || r.end > end ? "（跨日）" : ""}`;
    const kind = r.recordId ? "实际工时" : "日程";
    const state = r.deleting ? " · 待删除" : r.pending ? " · 待同步" : "";
    return `| ${time} | ${inline(r.title)} | ${inline(names.get(r.calendarId) || "未命名日历")} | ${kind}${state} |`;
  });
  const timeline = lines.length ? ["| 时间 | 内容 | 日历 | 类型 |", "| --- | --- | --- | --- |", ...lines].join("\n") : "当天暂无已加载的日程或已结束工时。";
  const at = dateParts(now);
  // Replace tokens in one pass so event titles containing {{date}} remain literal text.
  const tokens: Record<string, string> = { timeline, date, updated: `${at.date} ${at.time}` };
  return { markdown: layout.replace(/\{\{(timeline|date|updated)\}\}/g, (_, k: string) => tokens[k]).trim(), count: visible.length };
}

export function diaryRegion(text: string) {
  const found: { type: "start" | "end"; from: number; to: number }[] = [];
  let fence = "";
  for (const m of text.matchAll(/[^\n]+\n?|\n/g)) {
    const line = m[0].replace(/\r?\n$/, ""), token = line.trim();
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = ""; }
    if (line.includes(DIARY_START) || line.includes(DIARY_END)) {
      if (fence || (token !== DIARY_START && token !== DIARY_END)) throw new Error("时间轴标记位置异常，未改动笔记。");
      found.push({ type: token === DIARY_START ? "start" : "end", from: m.index!, to: m.index! + m[0].length });
    }
  }
  if (!found.length) return null;
  if (found.length !== 2 || found[0].type !== "start" || found[1].type !== "end") throw new Error("时间轴标记缺失、重复或顺序异常，未改动笔记。");
  return { from: found[0].to, to: found[1].from, content: text.slice(found[0].to, found[1].from) };
}
export function replaceDiary(text: string, markdown: string) {
  if (markdown.includes(DIARY_START) || markdown.includes(DIARY_END)) throw new Error("生成内容包含保留标记。");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const block = markdown.replace(/\r?\n/g, newline) + newline;
  const region = diaryRegion(text);
  if (region) return text.slice(0, region.from) + block + text.slice(region.to);
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  let at = bom;
  if (/^---\r?\n/.test(text.slice(bom))) {
    const frontmatter = text.slice(bom).match(/^---\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
    if (!frontmatter) throw new Error("笔记属性区未闭合，未改动笔记。");
    at += frontmatter[0].length;
  }
  const section = `${DIARY_BUTTON}\n\n${DIARY_START}\n${markdown}\n${DIARY_END}\n\n`.replace(/\r?\n/g, newline);
  return text.slice(0, at) + (at && !text.slice(0, at).endsWith("\n") ? newline : "") + section + text.slice(at);
}

export interface DiaryPorts {
  read(path: string): Promise<string>;
  date(path: string, text: string): string;
  layout(): Promise<string>;
  snapshot(date: string): Promise<{ rows: TimelineRow[]; calendars: Calendar[] }>;
  backup(path: string, text: string): Promise<void>;
  process(path: string, update: (current: string) => string): Promise<void>;
  available(): boolean;
}
export class DiaryUpdater {
  private pending = new Map<string, Promise<{ count: number; changed: boolean }>>();
  constructor(private ports: DiaryPorts) {}
  update(path: string) {
    const existing = this.pending.get(path); if (existing) return existing;
    const promise = this.write(path); this.pending.set(path, promise);
    void promise.finally(() => this.pending.delete(path)).catch(() => {});
    return promise;
  }
  private async write(path: string) {
    const p = this.ports;
    if (!p.available()) throw new Error("插件已卸载，请重新加载。");
    const before = await p.read(path), date = p.date(path, before), region = diaryRegion(before);
    const layout = await p.layout(), snapshot = await p.snapshot(date);
    const result = renderDiary(date, snapshot.rows, snapshot.calendars, layout);
    if (replaceDiary(before, result.markdown) === before) return { count: result.count, changed: false };
    if (!p.available()) throw new Error("插件已卸载，保留原笔记。");
    await p.backup(path, before);
    await p.process(path, current => {
      if (!p.available()) throw new Error("插件已卸载，保留原笔记。");
      if (p.date(path, current) !== date || diaryRegion(current)?.content !== region?.content) throw new Error("日记日期或生成区已被修改，请重新更新。");
      return replaceDiary(current, result.markdown);
    });
    return { count: result.count, changed: true };
  }
}
