import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationState, filterTasks, focusTasks, focusRefs, refKey, defaultFilters } from "../Shared/application";
import { parseTasks, parseCompletions, setTaskCompletionText, taskLine, updateTaskText, removeTaskText, restoreBoundTaskText, configureBoundTaskText } from "../Clients/Obsidian/tasks";
import { TimerController, validateJournal } from "../Shared/timer";
import { TimerApi } from "../Clients/Obsidian/api";
import type { Task } from "../Shared/contracts";
const path="tasks.md", text="# Tasks\r\n\r\n"+taskLine("原任务","2026-11-01","one","research").replaceAll("\n","\r\n")+"\r\n\r\n保留笔记正文。\r\n";
const task=()=>parseTasks(text,path)[0];
test("note configuration creates one stable task and category updates retain completion history",()=>{
 const ref={kind:"local" as const,path,id:"new-note"},seed={title:"端边云平台",calendarId:"research",due:""};
 const created=configureBoundTaskText(text,ref,seed),again=configureBoundTaskText(created,ref,seed);assert.equal(again,created);assert.equal(parseTasks(created,path).filter(t=>t.id===ref.id).length,1);
 assert.equal(created.replaceAll("\r\n","").includes("\n"),false);
 const done=setTaskCompletionText(created,parseTasks(created,path).find(t=>t.id===ref.id)!,true,1234,()=>"done");
 const changed=configureBoundTaskText(done,ref,{...seed,title:"ignored",calendarId:"work"}),task=parseTasks(changed,path).find(t=>t.id===ref.id)!;
 assert.equal(task.title,"端边云平台");assert.equal(task.calendarId,"work");assert.equal(task.completed,true);assert.equal(parseCompletions(changed).length,1);
});
test("deleting a task preserves notes, completion history and other stable tasks",()=>{
  const completed=setTaskCompletionText(text+taskLine("Other","","two","work")+"\r\n",task(),true,1234,()=>"done"),current=parseTasks(completed,path).find(t=>t.id==="one")!;
  const removed=removeTaskText(completed,current);assert.deepEqual(parseTasks(removed,path).map(t=>t.id),["two"]);assert.equal(parseCompletions(removed).length,1);assert.ok(removed.includes("保留笔记正文。"));
  assert.throws(()=>removeTaskText(completed,task()),/其他位置修改/);
});
test("a bound task is recreated by exact reference and repeated restoration is idempotent",()=>{
  const ref={kind:"local" as const,path,id:"one"},seed={title:"原任务",due:"2026-11-01",calendarId:"research"};
  const removed=removeTaskText(text,task()),restored=restoreBoundTaskText(removed,ref,seed);
  assert.equal(parseTasks(restored,path)[0].id,"one");assert.equal(parseTasks(restored,path)[0].title,"原任务");assert.equal(restoreBoundTaskText(restored,ref,seed),restored);
  assert.throws(()=>restoreBoundTaskText(removed,ref,seed,()=>{throw Error("readonly");}),/readonly/);
  assert.throws(()=>restoreBoundTaskText(text+taskLine("Duplicate","","one"),ref,seed),/重复/);
});
test("starting an already completed bound task reopens it without fabricating another completion",()=>{
  const completed=setTaskCompletionText(text,task(),true,1234,()=>"done"),ref={kind:"local" as const,path,id:"one"};
  const opened=restoreBoundTaskText(completed,ref,{title:"ignored",calendarId:"work"});assert.equal(parseTasks(opened,path)[0].completed,false);assert.equal(parseTasks(opened,path)[0].calendarId,"research");assert.equal(parseCompletions(opened).length,1);
});
test("completion flag and accurate event are produced by the same atomic text update",()=>{
  const updated=setTaskCompletionText(text,task(),true,1234,()=>"event-one");assert.equal(parseTasks(updated,path)[0].completed,true);const events=parseCompletions(updated);assert.equal(events.length,1);assert.deepEqual(events[0],{id:"event-one",task:{kind:"local",path,id:"one"},title:"原任务",calendarId:"research",completedAt:1234});assert.ok(updated.includes("保留笔记正文。\r\n"));assert.ok(!updated.replaceAll("\r\n","").includes("\n"));
});
test("completion retries do not change timestamps or duplicate events",()=>{const updated=setTaskCompletionText(text,task(),true,1000,()=>"a");assert.equal(setTaskCompletionText(updated,task(),true,9000,()=>"b"),updated);});
test("reopening preserves history and a later completion starts a new event",()=>{const a=setTaskCompletionText(text,task(),true,1000,()=>"a"),t=parseTasks(a,path)[0],b=setTaskCompletionText(a,t,false,2000);assert.equal(parseCompletions(b).length,1);const c=setTaskCompletionText(b,parseTasks(b,path)[0],true,3000,()=>"b");assert.deepEqual(parseCompletions(c).map(e=>e.completedAt),[1000,3000]);});
test("external completed checkboxes and old completed tasks do not acquire fabricated completion times",()=>{const external=text.replace('- [ ]','- [x]');assert.equal(setTaskCompletionText(external,task(),true,1000),external);assert.equal(parseCompletions(external).length,0);});
test("completion refuses concurrent title edits, duplicate task IDs and damaged metadata",()=>{const edited=updateTaskText(text,task(),{title:"用户修改"});assert.throws(()=>setTaskCompletionText(edited,task(),true),/其他位置修改/);assert.throws(()=>setTaskCompletionText(text+taskLine("duplicate","","one"),task(),true),/重复/);assert.throws(()=>setTaskCompletionText(text+'<!-- ctt-completions:bad -->',task(),true),/损坏/);});
test("ordinary task editing and category updates retain completion history",()=>{const a=setTaskCompletionText(text,task(),true,1000,()=>"a"),b=updateTaskText(a,parseTasks(a,path)[0],{title:"新标题",calendarId:"work"});assert.equal(parseCompletions(b)[0].title,"原任务");assert.equal(parseTasks(b,path)[0].title,"新标题");});
const tasks:Task[]=[task(),{...task(),id:"two",due:"2026-10-01"},{...task(),id:"three",due:"",completed:true},{...task(),id:"four",due:"",path:"other.md"}];
test("association, completion and deadline filters compose using stable task references",()=>{
  const f={...defaultFilters(),association:"linked" as const,due:"today" as const},linked=new Set([refKey(tasks[0])]);assert.deepEqual(filterTasks(tasks,f,linked,"2026-11-01").map(t=>t.id),["one"]);
  assert.deepEqual(filterTasks(tasks,{...f,association:"unlinked",due:"overdue"},linked,"2026-11-01").map(t=>t.id),["two"]);
  assert.deepEqual(filterTasks(tasks,{...f,association:"all",status:"done",due:"none"},linked).map(t=>t.id),["three"]);
  assert.deepEqual(filterTasks(tasks,{...f,due:"date",date:"2026-11-01"},linked).map(t=>t.id),["one"]);
  assert.deepEqual(filterTasks(tasks,{...f,status:"done",due:"date",date:"2026-11-01"},linked).map(t=>t.id),[]);
});
test("focus candidates prioritize pins, deduplicate today tasks and omit completed tasks",()=>{
  const refs=focusRefs([{kind:"local",id:"four",path:"other.md"},{kind:"local",id:"one",path},{kind:"local",id:"one",path},{kind:"local",id:"three",path}]);assert.equal(refs.length,3);assert.deepEqual(focusTasks(tasks,refs,5,"2026-11-01").map(t=>t.id),["four","one"]);assert.equal(focusTasks(tasks,refs,1,"2026-11-01").length,1);
});
test("application topics notify independently and isolate broken observers",()=>{
  const store=new ApplicationState({tasks:tasks,session:null as string|null});let a=0,b=0;store.subscribe("tasks",()=>{a++;});const unsubscribe=store.subscribe("session",()=>{b++;});store.subscribe("session",()=>{throw Error("bad observer");});store.set("session","one");store.set("tasks",tasks);assert.equal(a,0);assert.equal(b,1);unsubscribe();store.set("session","two");assert.equal(b,1);store.dispose();store.set("tasks",[]);assert.equal(a,0);
});
function timer(){let fullReads=0;const controller=new TimerController({ownerDeviceId:"device-one",persist:async()=>{},calendar:{assertWritable:()=>{}} as any,tasks:{complete:async()=>{}}});const api=new TimerApi({controller,resolve:async()=>task(),prepare:async t=>t,execute:fn=>fn(),refresh:async()=>{},state:()=>{fullReads++;return{available:true,active:controller.state.active,tasks,pending:0};}});return{api,controller,reads:()=>fullReads};}
test("lightweight timer notifications never clone or read the full task state",async()=>{const h=timer();await h.controller.start(task(),"research");let count=0;const off=h.api.subscribeTimer(state=>{count++;if(state.active)state.active.title="mutated";});for(let i=0;i<5;i++)h.api.notify();assert.equal(h.reads(),0);assert.equal(count,6);assert.equal(h.controller.state.active!.title,"原任务");off();h.api.notify();assert.equal(count,6);});
test("new sessions retain owner identity and old logs remain compatible",async()=>{const h=timer();await h.controller.start(task(),"research");assert.equal(h.controller.state.active!.ownerDeviceId,"device-one");const old=structuredClone(h.controller.state);delete old.active!.ownerDeviceId;assert.equal(validateJournal(old).active!.id,h.controller.state.active!.id);});
