import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CTT_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1050,height:850},timezoneId:'Asia/Shanghai'}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try{
  await page.goto('http://127.0.0.1:4173/?diary');
  const root=page.locator('#ctt-diary-fixture'),button=root.getByRole('button',{name:'更新时间轴'}),status=root.getByRole('status');
  await button.waitFor();await button.focus();await page.keyboard.press('Enter');
  check('Keyboard activates the real diary button and disables repeat clicks while busy',await button.isDisabled());
  await page.waitForFunction(()=>window.__diaryPreview.state.text.includes('实际工时'));
  await button.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#ctt-diary-fixture button').disabled);
  check('Success reports the generated entry count',(await status.textContent()).includes('共 1 项'));
  check('Snapshot preserves handwritten notes and existing new/updated queries',await page.evaluate(()=>window.__diaryPreview.state.text.includes('保留这段手写想法。')&&window.__diaryPreview.state.text.includes('保留原有查询。')));
  check('Successful update backs up once without creating a second request',await page.evaluate(()=>window.__diaryPreview.state.backups===1&&window.__diaryPreview.state.calls===1));
  const before=await page.evaluate(()=>window.__diaryPreview.state.text);await page.evaluate(()=>window.__diaryPreview.state.fail=true);await button.click();
  await page.waitForFunction(()=>document.querySelector('.ctt-diary-status').textContent.startsWith('未更新：'));
  check('Unavailable calendar preserves the prior saved Markdown',await page.evaluate(s=>window.__diaryPreview.state.text===s,before));
  check('Failure restores the button for retry',!await button.isDisabled());
  await page.setViewportSize({width:375,height:850});
  check('Narrow layout keeps its button within the note',await button.evaluate(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
  await page.screenshot({path:'../Agents/Tests/Visuals/25-diary-button-preview.png',fullPage:true});
  await page.evaluate(()=>window.__diaryPreview.dispose());const calls=await page.evaluate(()=>window.__diaryPreview.state.calls);await button.click();await page.waitForTimeout(250);
  check('Disposed render children release the button handler',await page.evaluate(n=>window.__diaryPreview.state.calls===n,calls));
  check('Diary preview has no browser runtime errors',errors.length===0);
  await writeFile('../Agents/Tests/diary-ui.json',JSON.stringify({passed:checks.length,checks},null,2));console.log(`Diary UI: ${checks.length} checks passed`);
}finally{await browser.close();}
