import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const bundled=await build({entryPoints:['Clients/Obsidian/sidebar.ts'],bundle:true,write:false,format:'iife',globalName:'sidebar',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.CTT_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage(),checks=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try{
  await page.setContent('<div class="workspace-ribbon mod-left"></div><div class="workspace-ribbon mod-right"></div>');
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.evaluate(()=>{
    window.controls=sidebar.mountRibbonVisibility(document,true);
    const add=(root,label)=>{const el=document.createElement('button');el.className='side-dock-ribbon-action';el.setAttribute('aria-label',label);el.textContent=label;root.append(el);};
    const left=document.querySelector('.mod-left'),right=document.querySelector('.mod-right');
    for(const label of ['Templater','Open Git source control','AI 对话（新标签页）','Insert Callout','打开桌面计时','Open today','新建思维导图'])add(left,label);
    add(right,'Templater');
    add(left,'Obsidian already hidden');left.lastChild.style.display='none';
  });
  const visible=()=>page.locator('.mod-left button:visible').allTextContents();
  check('late registered targets stay hidden; other shortcuts remain visible',JSON.stringify(await visible())===JSON.stringify(['打开桌面计时','Open today','新建思维导图']));
  await page.evaluate(()=>document.querySelector('.mod-left').classList.add('mod-primary'));
  await page.evaluate(()=>document.querySelector('.mod-primary').classList.remove('mod-left'));
  check('Obsidian 1.15 primary ribbon targets stay hidden',await page.locator('.mod-primary button:visible').count()===3);
  await page.evaluate(()=>document.querySelector('.mod-primary').classList.add('mod-left'));
  check('right ribbon is untouched',await page.locator('.mod-right button').isVisible());
  await page.evaluate(()=>{const left=document.querySelector('.mod-left'),el=left.querySelector('button');el.remove();left.append(el.cloneNode(true));});
  check('recreated plugin button stays hidden',await page.locator('.mod-left [aria-label="Templater"]').isHidden());
  await page.evaluate(()=>controls.setEnabled(false));
  check('turning off restores all four buttons',(await visible()).length===7);
  check('Obsidian own hidden choice is preserved',await page.getByRole('button',{name:'Obsidian already hidden',exact:true,includeHidden:true}).isHidden());
  await page.evaluate(()=>controls.setEnabled(true));
  check('turning on immediately hides the targets',(await visible()).length===3);
  await page.evaluate(()=>controls.dispose());
  check('unload removes plugin rule',(await visible()).length===7&&await page.locator('head style').count()===0);
  await page.evaluate(()=>{window.controls=sidebar.mountRibbonVisibility(document,false);});
  check('saved disabled preference leaves shortcuts alone',(await visible()).length===7);
  await writeFile('../Agents/Tests/ribbon-ui.json',JSON.stringify({passed:checks.length,checks},null,2));
  console.log(`OB ribbon UI: ${checks.length} checks passed`);
}finally{await browser.close();}
