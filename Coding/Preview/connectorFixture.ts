import {componentsFixture} from "./componentsFixture";
import type {Task,Session} from "../Shared/contracts";
import type {TaskRef,ActionResult} from "../Clients/Obsidian/api";
import type {TimerSnapshot} from "../Shared/application";
export function connectorFixture(){
  const tasks:Task[]=[{id:"one",title:"视频感知优化",kind:"reminder",path:"sample",completed:false},{id:"two",title:"Paper Reading",kind:"reminder",path:"sample",completed:false}];
  let active:Session|null=null,available=true;const listeners=new Set<(state:TimerSnapshot)=>void>(),records:Session[]=[];
  const snapshot=()=>({available,active}),notify=()=>{for(const fn of listeners)fn(snapshot());};
  const api={getState:()=>({...snapshot(),tasks,pending:0}),getTimerState:snapshot,subscribeTimer:(fn:(s:TimerSnapshot)=>void)=>{listeners.add(fn);fn(snapshot());return()=>{listeners.delete(fn);};},
    async start(ref:TaskRef):Promise<ActionResult>{await new Promise(r=>setTimeout(r,50));if(!available)return{ok:false,code:"unavailable",message:"桌面未连接"};if(active)return{ok:false,code:"active-session",message:"已有计时"};const now=Date.now();active={id:crypto.randomUUID(),task:tasks.find(t=>t.id===ref.id)!,title:tasks.find(t=>t.id===ref.id)!.title,calendarId:"cal",zone:"Asia/Shanghai",startedAt:now,runningSince:now,lastHeartbeat:now,segments:[]};notify();return{ok:true,sessionId:active.id};},
    async finish(id:string):Promise<ActionResult>{if(active?.id!==id)return{ok:false,code:"stale-session",message:"计时已变化"};records.push(active);active=null;notify();return{ok:true,sessionId:id};}};
  const native=componentsFixture(api,{"research.md":{kind:"reminder",path:"sample",id:"one"},"reading.md":{kind:"reminder",path:"sample",id:"two"}},true);
  const tick=setInterval(()=>native.manager.tick(),1000);
  return{native,records,state:api.getState,pause:()=>{if(active?.runningSince){active.segments.push({start:active.runningSince,end:Date.now()});active.runningSince=null;notify();}},resume:()=>{if(active&&active.runningSince===null){active.runningSince=Date.now();notify();}},disconnect:()=>{available=false;active=null;notify();},dispose:()=>{clearInterval(tick);native.dispose();}};
}
