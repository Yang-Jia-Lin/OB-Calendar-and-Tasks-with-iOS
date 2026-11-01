import { Setting } from "obsidian";
import { uid } from "../../Shared/contracts";
import { calendarSources, calendarPreferences, validUrl, type CalendarSource, type CalendarPreferences } from "../../Providers/Calendar/config";
import type { CalendarEngine } from "../../Providers/Calendar/engine";
import { calendarSecretKey, type CalendarMigrationHost } from "./calendarStorage";
import { el, button, field } from "./dom";
export interface CalendarSettingsHost extends CalendarMigrationHost {
 engine:CalendarEngine; setSources(sources:CalendarSource[]):Promise<void>; setCalendarPreferences(prefs:CalendarPreferences):Promise<void>;
 openCalendarForm(title:string,render:(root:HTMLElement,close:()=>void)=>void):void; calendarNotice(message:string):void;
}
export function renderCalendarSettings(root:HTMLElement,host:CalendarSettingsHost,redraw:()=>void) {
 const state=host.engine.state;
 new Setting(root).setName("独立日历与同步").setDesc(state.error|| (state.syncing?"正在同步…":"直接连接 CalDAV／ICS，不需要启用 FCR。密码保存于 Obsidian 安全存储。"))
  .addButton(b=>b.setButtonText("立即同步").onClick(()=>{void host.engine.refresh().then(redraw).catch(e=>host.calendarNotice((e as Error).message));}));
 const edit=(source?:CalendarSource)=>host.openCalendarForm(source?"编辑日历连接":"添加日历连接",(form,close)=>{
  const name=field(form,"名称","text",source?.name||""),url=field(form,"日历地址／服务器地址","url",source?.url||"");url.required=true;if(source)url.readOnly=true;
  const user=field(form,"账号","text",source?.username||""),password=field(form,"应用专用密码（留空保留原密码）","password","");password.autocomplete="new-password";
  const typeLabel=el(form,"label","ctt-field");el(typeLabel,"span","","连接类型");const type=el(typeLabel,"select");type.setAttribute("aria-label","连接类型");for(const [value,text]of [["caldav","CalDAV 日程"],["caldavtasks","CalDAV 待办"],["ics","ICS 只读订阅"]])el(type,"option","",text).value=value;type.value=source?.type||"caldav";type.disabled=!!source;
  const color=field(form,"颜色","color",source?.color||"#7e9bb4"),readonly=field(form,"只读","checkbox","");readonly.checked=!!source?.readOnly;
  const message=el(form,"div","ctt-dialog-error");message.setAttribute("role","alert");const results=el(form,"div","ctt-discovered-calendars");let discovered:{url:string;name:string;color:string;components:string[]}[]=[];
  const id=source?.id||`calendar-${uid()}`,key=source?.secretKey||calendarSecretKey(host,id);
  const secret=async()=>{if(type.value==="ics")return;if(!host.app.secretStorage?.setSecret)throw new Error("需要 Obsidian 安全凭据存储。");if(password.value)await host.app.secretStorage.setSecret(key,password.value);if(!await host.app.secretStorage.getSecret(key))throw new Error("请填写应用专用密码。");};
  const controls=el(form,"div","ctt-dialog-controls");let busy=false;
  const run=async(action:()=>Promise<void>)=>{if(busy)return;busy=true;message.textContent="";for(const b of controls.querySelectorAll("button"))b.disabled=true;try{await action();}catch(e){message.textContent=(e as Error).message;}finally{busy=false;for(const b of controls.querySelectorAll("button"))b.disabled=false;}};
  if(!source)button(controls,"发现日历",()=>{void run(async()=>{if(type.value==="ics")throw new Error("ICS 订阅请填写具体地址后直接保存。");validUrl(url.value);await secret();discovered=await host.engine.dav.discover(url.value,user.value,key);results.replaceChildren();for(const [index,c]of discovered.entries()){const label=el(results,"label","ctt-calendar-source"),check=el(label,"input");check.type="checkbox";check.value=String(index);check.checked=c.components.includes(type.value==="caldavtasks"?"VTODO":"VEVENT");el(label,"span","",c.name);}if(!discovered.length)message.textContent="没有发现可选日历；可填写具体日历地址后直接保存。";});});
  button(controls,"保存",()=>{void run(async()=>{const address=validUrl(url.value);await secret();const old=calendarSources(host.settings.calendarSources);let next:CalendarSource[];
    if(source)next=old.map(s=>s.id===source.id?{...s,name:name.value.trim()||s.name,color:color.value,username:user.value,readOnly:type.value==="ics"||readonly.checked}:s);
    else if(discovered.length){const selected=[...results.querySelectorAll<HTMLInputElement>("input:checked")].map(x=>discovered[Number(x.value)]);if(!selected.length)throw new Error("请至少选择一个日历。");next=[...old];for(const c of selected){if(next.some(s=>s.url===c.url&&s.type===type.value))continue;const nextId=`calendar-${uid()}`,nextKey=calendarSecretKey(host,nextId);await host.app.secretStorage.setSecret(nextKey,await host.app.secretStorage.getSecret(key));next.push({id:nextId,name:c.name,url:c.url,color:c.color,username:user.value,secretKey:nextKey,type:type.value as CalendarSource["type"],readOnly:readonly.checked,enabled:true});}}
    else {if(old.some(s=>s.url===address&&s.type===type.value))throw new Error("这个日历已经连接。");next=[...old,{id,name:name.value.trim()||"日历",url:address,username:user.value,secretKey:type.value==="ics"?"":key,type:type.value as CalendarSource["type"],color:color.value,readOnly:type.value==="ics"||readonly.checked,enabled:true}];}
    await host.setSources(next);close();redraw();
  });},"ctt-primary");button(controls,"取消",close);
 });
 for(const source of host.engine.sourceConfigs())new Setting(root).setName(source.name).setDesc(`${source.type==="ics"?"ICS 订阅":source.type==="caldavtasks"?"CalDAV 待办":"CalDAV 日程"}${source.readOnly?" · 只读":""}${state.failures[source.id]?` · ${state.failures[source.id]}`:""}`)
  .addToggle(t=>t.setValue(source.enabled!==false).onChange(enabled=>{void host.setSources(host.engine.sourceConfigs().map(s=>s.id===source.id?{...s,enabled}:s)).then(redraw).catch(e=>host.calendarNotice((e as Error).message));}))
  .addButton(b=>b.setButtonText("编辑").onClick(()=>edit(source)))
  .addButton(b=>b.setButtonText("移除连接").onClick(()=>host.openCalendarForm("移除日历连接",(form,close)=>{el(form,"p","",`仅移除“${source.name}”的连接，不删除云端日程；相关待同步记录仍保留。`);button(form,"确认移除",()=>{void host.setSources(host.engine.sourceConfigs().filter(s=>s.id!==source.id)).then(()=>{close();redraw();}).catch(e=>host.calendarNotice((e as Error).message));},"ctt-danger");button(form,"取消",close);})));
 new Setting(root).setName("添加连接").addButton(b=>b.setButtonText("添加 CalDAV／ICS").onClick(()=>edit()));
 const p=calendarPreferences(host.settings.calendarPreferences),save=(patch:Partial<CalendarPreferences>)=>{void host.setCalendarPreferences({...calendarPreferences(host.settings.calendarPreferences),...patch}).catch(e=>host.calendarNotice((e as Error).message));};
 new Setting(root).setName("默认日历视图").addDropdown(d=>d.addOptions({dayGridMonth:"月",timeGridWeek:"周",timeGridDay:"日",timeGrid3Days:"三日",listWeek:"列表"}).setValue(p.view).onChange(view=>save({view})));
 new Setting(root).setName("每周第一天").addDropdown(d=>d.addOptions({"0":"周日","1":"周一","6":"周六"}).setValue(String(p.firstDay)).onChange(value=>save({firstDay:Number(value)})));
 new Setting(root).setName("显示时区").addText(t=>t.setValue(p.timezone).setPlaceholder("Asia/Shanghai").onChange(timezone=>{try{new Intl.DateTimeFormat("en",{timeZone:timezone});save({timezone});}catch{}}));
 new Setting(root).setName("显示周末").addToggle(t=>t.setValue(p.weekends).onChange(weekends=>save({weekends})));
 new Setting(root).setName("显示全天区域").addToggle(t=>t.setValue(p.allDay).onChange(allDay=>save({allDay})));
 new Setting(root).setName("时段起点").addText(t=>t.setValue(p.slotMin).setPlaceholder("00:00").onChange(slotMin=>{if(/^\d{2}:\d{2}$/.test(slotMin))save({slotMin});}));
 new Setting(root).setName("时段终点").addText(t=>t.setValue(p.slotMax).setPlaceholder("24:00").onChange(slotMax=>{if(/^\d{2}:\d{2}$/.test(slotMax))save({slotMax});}));
 // Preserve the existing default category setting further down this settings tab.

}
