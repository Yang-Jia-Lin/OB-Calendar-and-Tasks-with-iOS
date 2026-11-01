import { Calendar as FullCalendar } from "fullcalendar";
import themePlugin from "fullcalendar/themes/monarch";
import dayGridPlugin from "fullcalendar/daygrid";
import timeGridPlugin from "fullcalendar/timegrid";
import listPlugin from "fullcalendar/list";
import interactionPlugin from "fullcalendar/interaction";
import zhCn from "fullcalendar/locales/zh-cn";
import { el, button } from "./dom";
import { dayKey, dateParts } from "../../Shared/time";
import type { Calendar, TimelineRow } from "../../Shared/contracts";
import type { CalendarPreferences } from "../../Providers/Calendar/config";
export interface CalendarPanelHost {
 preferences():CalendarPreferences; sources():Calendar[]; rows(from:number,to:number):TimelineRow[];
 state():{syncing:boolean;error:string;lastSync:number}; subscribe(fn:()=>void):()=>void;
 writable(id:string):boolean; create(start:number,end:number,allDay:boolean):void; edit(row:TimelineRow):void;
 move(row:TimelineRow,start:number,end:number,allDay:boolean):Promise<void>; notice(message:string):void;
}
/** Owned by this plugin; the calendar library is bundled locally and never contacts FCR. */
export class CalendarPanel {
 private calendar?:InstanceType<typeof FullCalendar>;private observer?:ResizeObserver;private unsubscribe?:()=>void;private status?:HTMLElement;private filters?:HTMLElement;private hidden=new Set<string>();private stopped=false;private sourcesKey="";private preferencesKey="";private eventSnapshot:any[]=[];private width=0;private dirty=true;
 constructor(private root:HTMLElement,private host:CalendarPanelHost){}
 activate(){if(this.stopped)return;if(this.calendar){const width=this.root.getBoundingClientRect().width;if(width&&width!==this.width){this.width=width;this.calendar.render();}if(this.dirty)this.refresh();return;}
  this.root.classList.add("ctt-owned-calendar");this.root.replaceChildren();
  const top=el(this.root,"div","ctt-calendar-tools");this.status=el(top,"div","ctt-muted");this.status.setAttribute("role","status");
  const menu=el(top,"details","ctt-calendar-sources");el(menu,"summary","ctt-filter-summary","日历分类");this.filters=el(menu,"div","ctt-calendar-source-options");button(top,"新建日程",()=>{const start=new Date();start.setMinutes(0,0,0);this.host.create(+start,+start+3600000,false);},"ctt-quiet");
  const body=el(this.root,"div","ctt-calendar-engine"),pref=this.host.preferences();
  this.calendar=new FullCalendar(body,{plugins:[themePlugin,dayGridPlugin,timeGridPlugin,listPlugin,interactionPlugin],locales:[zhCn],locale:"zh-cn",initialView:pref.view==="timeGridWeek"&&this.root.clientWidth<500?"timeGrid3Days":pref.view,views:{timeGrid3Days:{type:"timeGrid",duration:{days:3}}},firstDay:pref.firstDay,timeZone:pref.timezone,slotMinTime:pref.slotMin,slotMaxTime:pref.slotMax,weekends:pref.weekends,allDaySlot:pref.allDay,height:"auto",headerToolbar:{start:"prev,next today",center:"title",end:"dayGridMonth,timeGridWeek,timeGrid3Days,timeGridDay,listWeek"},buttons:{today:{text:"今天"},dayGridMonth:{text:"月"},timeGridWeek:{text:"周"},timeGridDay:{text:"日"},timeGrid3Days:{text:"三日"},listWeek:{text:"列表"}},datesSet:arg=>{body.dataset.view=arg.view.type;},dayCellDidMount:arg=>{arg.el.classList.add("ctt-calendar-day");},nowIndicator:true,editable:true,selectable:true,selectMinDistance:5,dayMaxEvents:true,
   events:(range,done)=>{try{const next=this.host.rows(+range.start,+range.end).filter(r=>!this.hidden.has(r.calendarId)&&!r.original?.event.completed).map(row=>({id:row.key,title:row.title,start:row.allDay?dayKey(row.start):new Date(row.start),end:row.allDay?dayKey(row.end):new Date(row.end),allDay:row.allDay,backgroundColor:row.color||this.host.sources().find(s=>s.id===row.calendarId)?.color,borderColor:row.color,editable:!row.pending&&this.host.writable(row.calendarId)&&row.original?.event.type!=="recurring"&&!row.original?.event.isTask,className:"ctt-calendar-event"+(row.pending?" ctt-calendar-pending":""),extendedProps:{row}}));this.eventSnapshot=next;done(next);}catch(e){this.host.notice((e as Error).message);done(this.eventSnapshot);}},
   dateClick:arg=>{const start=arg.allDay?+new Date(arg.dateStr.slice(0,10)+"T00:00:00"):+arg.date;this.host.create(start,start+(arg.allDay?86400000:3600000),arg.allDay);},select:arg=>{this.calendar?.unselect();this.host.create(arg.allDay?+new Date(arg.startStr.slice(0,10)+"T00:00:00"):+arg.start,arg.allDay?+new Date(arg.endStr.slice(0,10)+"T00:00:00"):+arg.end,arg.allDay);},eventClick:arg=>this.host.edit(arg.event.extendedProps.row as TimelineRow),
   eventDrop:arg=>{const row=arg.event.extendedProps.row as TimelineRow;const start=arg.event.allDay?+new Date(arg.event.startStr.slice(0,10)+"T00:00:00"):arg.event.start?.getTime(),end=arg.event.allDay?+new Date(arg.event.endStr.slice(0,10)+"T00:00:00"):arg.event.end?.getTime();arg.revert();if(start!=null&&end!=null)void this.host.move(row,start,end,arg.event.allDay).catch(e=>this.host.notice((e as Error).message));},
   eventResize:arg=>{const row=arg.event.extendedProps.row as TimelineRow;const start=arg.event.allDay?+new Date(arg.event.startStr.slice(0,10)+"T00:00:00"):arg.event.start?.getTime(),end=arg.event.allDay?+new Date(arg.event.endStr.slice(0,10)+"T00:00:00"):arg.event.end?.getTime();arg.revert();if(start!=null&&end!=null)void this.host.move(row,start,end,arg.event.allDay).catch(e=>this.host.notice((e as Error).message));}
  });this.calendar.render();this.unsubscribe=this.host.subscribe(()=>this.refresh());this.observer=new ResizeObserver(()=>{const width=this.root.getBoundingClientRect().width;if(width&&width!==this.width){this.width=width;this.calendar?.render();}});this.observer.observe(this.root);this.refresh();
 }
 refresh(){if(!this.calendar||this.stopped)return;if(this.root.hidden){this.dirty=true;return;}this.dirty=false;const state=this.host.state();this.status!.textContent=state.error|| (state.syncing?"正在同步日历…":state.lastSync?`上次同步 ${dateParts(state.lastSync).time.slice(0,5)}`:"日历尚未同步");
  const pref=this.host.preferences(),pk=JSON.stringify(pref);if(pk!==this.preferencesKey){const old=this.preferencesKey?JSON.parse(this.preferencesKey):pref;this.preferencesKey=pk;this.calendar.batchRendering(()=>{this.calendar!.setOption("firstDay",pref.firstDay);this.calendar!.setOption("timeZone",pref.timezone);this.calendar!.setOption("slotMinTime",pref.slotMin);this.calendar!.setOption("slotMaxTime",pref.slotMax);this.calendar!.setOption("weekends",pref.weekends);this.calendar!.setOption("allDaySlot",pref.allDay);if(old.view!==pref.view)this.calendar!.changeView(pref.view);});}
  const sources=this.host.sources(),key=JSON.stringify(sources);if(key!==this.sourcesKey){this.sourcesKey=key;this.filters!.replaceChildren();for(const source of sources){const label=el(this.filters!,"label","ctt-calendar-source"),input=el(label,"input");input.type="checkbox";input.checked=!this.hidden.has(source.id);input.setAttribute("aria-label",`显示日历 ${source.name}`);el(label,"span","",source.name);label.style.setProperty("--ctt-category-color",source.color||"var(--interactive-accent)");input.onchange=()=>{if(input.checked)this.hidden.delete(source.id);else this.hidden.add(source.id);this.calendar?.refetchEvents();};}}
  this.calendar.refetchEvents();
 }
 dispose(){this.stopped=true;this.unsubscribe?.();this.observer?.disconnect();this.calendar?.destroy();this.calendar=undefined;this.root.replaceChildren();}
}
