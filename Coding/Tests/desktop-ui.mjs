import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = path.resolve('../Agents/Tests/Desktop');
await mkdir(path.resolve('../Agents/Tests/Visuals'),{recursive:true});
await build({entryPoints:['Preview/desktopFixture.ts'],outfile:path.join(output,'fixture.cjs'),bundle:true,platform:'node',format:'cjs'});
const { desktopFixture,eventForSegment,withReminderMetadata }=createRequire(import.meta.url)(path.join(output,'fixture.cjs'));
const fixture=await desktopFixture();
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://127.0.0.1').pathname;const file={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/app.css':'app.css'}[name];if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,'ui',file)));}catch{res.writeHead(500).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CTT_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}); const errors=[]; const results=[];
const check=(name,passed)=>{assert.ok(passed,name);results.push(name);};
const sortKeys = data => JSON.parse(JSON.stringify(data, (_, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : value));
try{
  const context=await browser.newContext({viewport:{width:1100,height:850}});
  await context.exposeFunction('desktopTestApi',async(route,body)=>{
    const url=new URL(route,'http://127.0.0.1');
    if(url.pathname==='/v1/state')return fixture.service.snapshot();
    if(url.pathname==='/v1/command')return fixture.service.command(sortKeys(body));
    if(url.pathname==='/v1/day')return fixture.service.day(url.searchParams.get('date'));
    if(url.pathname==='/v1/history')return fixture.service.history(url.searchParams.get('from'),url.searchParams.get('to'),Number(url.searchParams.get('offset')||0));
    if(url.pathname==='/v1/record')return fixture.service.record(url.searchParams.get('id'));
    if(url.pathname==='/v1/refresh')return{};
    throw new Error('unexpected test route '+route);
  });
  await context.addInitScript(()=>{window.__CTT_TEST_API__=(route,body)=>window.desktopTestApi(route,body);});
  const today = new Date().toLocaleDateString('en-CA');
  const past = new Date(Date.now()-86400000).toLocaleDateString('en-CA');
  const overdue = {...fixture.service.reminders.data.items[0],id:'Reminder/overdue-ui',title:'逾期样例',due:past,scheduledDate:past,description:withReminderMetadata('保留原备注',{scheduledDate:past})};
  const todayTask = {...overdue,id:'Reminder/today-ui',title:'今日样例',due:today,description:withReminderMetadata('',{scheduledDate:today})};
  fixture.service.reminders.data.items.push(overdue, todayTask);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
  await page.getByText('今日样例',{exact:true}).waitFor();
  check('today is the cached default and has no month grid',await page.locator('nav [aria-current=page]').innerText()==='今天'&&await page.locator('#pool-tasks .task-row').count()===2&&await page.locator('.month-grid').count()===0);
  check('today keeps original overdue dates',overdue.due===past&&overdue.scheduledDate===past&&await page.locator('#pool-tasks .overdue-badge').count()===1);
  await page.getByLabel('搜索待办').fill('今日');check('today search narrows the list',await page.locator('#pool-tasks .task-row').count()===1);
  await page.getByLabel('分类筛选').selectOption('list');
  await page.getByLabel('搜索待办').fill('');
  await page.getByLabel('待办状态').selectOption('all-open');check('status filter exposes other cached tasks',await page.locator('#pool-tasks .task-row').count()===5);
  await page.getByLabel('待办状态').selectOption('today');
  await page.setViewportSize({width:390,height:650});
  check('today works at narrow desktop width',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.resolve('../Agents/Tests/Visuals/desktop-today-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1100,height:850});
  await page.screenshot({path:path.resolve('../Agents/Tests/Visuals/desktop-today.png'),fullPage:true});
  await page.getByRole('button',{name:'安排',exact:true}).click();
  await page.getByText('阅读论文',{exact:true}).waitFor();
  await page.evaluate(()=>{window.firstCalendarDay=document.querySelector('.day');});
  check('main opens cached tasks without cloud',await page.locator('#pool-tasks .task-row').count()===3);
  await page.locator('#pool-tasks .task-row').first().getByRole('button',{name:'计时',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#active-title')?.textContent==='阅读论文');
  const session=fixture.service.snapshot().active;check('main starts authoritative backend session',!!session);
  const island=await context.newPage();await island.goto(url+'?window=island');await island.getByText('阅读论文',{exact:true}).waitFor();await island.getByRole('button',{name:'展开',exact:true}).click();await island.getByRole('button',{name:'暂停',exact:true}).click();await island.getByRole('button',{name:'继续',exact:true}).waitFor();
  check('island pauses the same session',fixture.service.snapshot().active.id===session.id&&fixture.service.snapshot().active.runningSince===null);
  await island.getByRole('button',{name:'收起',exact:true}).click();await island.getByRole('button',{name:'展开',exact:true}).waitFor();check('island has explicit collapse and hide actions',await island.getByRole('button',{name:'暂停',exact:true}).count()===0&&await island.getByRole('button',{name:'隐藏灵动岛',exact:true}).count()===1);
  check('island root is transparent',await island.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor==='rgba(0, 0, 0, 0)'));
  await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('button',{name:'继续',exact:true}).waitFor();check('main observes island state',await page.getByRole('button',{name:'继续',exact:true}).count()===1);
  check('timer updates retain calendar DOM',await page.evaluate(()=>window.firstCalendarDay===document.querySelector('.day')));
  const task=page.locator('#pool-tasks .task-row').first(), date=await page.locator('.day:not(.muted)').nth(8).getAttribute('data-date');
  await task.dragTo(page.locator(`[data-date="${date}"]`));await page.waitForFunction(()=>document.querySelectorAll('#pool-tasks .task-row').length===2);
  check('drag schedules date without changing deadline',fixture.service.snapshot().tasks[0].scheduledDate===date&&fixture.service.snapshot().tasks[0].due==='2026-12-31');
  await page.getByRole('button',{name:'撤销安排',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#pool-tasks .task-row').length===3);check('offline undo coalesces undispatched update',fixture.service.snapshot().tasks[0].scheduledDate===null);
  await page.getByRole('button',{name:'新建待办',exact:true}).click();await page.getByLabel('标题',{exact:true}).fill('<script>安全标题</script>');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('<script>安全标题</script>',{exact:true}).waitFor();check('untrusted titles render as text',await page.locator('script').count()===1);
  const widget=await context.newPage();await widget.setViewportSize({width:370,height:650});await widget.goto(url+'?window=calendar');await widget.locator('.month-grid').waitFor();
  check('widget shares month component',await widget.locator('.day').count()===42);
  check('widget has no horizontal overflow',await widget.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fixture.service.reminders.data.lists.push({id:'other',name:'生活'});await page.getByRole('button',{name:'刷新',exact:true}).click();
  const editable=page.locator('#pool-tasks .task-row').filter({hasText:'整理实验记录'});await editable.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('分类',{exact:true}).selectOption('other');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  check('task editor changes category with stable task identity',fixture.service.snapshot().tasks.find(t=>t.title==='整理实验记录').listId==='other');
  const removable=page.locator('#pool-tasks .task-row').filter({hasText:'准备组会'});await removable.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();check('delete cancel keeps task',fixture.service.snapshot().tasks.some(t=>t.title==='准备组会'));
  await removable.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});check('task row deletion uses an in-app confirmation',!fixture.service.snapshot().tasks.some(t=>t.title==='准备组会'));
  await page.getByRole('navigation').getByRole('button',{name:'今天',exact:true}).click();await page.locator('#pool-tasks .overdue-badge').waitFor();
  check('today retains its selected filters after navigating',await page.getByLabel('待办状态').inputValue()==='today'&&await page.getByLabel('分类筛选').inputValue()==='list');
  await page.getByRole('button',{name:'安排',exact:true}).click();
  await page.locator('#month').getByRole('button',{name:'今天',exact:true}).click();
  const start=Date.now()-600000,end=start+120000,record={id:'saved-ui-record',title:'已完成计时',task:{...fixture.service.snapshot().tasks[0]},calendarId:'cal',zone:Intl.DateTimeFormat().resolvedOptions().timeZone,startedAt:start,endedAt:end,runningSince:null,lastHeartbeat:end,segments:[{start,end,uid:'saved-ui-work',saved:true}],completeTask:false,taskSaved:true,status:'saved',error:''};
  const savedEvent=eventForSegment(record,record.segments[0]);
  fixture.service.controller.state.records.push(record);fixture.service.bridge.readByUid=()=>savedEvent;fixture.service.bridge.readDay=()=>({sources:[],rows:[{key:'saved-ui-work',title:record.title,calendarId:'cal',start,end,original:{id:'cal',calendarId:'cal',event:savedEvent}}]});await fixture.store.update({journal:fixture.service.controller.state});
  await page.getByRole('button',{name:'刷新',exact:true}).click();const calendarRecord=page.locator('#day-rows .timeline-row').filter({hasText:'已完成计时'});
  check('calendar renders both local times',/\d{2}:\d{2}–.*\d{2}:\d{2}/.test(await calendarRecord.locator('time').innerText()));
  await calendarRecord.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('标题',{exact:true}).fill('');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').getByText('请填写标题。').waitFor();
  check('failed edit keeps the dialog and entered values',await page.getByLabel('结束',{exact:true}).inputValue()!==''&&await page.getByLabel('标题',{exact:true}).inputValue()==='');
  await page.getByLabel('标题',{exact:true}).fill('修改后的计时');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});const edit=fixture.service.controller.state.records.find(r=>r.id===record.id).edit;check('calendar accepts reordered JSON without losing exact interval precision',edit?.title==='修改后的计时'&&edit.segments[0].start===start&&edit.segments[0].end===end&&fixture.service.controller.state.records.filter(r=>r.id===record.id).length===1);
  await page.getByRole('button',{name:'记录',exact:true}).click();
  await page.locator('.record').filter({hasText:'修改后的计时'}).getByText('待同步',{exact:true}).waitFor();
  const second = {...record,id:'history-ui-record',title:'记录页样例',segments:[{...record.segments[0],uid:'history-ui-work'}]};
  fixture.service.controller.state.records.push(second);
  fixture.service.bridge.readByUid=(_, uid)=>uid===second.segments[0].uid?eventForSegment(second,second.segments[0]):savedEvent;
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.locator('.record').filter({hasText:'记录页样例'}).getByRole('button',{name:'修改',exact:true}).click();
  const endInput=page.getByLabel('结束',{exact:true}), oldEnd=await endInput.inputValue();
  await endInput.fill(new Date(end-60000-new Date(end).getTimezoneOffset()*60000).toISOString().slice(0,16));
  check('history editor accepts an explicit end time change',await endInput.inputValue()!==oldEnd);
  await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  await page.locator('.record').filter({hasText:'记录页样例'}).getByText('待同步',{exact:true}).waitFor();
  check('history saves reordered JSON with the original segment UID',fixture.service.record(second.id).edit?.segments[0].uid===second.segments[0].uid);
  await fixture.store.change(data=>({settings:{...data.settings,migratedFrom:'sample-migration'}}));await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  check('completed setup removes verification and migration controls',await page.getByRole('button',{name:'核对原生往返',exact:true}).count()===0&&await page.getByRole('button',{name:'预览并导入交接快照',exact:true}).count()===0);
  await page.screenshot({path:path.resolve('../Agents/Tests/Visuals/desktop-main.png'),fullPage:true});await widget.screenshot({path:path.resolve('../Agents/Tests/Visuals/desktop-calendar.png'),fullPage:true});await island.screenshot({path:path.resolve('../Agents/Tests/Visuals/desktop-island.png'),fullPage:true});
  const nativeContext = await browser.newContext();
  let finishRefresh, beginRefresh;
  const slowRefresh = new Promise(resolve => { finishRefresh = resolve; });
  const refreshStarted = new Promise(resolve => { beginRefresh = resolve; });
  await nativeContext.exposeFunction('nativeTestApi', async (route, body) => {
    if (route.startsWith('/v1/state')) return fixture.service.snapshot(false);
    if (route === '/v1/refresh') { beginRefresh(); await slowRefresh; return {}; }
    if (route === '/v1/command') return fixture.service.command(sortKeys(body));
    throw new Error('unexpected native test route ' + route);
  });
  await nativeContext.addInitScript(() => {
    const callbacks = new Map();
    window.nativeRoutes = [];
    window.__TAURI__ = {
      core: { invoke: async (name, args) => {
        if (name !== 'backend') return;
        window.nativeRoutes.push(args.route);
        return window.nativeTestApi(args.route, args.body);
      }},
      event: { listen: async (name, fn) => { callbacks.set(name, fn); } },
    };
    window.receiveDesktopState = payload => callbacks.get('desktop-state')?.({payload});
  });
  const nativePage = await nativeContext.newPage();
  nativePage.on('pageerror',e=>errors.push(e.message));
  await nativePage.goto(url);
  await nativePage.getByRole('button',{name:'刷新',exact:true}).click();
  await refreshStarted;
  try {
    await nativePage.getByRole('button',{name:'新建待办'}).click();
    await nativePage.getByLabel('标题',{exact:true}).fill('慢网新建样例');
    await nativePage.getByLabel('截止日期',{exact:true}).fill(today);
    await nativePage.getByRole('button',{name:'保存',exact:true}).click();
    await nativePage.getByRole('dialog').waitFor({state:'detached'});
    await nativePage.evaluate(snapshot => window.receiveDesktopState(snapshot),fixture.service.snapshot(false));
    await nativePage.getByLabel('搜索待办').fill('慢网新建');
    await nativePage.getByText('慢网新建样例',{exact:true}).waitFor();
    const routes = await nativePage.evaluate(() => window.nativeRoutes);
    check('native save and search finish during a slow refresh with no follow-up state read',
      routes.filter(route=>route.startsWith('/v1/state')).length===1 &&
      routes.every(route=>!route.startsWith('/v1/day')) &&
      await nativePage.locator('#pool-tasks .task-row').count()===1);
  } finally {
    finishRefresh();
    await nativeContext.close();
  }
  check('no browser exceptions',errors.length===0);
  await writeFile(path.join(output,'ui-test-results.json'),JSON.stringify({passed:results.length,results,errors},null,2));console.log(`Desktop UI: ${results.length} scenarios passed`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fixture.dispose();}
