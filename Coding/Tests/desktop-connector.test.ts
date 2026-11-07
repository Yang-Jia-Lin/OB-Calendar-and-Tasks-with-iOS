import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { DesktopConnection, RemoteTimerApi } from "../Clients/Obsidian/desktopConnector";
import { startServer } from "../Clients/Desktop/server";
import { desktopFixture } from "../Preview/desktopFixture";
function until(api: RemoteTimerApi, predicate: () => boolean) { return new Promise<void>((resolve, reject) => { let off=()=>{}; const timer=setTimeout(()=>{off();reject(new Error("State subscription timed out"));},3000);off=api.subscribeTimer(()=>{if(predicate()){clearTimeout(timer);off();resolve();}}); }); }
test("OB transport subscribes to the desktop session, finishes it once, and becomes unavailable on disconnect",async()=>{
  const fixture=await desktopFixture(),file=path.join(path.dirname(fixture.store.file),"connection.json"),server=await startServer(fixture.service,file),connection=new DesktopConnection(file),api=new RemoteTimerApi(connection);
  try{
    await connection.connect();await until(api,()=>api.getTimerState().available);
    const task=fixture.service.snapshot().tasks[0];const started=await api.start({kind:"reminder",path:task.path!,id:task.id});assert.ok(started.ok);
    await until(api,()=>!!api.getTimerState().active);const session=fixture.service.controller.state.active!;session.startedAt=session.runningSince=Date.now()-2000;
    const finished=await api.finish(session.id,false);assert.ok(finished.ok);await until(api,()=>api.getTimerState().active===null);
    assert.equal(fixture.store.data.journal.records.length,1);assert.equal(fixture.store.data.journal.records[0].completeTask,false);
    await server.close();await until(api,()=>!api.getTimerState().available);
    const failed=await api.start({kind:"reminder",path:task.path!,id:task.id});assert.equal(failed.ok,false);assert.equal(fixture.service.snapshot().active,null);
    connection.stop();assert.equal(api.getTimerState().available,false);await assert.rejects(connection.call("/v1/state"),/已卸载/);
  }finally{connection.stop();await server.close();await fixture.dispose();}
});
test("OB retries a lost local response with the exact same request identity",async()=>{
  const fixture=await desktopFixture(),file=path.join(path.dirname(fixture.store.file),"retry.json"),requests:any[]=[];
  const server=createServer((request,response)=>{let text="";request.on("data",chunk=>text+=chunk);request.on("end",()=>{requests.push(JSON.parse(text));if(requests.length===1){response.destroy();return;}response.setHeader("Content-Type","application/json");response.end(JSON.stringify({ok:true,sessionId:"sample"}));});});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));await fs.writeFile(file,JSON.stringify({version:1,port:(server.address() as any).port,token:randomBytes(32).toString("hex")}));
  const connection=new DesktopConnection(file);
  try{const result=await connection.command({action:"timer.pause",sessionId:"sample"});assert.equal(result.ok,true);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);}
  finally{connection.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.dispose();}
});
