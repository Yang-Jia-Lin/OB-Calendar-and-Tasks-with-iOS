import test from "node:test";
import assert from "node:assert/strict";
import { DiaryUpdater, diaryDate, diaryPath, diaryRegion, replaceDiary, renderDiary, DIARY_START, DIARY_END, DEFAULT_DIARY_LAYOUT, type DiaryPorts } from "../Clients/Obsidian/diary";
import type { TimelineRow } from "../Shared/contracts";
const file = "00-Record/Calendar/Daily/Archive/2026年10月31日 星期六.md";
const original = "---\n日记日期: 2026-10-31\n---\n#### 我的原汇总\n手写内容\n\n#### 今日新记\n保留查询\n";
const marked = original + `\n${DIARY_START}\n旧快照\n${DIARY_END}\n我的补充\n`;
const calendars = [{ id: "a", name: "科研" }];
const row = (patch: Partial<TimelineRow> = {}): TimelineRow => ({ key: "one", title: "测试", calendarId: "a", start: +new Date("2026-10-31T09:00:00"), end: +new Date("2026-10-31T10:00:00"), ...patch });
function harness(text = marked, overrides: Partial<DiaryPorts> = {}) {
  let current = text, writes = 0, backups = 0, snapshots = 0;
  const ports: DiaryPorts = { read: async () => current, date: p => diaryDate(p, "2026-10-31"), layout: async () => DEFAULT_DIARY_LAYOUT,
    snapshot: async () => { snapshots++; return { rows: [row()], calendars }; },
    backup: async (_p, s) => { assert.equal(s, text); backups++; },
    process: async (_p, update) => { current = update(current); writes++; }, available: () => true, ...overrides };
  return { updater: new DiaryUpdater(ports), ports, text: () => current, set: (s: string) => { current = s; }, counts: () => ({ writes, backups, snapshots }) };
}
test("diary date is scoped to the exact folder and honors its explicit property", () => {
  assert.equal(diaryDate(file, undefined), "2026-10-31"); assert.equal(diaryDate(file, "2026-10-30"), "2026-10-30");
  for(const p of [file.replace("Daily/", "Daily-extra/"),"01-Research/2026年10月31日 星期六.md","00-Record/Calendar/Daily/README.md"]) assert.throws(() => diaryDate(p,"2026-10-31"));
  assert.throws(() => diaryDate(file,"2026-02-29")); assert.throws(() => diaryDate(file.replace("10月31", "02月30"),undefined));
  assert.equal(diaryDate(file.replace("2026年10月31", "2024年02月29"),undefined),"2024-02-29");
});
test("diary settings cannot escape the vault or target hidden configuration folders", () => {
  for(const p of ["../notes",".obsidian/plugins/a","D:/notes","/notes","foo//bar"]) assert.throws(() => diaryPath(p,"Daily"));
  assert.equal(diaryPath("日记\\每日/","Daily"),"日记/每日");
});
test("snapshot sorts all-day rows first, escapes note syntax and distinguishes work and sync state", () => {
  const out=renderDiary("2026-10-31",[row({title:"x|[link](url)\n<script>{{date}}",recordId:"work",pending:true}),row({key:"all",allDay:true})],calendars).markdown;
  assert.ok(out.indexOf("| 全天")<out.indexOf("09:00")); assert.ok(out.includes("实际工时 · 待同步")); assert.ok(out.includes("科研"));
  assert.ok(!out.includes("<script>")); assert.ok(!out.includes("[link](url)")); assert.ok(out.includes("\\|")); assert.ok(out.includes("&lt;script&gt;")); assert.ok(out.includes("\\{\\{date\\}\\}"));
});
test("cross-midnight rows clip to the diary's local date and exclusive midnight is respected", () => {
  const before=row({key:"before",start:+new Date("2026-10-30T23:00"),end:+new Date("2026-10-31T01:00")});
  const after=row({key:"after",start:+new Date("2026-10-31T23:00"),end:+new Date("2026-11-01T02:00")});
  const outside=row({start:+new Date("2026-10-30T23:00"),end:+new Date("2026-10-31T00:00")});
  const result=renderDiary("2026-10-31",[after,outside,before],calendars); assert.equal(result.count,2);assert.ok(result.markdown.includes("00:00–01:00（跨日）"));assert.ok(result.markdown.includes("23:00–24:00（跨日）"));
});
test("empty days are explicit and malformed layouts or event times stop generation", () => {
  assert.ok(renderDiary("2026-10-31",[],calendars).markdown.includes("暂无"));
  for(const layout of ["deleted placeholder","{{timeline}}{{timeline}}",DIARY_START+"{{timeline}}"]) assert.throws(()=>renderDiary("2026-10-31",[],calendars,layout));
  assert.throws(()=>renderDiary("2026-10-31",[row({end:NaN})],calendars));
});
test("update replaces only marked content and preserves everything else byte-for-byte", () => {
  assert.equal(replaceDiary(marked,"新快照"),marked.replace("旧快照\n","新快照\n"));
  const crlf="\uFEFF"+marked.replaceAll("\n","\r\n"); assert.equal(replaceDiary(crlf,"甲\n乙"),crlf.replace("旧快照\r\n","甲\r\n乙\r\n"));
});
test("first use inserts below YAML without removing old summaries or queries", () => {
  const result=replaceDiary(original,"新快照");assert.ok(result.startsWith("---\n日记日期: 2026-10-31\n---\n```calendar-task-timer-diary"));assert.ok(result.endsWith(original.slice(original.indexOf("####"))));
  assert.equal((replaceDiary(result,"再次更新").match(/```calendar-task-timer-diary/g)||[]).length,1);assert.throws(()=>replaceDiary("---\ninvalid YAML","new"));
});
test("broken, duplicate, inline and fenced markers fail closed", () => {
  for(const text of [DIARY_START,DIARY_END,`${DIARY_END}\n${DIARY_START}`,`${DIARY_START}\n${DIARY_START}\n${DIARY_END}`,`example ${DIARY_START}\n${DIARY_END}`,`\x60\x60\x60\n${DIARY_START}\n${DIARY_END}\n\x60\x60\x60`]) assert.throws(()=>replaceDiary(text,"new"));
  assert.equal(diaryRegion(original),null);
});
test("successful update backs up and stores a single snapshot", async () => {
  const h=harness();const result=await h.updater.update(file);assert.equal(result.count,1);assert.deepEqual(h.counts(),{writes:1,backups:1,snapshots:1});assert.ok(h.text().includes("我的补充"));
});
test("repeat clicks share one in-flight update", async () => {
  let resolve!:()=>void;const wait=new Promise<void>(r=>{resolve=r;});const h=harness(marked,{layout:async()=>{await wait;return DEFAULT_DIARY_LAYOUT;}});
  const a=h.updater.update(file),b=h.updater.update(file);assert.equal(a,b);resolve();await a;assert.equal(h.counts().writes,1);
});
test("source, template and backup failures never change the diary", async () => {
  for(const overrides of [{snapshot:async()=>{throw Error("unavailable");}},{layout:async()=>"invalid"},{backup:async()=>{throw Error("disk full");}}]){
    const h=harness(marked,overrides);await assert.rejects(h.updater.update(file));assert.equal(h.text(),marked);assert.equal(h.counts().writes,0);
  }
});
test("concurrent edits outside the generated area survive", async () => {
  const h=harness();h.ports.backup=async()=>{h.set(h.text()+"\n新想法");};await h.updater.update(file);assert.ok(h.text().endsWith("\n新想法"));
});
test("concurrent generated-area edits and diary date changes are rejected", async () => {
  const h=harness();h.ports.backup=async()=>h.set(h.text().replace("旧快照","用户修改"));await assert.rejects(h.updater.update(file),/已被修改/);assert.ok(h.text().includes("用户修改"));
  let date="2026-10-31";const changed=harness(marked,{date:()=>date,backup:async()=>{date="2026-10-30";}});await assert.rejects(changed.updater.update(file),/已被修改/);assert.equal(changed.text(),marked);
});
test("unloaded instances cannot commit a late diary update", async () => {
  let live=true;const h=harness(marked,{available:()=>live,backup:async()=>{live=false;}});await assert.rejects(h.updater.update(file),/卸载/);assert.equal(h.text(),marked);
});
