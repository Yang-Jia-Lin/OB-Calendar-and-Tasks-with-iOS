import ICAL from "ical.js";
import { Temporal } from "temporal-polyfill";
import { dateParts } from "../../Shared/time";
import type { CalendarEvent } from "../../Shared/contracts";
export interface CalendarResource { href:string; etag:string; data:string }
export interface ParsedResource { component:ICAL.Component; master:ICAL.Component; event:CalendarEvent; task:boolean }
export interface Occurrence { start:number; end:number; allDay:boolean; recurrenceId?:string; title:string }
const str=(v:unknown)=>v==null?"":String(v);
function registerZones(c:ICAL.Component) { for(const z of c.getAllSubcomponents("vtimezone")){const tzid=str(z.getFirstPropertyValue("tzid"));if(tzid)ICAL.TimezoneService.register(new ICAL.Timezone({component:z,tzid}));} }
export function readResource(resource:CalendarResource,task=false):ParsedResource|null {
 const c=new ICAL.Component(ICAL.parse(resource.data));if(c.name!=="vcalendar")throw new Error("日历资源不是 VCALENDAR。");registerZones(c);
 const components=c.getAllSubcomponents(task?"vtodo":"vevent"),master=components.find(x=>!x.hasProperty("recurrence-id")) || components[0];if(!master)return null;
 const start=master.getFirstPropertyValue(task?"dtstart":"dtstart") as ICAL.Time|null,due=master.getFirstPropertyValue(task?"due":"dtend") as ICAL.Time|null;
 const ev=task?null:new ICAL.Event(master),a=task?(due||start):start,b=task?due:ev?.endDate;
 const split=(t:ICAL.Time|null|undefined)=>{const s=t?.toString()||"";return {date:s.slice(0,10),time:s.includes("T")?s.slice(11,19):undefined};};
 const ap=split(a),bp=split(b),rrule=str(master.getFirstPropertyValue("rrule"));
 const timezone=String(master.getFirstProperty(task&&due?"due":"dtstart")?.getParameter("tzid") || (a?.zone===ICAL.Timezone.utcTimezone?"UTC":""));
 const event:CalendarEvent={type:rrule||master.hasProperty("rdate")?"recurring":"single",title:str(master.getFirstPropertyValue("summary")),uid:str(master.getFirstPropertyValue("uid")),date:ap.date,endDate:bp.date||ap.date,allDay:!!a?.isDate,timezone:timezone||undefined,isTask:task,caldavHref:resource.href,etag:resource.etag};
 if(!event.uid)throw new Error("日历资源缺少 UID，保留旧快照。");
 if(!event.allDay){event.startTime=ap.time;event.endTime=bp.time;}
 if(master.hasProperty("description"))event.description=str(master.getFirstPropertyValue("description"));
 if(master.hasProperty("location"))event.location=str(master.getFirstPropertyValue("location"));
 if(rrule)event.rrule=rrule;
 if(task){event.due=due?.toString()||"";if(str(master.getFirstPropertyValue("status"))==="COMPLETED"||master.hasProperty("completed"))event.completed=str(master.getFirstPropertyValue("completed"))||true;}
 return {component:c,master,event,task};
}
function millis(t:ICAL.Time,zone:string) {
 if(t.isDate)return +new Date(t.toString().slice(0,10)+"T00:00:00");
 if(t.zone===ICAL.Timezone.utcTimezone||t.zone?.component)return t.toJSDate().getTime();
 try{return Temporal.ZonedDateTime.from({year:t.year,month:t.month,day:t.day,hour:t.hour,minute:t.minute,second:t.second,timeZone:zone}).epochMilliseconds;}catch{throw new Error("日程时区无法解析，保留旧快照。");}
}
export function expandResource(parsed:ParsedResource,from:number,to:number,defaultZone:string):Occurrence[] {
 const zone=String(parsed.event.timezone||defaultZone),out:Occurrence[]=[];
 if(parsed.task){const due=(parsed.master.getFirstPropertyValue("due")||parsed.master.getFirstPropertyValue("dtstart")) as ICAL.Time|null;if(!due)return out;const base=(parsed.master.getFirstPropertyValue("dtstart")||due) as ICAL.Time,offset=due.subtractDate(base);let count=0;
  const push=(t:ICAL.Time)=>{const start=millis(t,zone);if(start<to&&start>=from)out.push({start,end:start+(t.isDate?86400000:3600000),allDay:t.isDate,title:parsed.event.title});return start;};
  if(parsed.master.hasProperty("rrule")||parsed.master.hasProperty("rdate")){const iter=new ICAL.RecurExpansion({component:parsed.master,dtstart:base});let t:ICAL.Time|null;while((t=iter.next())){if(++count>150000)throw new Error("周期待办展开量过大。");const value=t.clone();value.addDuration(offset);if(push(value)>=to)break;}}else push(due);return out;}
 const event=new ICAL.Event(parsed.master),push=(a:ICAL.Time,b:ICAL.Time,title:string,recurrenceId?:string)=>{const start=millis(a,zone),end=millis(b,zone);if(start<to&&Math.max(start,end-1)>=from)out.push({start,end:Math.max(start+1000,end),allDay:a.isDate,title,recurrenceId});};
 if(!event.isRecurring()){push(event.startDate,event.endDate,event.summary);return out;}
 const seen=new Set<string>();if(!parsed.master.hasProperty("rrule")&&!parsed.master.getAllProperties("exdate").some(p=>p.getValues().some(v=>String(v)===event.startDate.toString()))){push(event.startDate,event.endDate,event.summary,event.startDate.toString());seen.add(event.startDate.toString());}const iter=event.iterator();let next:ICAL.Time|null,index=0;
 while((next=iter.next())){if(++index>150000)throw new Error("周期规则展开量过大，请缩短查询范围。");if(millis(next,zone)>=to)break;const detail=event.getOccurrenceDetails(next);if(!seen.has(next.toString())&&String(detail.item.component.getFirstPropertyValue("status"))!=="CANCELLED")push(detail.startDate,detail.endDate,detail.item.summary,next.toString());seen.add(next.toString());}
 // A detached exception can move an occurrence from outside the requested range into it.
 for(const exception of parsed.component.getAllSubcomponents("vevent")){const id=exception.getFirstPropertyValue("recurrence-id") as ICAL.Time|null;if(!id||seen.has(id.toString())||String(exception.getFirstPropertyValue("status"))==="CANCELLED")continue;const item=new ICAL.Event(exception);push(item.startDate,item.endDate,item.summary,id.toString());}
 return out;
}
export function splitFeed(resource:CalendarResource):CalendarResource[]{const c=new ICAL.Component(ICAL.parse(resource.data));if(c.name!=="vcalendar")throw new Error("订阅不是 VCALENDAR。");const groups=new Map<string,ICAL.Component[]>();for(const item of [...c.getAllSubcomponents("vevent"),...c.getAllSubcomponents("vtodo")]){const id=str(item.getFirstPropertyValue("uid"));if(!id)throw new Error("订阅资源缺少 UID。");groups.set(id,[...(groups.get(id)||[]),item]);}if(groups.size<=1)return [resource];return [...groups].map(([id,items])=>{const copy=new ICAL.Component(ICAL.parse(resource.data));copy.removeAllSubcomponents("vevent");copy.removeAllSubcomponents("vtodo");for(const item of items)copy.addSubcomponent(new ICAL.Component(item.toJSON()));return {...resource,href:resource.href+"#"+encodeURIComponent(id),data:copy.toString()};});}
export function masterRange(parsed:ParsedResource,defaultZone:string) {if(parsed.task)return null;const event=new ICAL.Event(parsed.master),zone=String(parsed.event.timezone||defaultZone);return {start:millis(event.startDate,zone),end:millis(event.endDate,zone)};}
export function validateRule(value:string) { if(!value)return;const rule=ICAL.Recur.fromString(value);if(!rule.freq)throw new Error("周期规则缺少 FREQ。"); }
function timeValue(date:string,time:string|undefined,zone:string|undefined,allDay:boolean) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("请填写有效日期。");if(allDay)return ICAL.Time.fromDateString(date);
 const local=`${date}T${time||"00:00:00"}`;
 if(zone&&zone!=="UTC"){Temporal.ZonedDateTime.from(local+`[${zone}]`,{disambiguation:"reject"});return ICAL.Time.fromDateTimeString(local);}
 return ICAL.Time.fromDateTimeString(local+(zone==="UTC"?"Z":""));
}
export function writeResource(event:CalendarEvent,previous?:CalendarResource) {
 if(!event.uid||!event.title.trim())throw new Error("日程标题或 UID 无效。");validateRule(String(event.rrule||""));
 const task=event.isTask===true,c=previous?new ICAL.Component(ICAL.parse(previous.data)):new ICAL.Component(["vcalendar",[],[]]);
 if(!previous){c.updatePropertyWithValue("version","2.0");c.updatePropertyWithValue("prodid","-//Calendar Task Timer//Calendar//ZH");}
 const tag=task?"vtodo":"vevent",components=c.getAllSubcomponents(tag);let master=components.find(x=>!x.hasProperty("recurrence-id"));if(!master){master=new ICAL.Component(tag);c.addSubcomponent(master);}
 if(previous&&str(master.getFirstPropertyValue("uid"))!==event.uid)throw new Error("原资源 UID 已变化，停止写入。");
 master.updatePropertyWithValue("uid",event.uid);master.updatePropertyWithValue("summary",event.title.trim());master.updatePropertyWithValue("dtstamp",ICAL.Time.fromJSDate(new Date(),true));master.updatePropertyWithValue("sequence",Number(master.getFirstPropertyValue("sequence")||0)+1);
 const putTime=(name:string,date:string,time?:string)=>{master!.removeAllProperties(name);master!.updatePropertyWithValue(name,timeValue(date,time,event.timezone,!!event.allDay));if(!event.allDay&&event.timezone&&event.timezone!=="UTC")master!.getFirstProperty(name)!.setParameter("tzid",String(event.timezone));};
 if(task){if(event.date&&!previous)putTime("dtstart",event.date,event.startTime);if(event.due)putTime("due",event.date,event.startTime);else master.removeAllProperties("due");master.updatePropertyWithValue("status",event.completed?"COMPLETED":"NEEDS-ACTION");if(event.completed){if(!master.hasProperty("completed"))master.updatePropertyWithValue("completed",ICAL.Time.fromJSDate(new Date(),true));}else master.removeAllProperties("completed");}
 else {putTime("dtstart",event.date,event.startTime);putTime("dtend",event.endDate||event.date,event.endTime);master.removeAllProperties("duration");}
 if(Object.hasOwn(event,"rrule")){master.removeAllProperties("rrule");if(event.rrule)master.updatePropertyWithValue("rrule",ICAL.Recur.fromString(String(event.rrule)));}
 for(const name of ["description","location"] as const)if(Object.hasOwn(event,name)){if(event[name])master.updatePropertyWithValue(name,String(event[name]));else master.removeAllProperties(name);}
 return c.toString();
}
export function utcEvent(title:string,start:number,end:number):CalendarEvent {const a=dateParts(start,"UTC"),b=dateParts(end,"UTC");return {type:"single",title,date:a.date,endDate:b.date,startTime:a.time,endTime:b.time,timezone:"UTC",allDay:false,isTask:false};}
