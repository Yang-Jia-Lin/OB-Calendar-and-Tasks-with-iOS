import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
const out=path.resolve('../Agents/Tests/Desktop'),resources=path.join(out,'resources');
await build({entryPoints:['Preview/desktopFixture.ts'],outfile:path.join(out,'fixture.cjs'),bundle:true,platform:'node',format:'cjs'});
const {desktopFixture}=createRequire(import.meta.url)(path.join(out,'fixture.cjs'));
await build({entryPoints:['Clients/Desktop/runtime.ts'],outfile:path.join(out,'runtime-test.cjs'),bundle:true,platform:'node',format:'cjs'});
const {BundledReminders}=createRequire(import.meta.url)(path.join(out,'runtime-test.cjs'));
const fixture=await desktopFixture();await fixture.service.close();
const child=spawn(path.join(resources,'runtime/node.exe'),[path.join(resources,'backend.cjs'),resources],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CTT_DESKTOP_DATA:path.dirname(fixture.store.file),CTT_DESKTOP_OFFLINE:'1'}});
let stderr='';child.stderr.on('data',data=>stderr+=data);const lines=createInterface({input:child.stdout});
const started=performance.now();
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
try{
  const connection=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Packaged backend startup timed out: '+stderr)),20000);lines.on('line',line=>{try{const data=JSON.parse(line);if(data.event==='ready'){clearTimeout(timeout);resolve(data);}}catch{}});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Backend exited during startup: '+stderr));});child.once('error',reject);});
  const coldStartMs=performance.now()-started;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${connection.port}${route}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+connection.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
  const send=mutation=>call('/v1/command',{version:1,requestId:randomUUID(),...mutation});
  const initial=await call('/v1/state');const task=initial.tasks[0];
  const begin=await send({action:'timer.start',task:{kind:'reminder',id:task.id,path:task.path}});const times=[];
  for(let i=0;i<30;i++){let t=performance.now();await send({action:'timer.pause',sessionId:begin.sessionId});times.push(performance.now()-t);t=performance.now();await send({action:'timer.resume',sessionId:begin.sessionId});times.push(performance.now()-t);}
  // Start the packaged Python helper without an account. It must fail locally, not install dependencies or authenticate.
  await assert.rejects(call('/v1/auth',{}));
  await new Promise(resolve=>setTimeout(resolve,1100));
  const finish={version:1,requestId:randomUUID(),action:'timer.finish',sessionId:begin.sessionId,completeTask:false};await call('/v1/command',finish);await call('/v1/command',finish);
  const state=await call('/v1/state');assert.equal(state.active,null);assert.equal(state.records.length,1);
  times.sort((a,b)=>a-b);const p95Ms=times[Math.ceil(times.length*.95)-1];
  child.stdin.write(JSON.stringify({action:'shutdown'})+'\n');const exit=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Graceful shutdown timed out')),15000))]);assert.equal(exit.code,0,stderr);
  const saved=JSON.parse(await fs.readFile(fixture.store.file,'utf8'));assert.equal(saved.journal.records.length,1);
  const helper=new BundledReminders(resources,path.join(path.dirname(fixture.store.file),'idle-helper'),100);
  try{await assert.rejects(helper.call('connect',{}));const firstHelper=helper.child;assert.ok(firstHelper?.pid);
    const helperExit=new Promise(resolve=>firstHelper.once('exit',resolve));await Promise.race([helperExit,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Idle Python did not exit')),5000);t.unref();})]);
    assert.equal(helper.child,undefined);await assert.rejects(helper.call('connect',{}));assert.ok(helper.child?.pid);assert.notEqual(helper.child.pid,firstHelper.pid);
  }finally{helper.stop();}
  // Fail AFTER the normal writer lease is acquired, before any account or
  // business state is opened. Startup errors must release OS handles by exiting.
  const conflictRoot=path.join(path.dirname(fixture.store.file),'startup-conflict');await fs.mkdir(conflictRoot);
  await fs.writeFile(path.join(conflictRoot,'backend.lock'),String(process.pid));
  const conflictEnv={...process.env,CTT_DESKTOP_DATA:conflictRoot};delete conflictEnv.CTT_DESKTOP_OFFLINE;
  const conflict=spawn(path.join(resources,'runtime/node.exe'),[path.join(resources,'backend.cjs'),resources],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:conflictEnv});
  let conflictError='';conflict.stderr.on('data',data=>conflictError+=data);conflict.stdout.resume();
  let startupTimeout;
  try{const code=await Promise.race([new Promise((resolve,reject)=>{conflict.once('exit',resolve);conflict.once('error',reject);}),new Promise((_,reject)=>{startupTimeout=setTimeout(()=>reject(new Error('Failed backend left its writer lease alive')),7000);})]);assert.equal(code,1);assert.match(conflictError,/已有.*(?:后台运行|宿主)/);}
  finally{clearTimeout(startupTimeout);if(conflict.exitCode===null)conflict.kill();}
  const result={scenarios:10,localCommands:times.length,coldStartMs:Math.round(coldStartMs),p95Ms:Math.round(p95Ms),p95TargetMet:p95Ms<=200,notes:'Isolated packaged Node + Python runtime, offline fixture; excludes native WebView/desktop parenting and real sleep/iCloud acceptance.'};
  await fs.writeFile(path.join(out,'backend-smoke-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{lines.close();if(child.exitCode===null)child.kill();await fs.rm(path.dirname(fixture.store.file),{recursive:true,force:true});}
