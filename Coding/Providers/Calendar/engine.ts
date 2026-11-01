import { clone, type CalendarEvent, type Entry, type TimelineRow } from "../../Shared/contracts";
import { sameCalendarContent as sameEventContent } from "./content";
import type { CalendarApi } from "./bridge";
import { calendarSources, type CalendarSource } from "./config";
import { DavClient, type CalendarTransport } from "./dav";
import { splitFeed, expandResource, masterRange, readResource, writeResource, type CalendarResource, type ParsedResource } from "./ical";
export interface CalendarCache { version:1; sources:Record<string,{resources:CalendarResource[];syncedAt:number;authority?:string}> }
export interface CalendarSyncState { syncing:boolean; error:string; lastSync:number; failures:Record<string,string> }
type Stored={resource:CalendarResource;parsed:ParsedResource|null;entry:Entry};
export class CalendarEngine implements CalendarApi {
 private configs:CalendarSource[]=[];private data=new Map<string,Map<string,Stored>>();private synced=new Map<string,number>();private tails=new Map<string,Promise<unknown>>();private listeners=new Set<()=>void>();private flight?:Promise<void>;private stopped=false;private revision=0;private memo=new Map<string,TimelineRow[]>();
 migrationError="";readonly state:CalendarSyncState={syncing:false,error:"",lastSync:0,failures:{}};readonly dav:DavClient;
 constructor(private options:{transport:CalendarTransport;secret:(key:string)=>Promise<string|null>|string|null;persist:(cache:CalendarCache)=>Promise<void>;timezone:()=>string;open:()=>Promise<unknown>}) {this.dav=new DavClient(options.transport,options.secret);}
 configure(sources:CalendarSource[],cache?:CalendarCache) {
  const previous=this.configs;this.configs=calendarSources(sources);for(const s of this.configs){const old=previous.find(x=>x.id===s.id);if(old&&(old.url!==s.url||old.username!==s.username||old.type!==s.type)){this.data.delete(s.id);this.synced.delete(s.id);}}for(const [id,values]of [...this.data])if(!this.configs.some(s=>s.id===id)){this.data.delete(id);this.synced.delete(id);void values;}
  if(cache?.version===1)for(const source of this.configs){const saved=cache.sources?.[source.id];if(saved&&saved.authority===this.authority(source)){try{this.data.set(source.id,this.parse(source,saved.resources));this.synced.set(source.id,saved.syncedAt);}catch{this.state.failures[source.id]="本地日历快照损坏，等待重新同步";}}}
  this.changed();
 }
 async connect(){if(!this.configs.some(s=>s.enabled!==false))throw new Error("请先在插件设置中添加日历连接。");}
 getCalendarSources(){return this.configs.filter(s=>s.enabled!==false).map(({id,name,color,type})=>({id,name,color,type}));}
 getProviderCapabilities(id:string){const s=this.configs.find(s=>s.id===id);return {canCreate:!!s&&s.enabled!==false&&!s.readOnly,canEdit:!!s&&s.enabled!==false&&!s.readOnly,canDelete:!!s&&s.enabled!==false&&!s.readOnly};}
 sourceConfigs(){return clone(this.configs);}
 private source(id:string){this.live();const s=this.configs.find(s=>s.id===id&&s.enabled!==false);if(!s)throw new Error("分类日历已移除，请重新选择。");return s;}
 private authority(s:CalendarSource){return JSON.stringify([s.type,s.url,s.username]);}
 private current(s:CalendarSource){return this.configs.some(x=>x.id===s.id&&x.enabled!==false&&this.authority(x)===this.authority(s));}
 private live(){if(this.stopped)throw new Error("日历服务已停止。");}
 private parse(source:CalendarSource,resources:CalendarResource[]){const map=new Map<string,Stored>();for(const resource of (source.type==="ics"?resources.flatMap(splitFeed):resources)){const parsed=readResource(resource,source.type==="caldavtasks"),id=`${source.id}:${encodeURIComponent(resource.href)}`;map.set(resource.href,{resource:clone(resource),parsed,entry:{id,calendarId:source.id,color:source.color,event:parsed?.event || {type:"single",title:"",date:""}}});}return map;}
 private changed(){this.revision++;this.memo.clear();this.state.lastSync=Math.max(0,...this.synced.values());this.state.error=[this.migrationError,...Object.entries(this.state.failures).filter(([id])=>this.configs.some(s=>s.id===id&&s.enabled!==false)).map(([id,error])=>`${this.configs.find(s=>s.id===id)?.name||"日历"}：${error}`)].filter(Boolean).join("；");for(const fn of this.listeners){try{fn();}catch{}}}
 subscribe(fn:()=>void){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
 private lock<T>(id:string,fn:()=>Promise<T>){const p=(this.tails.get(id)||Promise.resolve()).catch(()=>{}).then(()=>{this.live();return fn();});this.tails.set(id,p);return p;}
 private snapshot():CalendarCache{return {version:1,sources:Object.fromEntries([...this.data].map(([id,map])=>[id,{resources:[...map.values()].map(x=>x.resource),syncedAt:this.synced.get(id)||0,authority:this.authority(this.configs.find(s=>s.id===id)! )}]))};}
 private async publish(source:CalendarSource,values:Map<string,Stored>){this.live();if(!this.current(source))throw new Error("连接配置已变化，忽略旧同步结果。");const id=source.id;this.data.set(id,values);this.synced.set(id,Date.now());delete this.state.failures[id];await this.options.persist(this.snapshot());this.live();this.changed();}
 refresh(){if(this.flight)return this.flight;this.live();const p=(async()=>{this.state.syncing=true;this.changed();const queue=this.configs.filter(s=>s.enabled!==false);await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{let s:CalendarSource|undefined;while((s=queue.shift())){const source=s;try{await this.lock(source.id,async()=>{
   if(source.type==="ics"){const r=await this.options.transport({url:source.url,method:"GET",headers:{}});if(r.status<200||r.status>=300)throw new Error(`HTTP ${r.status}：订阅日历读取失败`);await this.publish(source,this.parse(source,[{href:source.url,etag:r.headers.etag||"",data:r.text}]));return;}
   const index=await this.dav.index(source),old=this.data.get(source.id)||new Map<string,Stored>(),next=new Map<string,Stored>(),changed=index.filter(x=>old.get(x.href)?.resource.etag!==x.etag);
   for(const x of index){const value=old.get(x.href);if(value&&value.resource.etag===x.etag)next.set(x.href,value);}
   for(let offset=0;offset<changed.length;offset+=50){const batch=changed.slice(offset,offset+50),objects=await this.dav.objects(source,batch.map(x=>x.href));if(objects.length!==batch.length||batch.some(x=>!objects.some(o=>o.href===x.href)))throw new Error("网络返回的日历资源不完整，保留旧快照。");for(const [href,value]of this.parse(source,objects))next.set(href,value);}
   await this.publish(source,next);
  });}catch(e){if(!this.stopped&&this.current(source)){this.state.failures[source.id]=(e as Error).message;this.changed();}}}}));if(!this.stopped){this.state.syncing=false;this.changed();}})();this.flight=p;void p.finally(()=>{if(this.flight===p)this.flight=undefined;}).catch(()=>{});return p;}
 revalidateRemoteCalendars(_force:boolean){void this.refresh().catch(()=>{});}
 getAllEvents(){return this.getCalendarSources().filter(s=>this.data.has(s.id)).map(s=>({id:s.id,color:s.color,events:[...this.data.get(s.id)!.values()].filter(x=>x.parsed).map(x=>({id:x.entry.id,event:clone(x.entry.event)}))}));}
 rows(from:number,to:number):TimelineRow[]{const key=`${this.revision}:${from}:${to}`;const cached=this.memo.get(key);if(cached)return cached;const out:TimelineRow[]=[];for(const source of this.getCalendarSources())for(const value of this.data.get(source.id)?.values()||[]){if(!value.parsed)continue;for(const occurrence of expandResource(value.parsed,from,to,this.options.timezone()))out.push({key:`${value.entry.id}:${occurrence.recurrenceId||"single"}`,title:occurrence.title,calendarId:source.id,color:source.color,start:occurrence.start,end:occurrence.end,allDay:occurrence.allDay,original:clone(value.entry),unsupported:false,...(occurrence.recurrenceId?{recurrenceId:occurrence.recurrenceId,seriesStart:masterRange(value.parsed,this.options.timezone())!.start,seriesEnd:masterRange(value.parsed,this.options.timezone())!.end}: {})});}out.sort((a,b)=>a.start-b.start||a.key.localeCompare(b.key));if(this.memo.size>=20)this.memo.delete(this.memo.keys().next().value!);this.memo.set(key,out);return out;}
 timeline(date:string){const start=+new Date(date+"T00:00:00"),end=new Date(start);end.setDate(end.getDate()+1);return this.rows(start,+end).filter(r=>!r.original?.event.isTask&&r.original?.event.completed==null);}
 getEvents(criteria:any={},_sorts:unknown[]=[]){const from=Number(criteria.start)||+new Date(new Date().getFullYear()-1,0,1),to=Number(criteria.end)||+new Date(new Date().getFullYear()+2,0,1);return this.rows(from,to).map(r=>({id:r.original!.id,startMillis:r.start,endMillis:r.end,allDay:r.allDay,isTask:r.original?.event.isTask}));}
 private findEntry(id:string){for(const [calendarId,values]of this.data)for(const stored of values.values())if(stored.entry.id===id)return {calendarId,stored};throw new Error("原日程不存在，请同步后重新打开。");}
 private assertWrite(source:CalendarSource){if(source.readOnly||source.type==="ics")throw new Error("此日历只读。");if(!this.data.has(source.id))throw new Error("日历缓存尚未就绪，请等待后台同步。");}
 private async get(source:CalendarSource,href:string){const r=await this.dav.request(source,"GET",href);return {href,etag:r.headers.etag||"",data:r.text};}
 private async saveResource(source:CalendarSource,resource:CalendarResource){const values=new Map(this.data.get(source.id)||[]);for(const [href,value]of this.parse(source,[resource]))values.set(href,value);await this.publish(source,values);}
 async createEvent(id:string,event:CalendarEvent){return this.lock(id,async()=>{const s=this.source(id);this.assertWrite(s);const existing=[...(this.data.get(id)?.values()||[])].filter(x=>x.parsed?.event.uid===event.uid);if(existing.length>1)throw new Error("同 UID 日程重复，请先核对。");if(existing.length){if(!sameEventContent(existing[0].entry.event,event))throw new Error("同 UID 日程已在外部修改。");return true;}
  const href=new URL(encodeURIComponent(event.uid!)+".ics",s.url.endsWith("/")?s.url:s.url+"/").href;
  try{await this.dav.request(s,"PUT",href,writeResource(event,[...this.data.values()].flatMap(x=>[...x.values()]).find(x=>x.parsed?.event.uid===event.uid)?.resource),{"Content-Type":"text/calendar; charset=utf-8","If-None-Match":"*"});}catch(e){if((e as any).status!==412)throw e;const found=await this.get(s,href),parsed=readResource(found,s.type==="caldavtasks");if(!parsed||!sameEventContent(parsed.event,event))throw new Error("同 UID 资源已存在且内容不同，停止创建。");await this.saveResource(s,found);return true;}
  const saved=await this.get(s,href);await this.saveResource(s,saved);return true;
 });}
 async updateEvent(id:string,event:CalendarEvent){const found=this.findEntry(id);return this.lock(found.calendarId,async()=>{const s=this.source(found.calendarId);this.assertWrite(s);const current=await this.get(s,found.stored.resource.href),parsed=readResource(current,s.type==="caldavtasks");if(parsed&&sameEventContent(parsed.event,event)){await this.saveResource(s,current);return true;}if(!parsed||!sameEventContent(parsed.event,found.stored.entry.event))throw new Error("日程已在外部修改，请同步后核对。");if(!current.etag)throw new Error("日历资源缺少 ETag，无法安全修改。");
  await this.dav.request(s,"PUT",current.href,writeResource(event,current),{"Content-Type":"text/calendar; charset=utf-8","If-Match":current.etag});await this.saveResource(s,await this.get(s,current.href));return true;
 });}
 async deleteEvent(id:string){const found=this.findEntry(id);return this.lock(found.calendarId,async()=>{const s=this.source(found.calendarId);this.assertWrite(s);let current:CalendarResource;
  try{current=await this.get(s,found.stored.resource.href);}catch(e){if(![404,410].includes((e as any).status))throw e;const values=new Map(this.data.get(s.id));values.delete(found.stored.resource.href);await this.publish(s,values);return;}
  const parsed=readResource(current,s.type==="caldavtasks");if(!parsed||!sameEventContent(parsed.event,found.stored.entry.event))throw new Error("日程已在外部修改，停止删除。");if(!current.etag)throw new Error("缺少 ETag，无法安全删除。");
  await this.dav.request(s,"DELETE",current.href,undefined,{"If-Match":current.etag});
  try{await this.get(s,current.href);throw new Error("日历删除结果未确认，请重试。");}catch(e){if(![404,410].includes((e as any).status))throw e;}
  const values=new Map(this.data.get(s.id));values.delete(current.href);await this.publish(s,values);
 });}
 openCalendar(){return this.options.open();}
 stop(){this.stopped=true;this.listeners.clear();}
}
