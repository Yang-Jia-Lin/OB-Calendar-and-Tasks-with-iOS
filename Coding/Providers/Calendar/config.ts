import type { Calendar } from "../../Shared/contracts";
export interface CalendarSource extends Calendar { type:"caldav"|"caldavtasks"|"ics"; url:string; username:string; secretKey:string; readOnly?:boolean; enabled?:boolean }
export interface CalendarPreferences { view:string; firstDay:number; timezone:string; slotMin:string; slotMax:string; weekends:boolean; allDay:boolean }
export const defaultCalendarPreferences:CalendarPreferences={view:"dayGridMonth",firstDay:1,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,slotMin:"00:00",slotMax:"24:00",weekends:true,allDay:true};
export function validUrl(value:string) { const u=new URL(value);if(u.username||u.password||!["https:","http:"].includes(u.protocol)||u.protocol==="http:"&&!["localhost","127.0.0.1","[::1]"].includes(u.hostname))throw new Error("请使用 HTTPS 日历地址，不要将密码写在地址中。");return u.href; }
export function resourceUrl(href:string,collection:string) { const u=new URL(href,collection),base=new URL(collection);if(u.origin!==base.origin)throw new Error("日历响应包含其他服务器地址，已停止请求。");return validUrl(u.href); }
export function calendarSources(value:unknown):CalendarSource[] {
 if(!Array.isArray(value))return [];const seen=new Set<string>();return value.map((x:any)=>{
  if(!x||typeof x.id!=="string"||!x.id||seen.has(x.id)||!["caldav","caldavtasks","ics"].includes(x.type)||typeof x.url!=="string")throw new Error("日历连接配置无效或来源 ID 重复。");seen.add(x.id);
  return {id:x.id,name:typeof x.name==="string"?x.name:x.id,type:x.type,url:validUrl(x.url),username:typeof x.username==="string"?x.username:"",secretKey:typeof x.secretKey==="string"?x.secretKey:"",color:typeof x.color==="string"?x.color:undefined,enabled:x.enabled!==false,readOnly:x.type==="ics"||x.readOnly===true};
 });
}
export function calendarPreferences(value:any):CalendarPreferences {
 const p={...defaultCalendarPreferences};if(!value||typeof value!=="object")return p;
 if(["dayGridMonth","timeGridWeek","timeGridDay","timeGrid3Days","listWeek"].includes(value.view))p.view=value.view;
 if(Number.isInteger(value.firstDay)&&value.firstDay>=0&&value.firstDay<=6)p.firstDay=value.firstDay;
 try{if(typeof value.timezone==="string"){new Intl.DateTimeFormat("en",{timeZone:value.timezone});p.timezone=value.timezone;}}catch{}
 for(const k of ["slotMin","slotMax"] as const)if(typeof value[k]==="string"&&/^(?:[01]\d|2[0-4]):[0-5]\d$/.test(value[k]))p[k]=value[k];
 for(const k of ["weekends","allDay"] as const)if(typeof value[k]==="boolean")p[k]=value[k];return p;
}
