import type { Calendar } from "../../Shared/contracts";
import { el, button, options } from "./dom";

/** The title comes from the note; the only editable field is its calendar category. */
export function mountNoteTaskForm(root: HTMLElement, title: string, calendars: Calendar[], defaultCategory: string, existing: boolean, done: (category: string | null) => void) {
  const form=el(root,"form","ctt-dialog"),name=el(form,"div","ctt-field");el(name,"span","","待办名称");el(name,"strong","ctt-note-task-title",title);
  const label=el(form,"label","ctt-field");el(label,"span","","分类");const category=el(label,"select");category.setAttribute("aria-label","课题待办分类");category.required=true;
  options(category,calendars,calendars.some(c=>c.id===defaultCategory)?defaultCategory:"");
  el(form,"p","ctt-muted",existing?"保存分类后继续使用当前关联待办。":"按笔记标题创建待办，下次点击直接开始计时。");
  const controls=el(form,"div","ctt-dialog-controls");let settled=false;
  button(controls,"取消",()=>{if(!settled){settled=true;done(null);}});
  const save=el(controls,"button","ctt-primary",existing?"保存分类":"创建待办");save.type="submit";
  form.onsubmit=e=>{e.preventDefault();if(settled||!calendars.some(c=>c.id===category.value))return;settled=true;done(category.value);};
  return category;
}
