import type { App } from "obsidian";
import { MarkdownTasks } from "./tasks";
import { refKey, type TaskRef, type TaskCompletion } from "../../Shared/application";
import type { Task } from "../../Shared/contracts";
import { RemindersProvider, reminderRef, type ReminderSettings } from "../../Providers/Reminders/provider";
/** Local Markdown remains readable; confirmed migrations are redirected exactly once. */
export class TaskHub extends MarkdownTasks {
 constructor(app:App,taskPath:()=>string,readonly reminders:RemindersProvider,private settings:()=>ReminderSettings){super(app,taskPath);}
 override async list(){const local=await super.list();const all=[...local.filter(t=>!this.reminders.data.aliases[refKey(t)]),...this.reminders.list()];const rank=(id:string)=>{const n=this.reminders.data.order.indexOf(id);return n<0?Infinity:n;};return all.sort((a,b)=>rank(a.id)-rank(b.id));}
 override async resolve(ref:TaskRef){const target=this.reminders.data.aliases[refKey(ref)];if(target)return this.reminders.resolve(target);return ref.kind==="reminder"?this.reminders.resolve(ref):super.resolve(ref);}
 override async add(title:string,due:string,category:string){if(this.reminders.enabled){await this.reminders.create(title,category,{due});return;}await super.add(title,due,category);}
 override async update(task:Task,patch:Partial<Task>,check=true){if(task.kind==="reminder"){await this.reminders.update(task,patch);return;}await super.update(task,patch,check);}
 override async setCompleted(task:Task,completed:boolean){if(task.kind==="reminder"){await this.reminders.update(task,{completed});return;}await super.setCompleted(task,completed);}
 override async remove(task:Task){if(task.kind==="reminder"){await this.reminders.remove(task);return;}await super.remove(task);}
 override async completions():Promise<TaskCompletion[]>{return [...await super.completions(),...this.reminders.list().filter(t=>t.completed&&t.completedAt!=null).map(t=>({id:`native:${t.id}:${t.completedAt}`,task:reminderRef(t),title:t.title,calendarId:t.calendarId||"",completedAt:t.completedAt!}))];}
 override async restoreBound(ref:TaskRef,seed:{title:string;due?:string;calendarId?:string;listId?:string},validate:(task:Task)=>void){const target=this.reminders.data.aliases[refKey(ref)]||ref;if(target.kind!=="reminder")return super.restoreBound(ref,seed,validate);const task=await this.reminders.restore(target,seed);validate(task);return task;}
 override async configureBound(ref:TaskRef,seed:{title:string;due?:string;calendarId?:string;listId?:string}){if(ref.kind!=="reminder")return super.configureBound(ref,seed);try{const current=this.reminders.resolve(ref);if(seed.listId&&current.listId!==seed.listId)throw new Error("本版不支持移动原生任务到其他列表，请在提醒事项中操作。");return current;}catch(e){if(this.reminders.data.items.some(t=>t.id===ref.id)||this.reminders.data.operations.some(o=>o.task.id===ref.id))throw e;await this.reminders.create(seed.title,seed.listId||this.settings().defaultListId,{due:seed.due},undefined,ref.id);return this.reminders.resolve(ref);}}
 override async reorder(next:string[],expected:string[]){if(this.reminders.enabled){await this.reminders.reorder(next,expected,await this.list());return;}await super.reorder(next,expected);}
}
