import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { requestUrl } from "obsidian";
import { CalendarEngine, type CalendarCache } from "../../Providers/Calendar/engine";
import { calendarSources, calendarPreferences, type CalendarSource, type CalendarPreferences } from "../../Providers/Calendar/config";
import type { CalendarTransport } from "../../Providers/Calendar/dav";
export const obsidianCalendarTransport:CalendarTransport=async request=>{
 try{const r=await requestUrl({url:request.url,method:request.method,headers:request.headers,body:request.body,throw:false});return {status:r.status,text:r.text,headers:Object.fromEntries(Object.entries(r.headers).map(([k,v])=>[k.toLowerCase(),v]))};}
 catch{throw new Error("日历网络请求失败，请检查网络后重试。");}
};
const cacheWriters:Map<string,{owner:symbol;tail:Promise<unknown>}>=((globalThis as any)[Symbol.for("ctt.calendar.cache.writers")]??=new Map());
export class CalendarCacheFile {
 private stopped=false;private slot:{owner:symbol;tail:Promise<unknown>};private owner=Symbol();
 constructor(private file:string){const previous=cacheWriters.get(file);this.slot={owner:this.owner,tail:previous?.tail||Promise.resolve()};cacheWriters.set(file,this.slot);}
 private live(){return !this.stopped&&cacheWriters.get(this.file)===this.slot;}
 async load():Promise<CalendarCache|undefined>{await this.slot.tail.catch(()=>{});try{const data=JSON.parse(await fs.readFile(this.file,"utf8"));if(data.version!==1||!data.sources)throw Error();return data;}catch{return undefined;}}
 save(cache:CalendarCache){const data=JSON.stringify(cache);const p=this.slot.tail.catch(()=>{}).then(async()=>{if(!this.live())return;await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+"."+randomUUID()+".tmp";try{await fs.writeFile(temp,data,"utf8");if(this.live())await fs.rename(temp,this.file);}finally{await fs.rm(temp,{force:true});}});this.slot.tail=p;return p;}
 stop(){this.stopped=true;}
}
export interface CalendarMigrationHost { settings:{calendarSources?:CalendarSource[];calendarPreferences?:CalendarPreferences;calendarMigration?:string}; app:any; saveSettings():Promise<void>; manifest:{dir?:string} }
export function calendarSecretKey(host:CalendarMigrationHost,id:string){const vault=host.app.vault.adapter.getBasePath?.()||host.app.vault.getName?.()||host.app.vault.configDir;return `ctt-caldav-${createHash("sha256").update(vault).digest("hex").slice(0,12)}-${id.toLowerCase().replace(/[^a-z0-9]/g,"-")}`;}
/** One-time configuration import. Never calls the old plugin or copies credentials to JSON. */
export async function migrateCalendarSettings(host:CalendarMigrationHost) {
 if(host.settings.calendarSources?.length||host.settings.calendarMigration)return false;
 const adapter=host.app.vault.adapter,configDir=host.app.vault.configDir,legacy=`${configDir}/plugins/full-calendar-remastered/data.json`;
 if(!await adapter.exists(legacy))return false;
 const old=JSON.parse(await adapter.read(legacy)),selected=(old.calendarSources||[]).filter((x:any)=>["caldav","caldavtasks","ical","ics"].includes(x.type));
 if((old.calendarSources||[]).length!==selected.length)throw new Error("原配置含暂不支持的来源，请保留 FCR 并在独立日历设置中添加连接。");
 if(!selected.length)return false;
 const secrets=host.app.secretStorage;if(!secrets?.getSecret||!secrets?.setSecret)throw new Error("迁移需要 Obsidian 的安全凭据存储，请升级并启用安全存储。");
 const sources:CalendarSource[]=[];
 for(const source of selected){const isIcs=["ical","ics"].includes(source.type),secretKey=calendarSecretKey(host,source.id);
  if(!isIcs){const oldKey=`fcr-caldav-pwd-${source.id.toLowerCase().replace(/[^a-z0-9]/g,"-")}`,password=await secrets.getSecret(oldKey)||source.password;
   if(!password)throw new Error(`“${source.name||source.id}”缺少连接密码，请在日历设置中补充。`);await secrets.setSecret(secretKey,password);
   if(await secrets.getSecret(secretKey)!==password)throw new Error("日历凭据迁移未能确认，保留原配置。");}
  sources.push({id:source.id,name:source.name||source.id,color:source.color,type:isIcs?"ics":source.type,url:source.homeUrl||source.url,username:source.username||"",secretKey:isIcs?"":secretKey,readOnly:isIcs,enabled:true});
 }
 const next=calendarSources(sources),prefs=calendarPreferences({view:old.initialView?.desktop,firstDay:old.firstDay,timezone:old.displayTimezone,slotMin:old.slotMinTime,slotMax:old.slotMaxTime,allDay:old.allDaySlot,weekends:old.weekends});
 const before={sources:host.settings.calendarSources,prefs:host.settings.calendarPreferences,marker:host.settings.calendarMigration};
 host.settings.calendarSources=next;host.settings.calendarPreferences=prefs;host.settings.calendarMigration="fcr-v1";
 try{await host.saveSettings();}catch(e){host.settings.calendarSources=before.sources;host.settings.calendarPreferences=before.prefs;host.settings.calendarMigration=before.marker;throw e;}return true;
}
export async function setupCalendarEngine(host:CalendarMigrationHost,pluginDir:string,changed:()=>void,open:()=>Promise<unknown>) {
 let migrationError="";try{await migrateCalendarSettings(host);}catch(e){migrationError=(e as Error).message;}const store=new CalendarCacheFile(path.join(pluginDir,"calendar-cache.json"));
 const engine=new CalendarEngine({transport:obsidianCalendarTransport,secret:key=>host.app.secretStorage?.getSecret?.(key)||null,persist:cache=>store.save(cache),timezone:()=>host.settings.calendarPreferences?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,open});
 engine.configure(calendarSources(host.settings.calendarSources),await store.load());if(migrationError)engine.migrationError=migrationError;engine.subscribe(changed);return {engine,store};
}
