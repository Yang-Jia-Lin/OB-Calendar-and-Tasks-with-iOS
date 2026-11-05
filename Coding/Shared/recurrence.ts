import { Temporal } from "temporal-polyfill";
import type { Task } from "./contracts";
export interface TaskRepeat { frequency:"daily"|"weekly"|"monthly"; interval:number; weekdays?:number[]; zone:string; ruleId?:string; revision?:string }
export function validateRepeat(r:TaskRepeat|null|undefined,task:Pick<Task,"due"|"dueInstant"|"dueZone">){
 if(!r)return;
 if(!task.due)throw Error("重复任务需要截止日期作为本轮日期。");
 Temporal.PlainDate.from(task.due);Temporal.Now.zonedDateTimeISO(r.zone);
 if(!["daily","weekly","monthly"].includes(r.frequency)||!Number.isInteger(r.interval)||r.interval<1||r.interval>365)throw Error("重复间隔需为1～365。");
 if(r.frequency==="weekly"&&(!r.weekdays?.length||new Set(r.weekdays).size!==r.weekdays.length||r.weekdays.some(n=>!Number.isInteger(n)||n<1||n>7)))throw Error("请选择重复的星期。");
 if(r.frequency!=="weekly"&&r.weekdays?.length)throw Error("此重复规则不支持星期条件。");
 if(task.dueInstant!=null&&r.zone!==task.dueZone)throw Error("重复与截止时间必须使用同一时区。");
}
export const occurrenceKey=(t:Task)=>JSON.stringify([t.due||"",t.dueInstant??null,t.repeat?{...t.repeat,revision:undefined}:null]);
/** The overdue occurrence remains until explicit completion. Only future slots are selected. */
export function nextOccurrence(task:Task,completedAt:number):Pick<Task,"due"|"dueInstant"|"dueZone">{
 const r=task.repeat;if(!r)throw Error("没有重复规则。");validateRepeat(r,task);
 const anchor=Temporal.PlainDate.from(task.due!),now=Temporal.Instant.fromEpochMilliseconds(completedAt).toZonedDateTimeISO(r.zone),today=now.toPlainDate();
 const clock=task.dueInstant==null?undefined:Temporal.Instant.fromEpochMilliseconds(task.dueInstant).toZonedDateTimeISO(r.zone).toPlainTime();
 // Start near today; never walk through years of missed daily occurrences.
 const start=Temporal.PlainDate.compare(today,anchor)>0?today:anchor;
 for(let i=0;i<366*40;i++){
  const date=start.add({days:i});if(Temporal.PlainDate.compare(date,anchor)<=0)continue;
  const days=anchor.until(date,{largestUnit:"days"}).days,months=(date.year-anchor.year)*12+date.month-anchor.month;
  const weekAnchor=anchor.subtract({days:anchor.dayOfWeek-1});
  const valid=r.frequency==="daily"?days%r.interval===0:r.frequency==="monthly"?months%r.interval===0&&date.day===anchor.day:Math.floor(weekAnchor.until(date,{largestUnit:"days"}).days/7)%r.interval===0&&r.weekdays!.includes(date.dayOfWeek);
  if(!valid)continue;
  if(!clock){if(Temporal.PlainDate.compare(date,today)>0)return{due:date.toString(),dueInstant:null,dueZone:null};continue;}
  const zoned=date.toZonedDateTime({timeZone:r.zone,plainTime:clock});if(!zoned.toPlainTime().equals(clock))continue;
  const instant=zoned.epochMilliseconds;
  if(instant>completedAt)return{due:date.toString(),dueInstant:instant,dueZone:r.zone};
 }
 throw Error("无法计算下一个周期，请检查规则。");
}
export function repeatLabel(r:TaskRepeat|null|undefined){if(!r)return"";const n=r.interval===1?"":String(r.interval);return r.frequency==="daily"?`每${n}天`:r.frequency==="monthly"?`每${n}月`:`每${n}周 ${r.weekdays?.map(d=>["","一","二","三","四","五","六","日"][d]).join("、")}`;}
export function deadlineLabel(task:Task,now=Date.now(),localZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
 if(!task.due)return"";
 const zone=task.dueInstant==null?localZone:task.dueZone||"UTC",today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate().toString();
 const relative=task.due===today?"今天":Temporal.PlainDate.from(today).add({days:1}).toString()===task.due?"明天":task.due;
 const late=!task.completed&&(task.dueInstant!=null?task.dueInstant<now:task.due<today);
 const time=task.dueInstant!=null?Temporal.Instant.fromEpochMilliseconds(task.dueInstant).toZonedDateTimeISO(zone).toPlainTime().toString().slice(0,5):"";
 return `${late?"逾期 · ":""}${relative}${time?` ${time} (${zone})`:""}`;
}
