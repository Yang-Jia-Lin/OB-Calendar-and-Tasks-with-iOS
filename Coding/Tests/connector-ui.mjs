import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CTT_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4173/');const card=page.locator('[data-note="research.md"]'),button=card.locator('.ctt-components-timer-button');await button.waitFor();
 check('only existing native buttons are decorated',await page.locator('.components--DynamicDataView-Button').count()===2);
 await button.click();await page.waitForFunction(()=>window.__connectorPreview.state().active);
 const id=await page.evaluate(()=>window.__connectorPreview.state().active.id);check('card starts its bound task',await page.evaluate(()=>window.__connectorPreview.state().active.task.id==='one'));
 await page.evaluate(()=>window.__connectorPreview.pause());const paused=await button.textContent();await page.waitForTimeout(1100);check('paused duration does not advance',await button.textContent()===paused);
 await page.evaluate(()=>window.__connectorPreview.resume());check('resume keeps the same session',await page.evaluate(id=>window.__connectorPreview.state().active.id===id,id));
 await page.locator('[data-note="reading.md"] .ctt-components-timer-button').click();check('another card cannot replace the active session',await page.evaluate(id=>window.__connectorPreview.state().active.id===id,id));
 await button.click();await page.waitForFunction(()=>!window.__connectorPreview.state().active);check('finish records once without completing task',await page.evaluate(()=>window.__connectorPreview.records.length===1&&!window.__connectorPreview.state().tasks[0].completed));
 await page.waitForTimeout(750);await button.dblclick();await page.waitForFunction(()=>window.__connectorPreview.state().active);check('double click does not finish the new session',await page.evaluate(()=>window.__connectorPreview.records.length===1));
 await card.evaluate(e=>{e.closest('aside').style.width='280px';e.closest('aside').querySelector('.fixture-cards').style.gridTemplateColumns='1fr';});
 check('narrow native card has no horizontal overflow',await card.evaluate(e=>e.scrollWidth<=e.clientWidth));
 await page.waitForFunction(()=>document.querySelector('[data-note="research.md"] .ctt-components-timer-button').getAttribute('aria-disabled')==='false');await page.evaluate(()=>window.__connectorPreview.disconnect());check('disconnected action can wake desktop',await button.getAttribute('aria-disabled')==='false');
 await page.screenshot({path:'../Agents/Tests/Visuals/connector-only.png',fullPage:true});
 await page.evaluate(()=>window.__connectorPreview.dispose());check('dispose restores native controls',await page.locator('.ctt-components-timer-button').count()===0);
 check('no browser errors',errors.length===0);await writeFile('../Agents/Tests/connector-ui.json',JSON.stringify({passed:checks.length,checks,errors},null,2));console.log(`OB connector UI: ${checks.length} checks passed`);
}finally{await browser.close();}
