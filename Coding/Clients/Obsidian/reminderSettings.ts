import { Setting } from "obsidian";
import type { Calendar } from "../../Shared/contracts";
import type { ReminderSettings, RemindersProvider } from "../../Providers/Reminders/provider";
import { el, button, field } from "./dom";
export interface ReminderSettingsHost {
 reminders:RemindersProvider;settings:{reminders?:ReminderSettings;defaultCalendarId:string};
 reminderPreferences():ReminderSettings;saveReminderPreferences(next:ReminderSettings):Promise<void>;
 connectReminders(args?:any):Promise<{needsCode?:boolean}>;confirmReminderCode(code:string):Promise<void>;
 openCalendarForm(title:string,render:(root:HTMLElement,close:()=>void)=>void):void;calendarNotice(message:string):void;
 openReminderMigration():void;reminderCalendars():Calendar[];
}
export function renderReminderSettings(root:HTMLElement,host:ReminderSettingsHost,redraw:()=>void){
 const provider=host.reminders,prefs=host.reminderPreferences();
 new Setting(root).setName("iCloud 提醒事项").setDesc(provider.error||(provider.syncing?"正在同步提醒事项…":provider.enabled?"已连接；待办列表与工时日历分别设置。":"连接后使用真正的 iCloud 提醒事项；首次准备后台环境需要 Python 3.13。"))
 .addButton(b=>b.setButtonText("连接／重新登录").onClick(()=>host.openCalendarForm("连接 iCloud 提醒事项",(form,close)=>{
   el(form,"p","ctt-muted","优先尝试已有可信会话。需要登录时填写 Apple 账户密码；它与日历的应用专用密码不同。登录信息只交给本机组件，不写入插件设置。");
   const user=field(form,"Apple 账户（已有会话可留空）","text",""),password=field(form,"Apple 账户密码","password",""),china=field(form,"中国大陆账户","checkbox","");china.checked=true;
   const details=el(form,"details");el(details,"summary","","导入之前已验证的会话（可选）");const imported=field(details,"原测试 .private 目录","text","");
   const code=field(form,"设备验证码","password","");code.parentElement!.hidden=true;const error=el(form,"p","ctt-dialog-error");let needsCode=false,busy=false;
   const connect=button(form,"连接",()=>{if(busy)return;busy=true;connect.disabled=true;error.textContent="正在连接；首次准备环境可能需要几分钟…";void(async()=>{try{if(needsCode){await host.confirmReminderCode(code.value);code.value="";close();redraw();return;}const args={username:user.value.trim()||undefined,password:password.value||undefined,china:china.checked,importDir:imported.value.trim()||undefined};password.value="";const result=await host.connectReminders(args);args.password=undefined;if(result.needsCode){needsCode=true;code.parentElement!.hidden=false;connect.textContent="验证并连接";error.textContent="请在 Apple 设备确认后输入验证码。";code.focus();}else{close();redraw();}}catch(e){error.textContent=(e as Error).message;}finally{busy=false;connect.disabled=false;}})();},"ctt-primary");button(form,"关闭",close);
 })))
 .addButton(b=>b.setButtonText("立即同步").setDisabled(!provider.enabled).onClick(()=>{void provider.refresh().then(redraw).catch(e=>host.calendarNotice((e as Error).message));}));
 const save=(patch:Partial<ReminderSettings>)=>host.saveReminderPreferences({...host.reminderPreferences(),...patch}).then(redraw).catch(e=>host.calendarNotice((e as Error).message));
 if(prefs.accountId)new Setting(root).setName("启用提醒事项来源").setDesc("关闭仅隐藏此来源并暂停其同步，保留队列和绑定。").addToggle(t=>t.setValue(prefs.enabled).onChange(enabled=>{void save({enabled});}));
 new Setting(root).setName("默认待办列表").setDesc("在“全部”分类及新课题中默认使用；选中具体列表时使用该列表。").addDropdown(d=>{d.addOption("","选择列表");for(const list of provider.data.lists)d.addOption(list.id,list.name);d.setValue(prefs.defaultListId).onChange(defaultListId=>{void save({defaultListId});});});
 new Setting(root).setName("待办列表 → 工时日历").setDesc("未设置时使用默认工时日历；更改仅影响新会话，同一日历可对应多个列表。");
 for(const list of provider.data.lists)new Setting(root).setName(list.name).addDropdown(d=>{d.addOption("","使用默认工时日历");for(const c of host.reminderCalendars())d.addOption(c.id,c.name);const target=prefs.calendarMap[list.id];if(target&&!host.reminderCalendars().some(c=>c.id===target))d.addOption(target,"原对应日历不可用，请重新选择");d.setValue(target||"").onChange(id=>{void save({calendarMap:{...host.reminderPreferences().calendarMap,[list.id]:id}});});});
 new Setting(root).setName("迁移本地待办").setDesc("先预览并选择任务和目标列表，确认云端保存后更新课题绑定；原文件和历史工时保留。").addButton(b=>b.setButtonText("选择迁移").setDisabled(!provider.enabled).onClick(()=>host.openReminderMigration()));
}
