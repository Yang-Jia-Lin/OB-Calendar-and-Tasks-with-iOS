import { DiaryUpdater, diaryDate, DEFAULT_DIARY_LAYOUT, DIARY_START, DIARY_END } from "../Clients/Obsidian/diary";
import { mountDiaryButton } from "../Clients/Obsidian/diaryButton";
export function diaryFixture() {
  const state={text:`---\n日记日期: 2026-10-31\n---\n${DIARY_START}\n旧快照\n${DIARY_END}\n\n### 我的补充\n保留这段手写想法。\n\n### 今日新记／修改\n保留原有查询。`,fail:false,calls:0,backups:0};
  const root=document.createElement("section");root.id="ctt-diary-fixture";root.style.cssText="max-width:850px;margin:20px auto;padding:20px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px";
  const heading=document.createElement("h2");heading.textContent="日记时间轴 · 按钮预览";
  const controls=document.createElement("div"),content=document.createElement("pre");content.style.cssText="white-space:pre-wrap;overflow-wrap:anywhere";content.textContent=state.text;
  root.append(heading,controls,content);document.body.prepend(root);
  const updater=new DiaryUpdater({available:()=>true,read:async()=>state.text,date:p=>diaryDate(p,"2026-10-31"),layout:async()=>DEFAULT_DIARY_LAYOUT,
    snapshot:async()=>{state.calls++;await new Promise(r=>setTimeout(r,150));if(state.fail)throw Error("日历未连接，原内容已保留");return {calendars:[{id:"a",name:"科研"}],rows:[{key:"work",title:"视频感知优化",recordId:"one",calendarId:"a",start:+new Date("2026-10-31T09:00"),end:+new Date("2026-10-31T10:00")}]};},
    backup:async()=>{state.backups++;},process:async(_p,update)=>{state.text=update(state.text);content.textContent=state.text;}});
  const dispose=mountDiaryButton(controls,"00-Record/Calendar/Daily/2026年10月31日 星期六.md",p=>updater.update(p));
  return {state,dispose};
}
