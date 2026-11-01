import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diaryDate } from "../Clients/Obsidian/diary";
const source = readFileSync("Clients/Obsidian/DiaryAutoUpdate.templater.md", "utf8");
const execute = new (Object.getPrototypeOf(async function(){}).constructor)("tp", source.trim().slice(4, -2));
const diary = "00-Record/Calendar/Daily/2026年11月02日 星期一.md";
async function harness(plugin: unknown, path = diary) {
  const hooks: (() => Promise<void>)[] = [], notices: string[] = [];
  const host = { plugin };
  const tp = { app: { plugins: { getPlugin: (id: string) => { assert.equal(id,"calendar-task-timer"); return host.plugin; } } },
    file: { path: (relative: boolean) => { assert.equal(relative,true); return path; } },
    obsidian: { Notice: class { constructor(text: string) { notices.push(text); } } },
    hooks: { on_all_templates_executed: (callback: () => Promise<void>) => hooks.push(callback) } };
  await execute(tp);
  return { hooks, notices, host, tp };
}
test("automatic diary update waits for template completion and uses the created note path", async () => {
  const paths: string[] = [], h = await harness({ updateDiaryFromNote: async (p: string) => { paths.push(p); } });
  assert.equal(h.hooks.length,1); assert.deepEqual(paths,[]);
  h.tp.file.path = () => "Others/Home.components";
  await h.hooks[0](); assert.deepEqual(paths,[diary]); assert.deepEqual(h.notices,[]);
});
test("parallel or later repeated template-completion signals update only once", async () => {
  let calls=0, release!:()=>void; const pending=new Promise<void>(r=>{release=r;});
  const h=await harness({updateDiaryFromNote:async()=>{calls++;await pending;}});
  const first=h.hooks[0](); await h.hooks[0](); assert.equal(calls,1); release(); await first; await h.hooks[0](); assert.equal(calls,1);
});
test("a missing or old plugin reports a manual retry instead of breaking diary creation", async () => {
  for(const plugin of [null,{}]) { const h=await harness(plugin); await h.hooks[0](); assert.equal(h.notices.length,1); assert.match(h.notices[0],/日记已创建/); await h.hooks[0](); assert.equal(h.notices.length,1); }
});
test("unavailable calendars fail once and leave manual updating available", async () => {
  let calls=0;const h=await harness({updateDiaryFromNote:async()=>{calls++;throw Error("日历尚未加载");}});
  await h.hooks[0]();await h.hooks[0]();assert.equal(calls,1);assert.match(h.notices[0],/日历尚未加载/);assert.match(h.notices[0],/更新时间轴/);
});
test("the callback resolves the current plugin instance and shares its existing updater", async () => {
  let calls=0;const h=await harness(null);h.host.plugin={updateDiaryFromNote:async()=>{calls++;}};await h.hooks[0]();assert.equal(calls,1);
});
test("the existing host date guard still prevents updating other documents", async () => {
  let writes=0;const h=await harness({updateDiaryFromNote:async(p:string)=>{diaryDate(p,undefined);writes++;}},"01-Research/2026年11月02日 星期一.md");
  await h.hooks[0]();assert.equal(writes,0);assert.match(h.notices[0],/日记目录/);
});
