import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CTT_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:800}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try{
 await page.goto('http://127.0.0.1:4173');await page.waitForSelector('.ctt-page-tabs');
 await page.evaluate(()=>window.__preview.openNoteTaskForm('research'));
 check('The note title is shown without an editable title or an existing-task picker',await page.locator('dialog .ctt-note-task-title').textContent()==='端边云平台'&&await page.locator('dialog input').count()===0&&await page.locator('dialog select').count()===1);
 check('The default category is preselected',await page.getByRole('dialog').getByLabel('课题待办分类').inputValue()==='research');
 await page.screenshot({path:'../Agents/Tests/Visuals/37-note-task-category.png'});
 await page.getByRole('dialog').getByLabel('课题待办分类').selectOption('work');await page.getByRole('button',{name:'创建待办',exact:true}).click();
 check('Confirming returns the chosen category exactly once',await page.evaluate(()=>JSON.stringify(window.__preview.noteFormChoices))==='["work"]');
 await page.evaluate(()=>window.__preview.openNoteTaskForm('research'));await page.getByRole('button',{name:'取消',exact:true}).click();
 check('Cancel returns no category and does not create preview tasks',await page.evaluate(()=>JSON.stringify(window.__preview.noteFormChoices)==='["work",null]'&&window.__preview.tasks().length===4));
 await page.setViewportSize({width:340,height:700});await page.evaluate(()=>window.__preview.openNoteTaskForm('removed'));
 check('An unavailable default requires a new selection',await page.getByRole('dialog').getByLabel('课题待办分类').inputValue()===''&&await page.getByRole('dialog').getByLabel('课题待办分类').evaluate(e=>!e.checkValidity()));
 check('The category form fits a narrow pane',await page.getByRole('dialog').evaluate(e=>e.getBoundingClientRect().right<=innerWidth&&e.scrollWidth<=e.clientWidth));
 await page.getByRole('button',{name:'取消',exact:true}).click();check('No browser errors',errors.length===0);
 await writeFile('../Agents/Tests/note-task-ui.json',JSON.stringify({passed:checks.length,checks,errors},null,2));console.log(`Note task category UI: ${checks.length} checks passed`);
}finally{await browser.close();}
