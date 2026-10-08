/* Real Chrome / WebKit smoke, reduced motion and recoverable runtime failures.
 * QA_BROWSER=webkit node scripts/qa/polish-compat.mjs */
import { webkit } from 'playwright';
import fs from 'node:fs';
import { BASE, launch, out, assert, finish } from './lib.mjs';

const engine = process.env.QA_BROWSER ?? 'chrome';
const browser = engine === 'webkit' ? await webkit.launch() : await launch({channel:'chrome'});
const results=[], errors=[], warnings=[], missing=[];
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const entered=async(p)=>{
 try { await p.waitForFunction(()=>document.documentElement.dataset.worldPhase==='IN_WORLD',null,{timeout:90000}); }
 catch(error){
  console.log('entry diagnostic',await p.evaluate(()=>({url:location.href,phase:document.documentElement.dataset.worldPhase,cover:document.querySelector('[class*="canopy-module"][class*="root"]')?.outerHTML.slice(0,500),text:document.body.innerText.slice(-500)})));
  console.log('browser errors',errors);throw error;
 }
};
page.on('pageerror', e=>errors.push(String(e)));
page.on('console', m=>{if(['error','warning'].includes(m.type()))warnings.push(m.text())});
page.on('response', r=>{if(r.status()>=400)missing.push([r.status(),r.url()])});
await page.goto(BASE+'/world',{waitUntil:'domcontentloaded'});
await page.locator('[data-covered]').waitFor({state:'attached'});
assert(await page.getByText('Building the island').count()===0, `${engine}: direct URL uses foliage, no blue loader`,results);
await page.waitForFunction(()=>document.documentElement.dataset.worldPhase==='IN_WORLD',null,{timeout:180000});
const frame=page.frames().find(f=>f.url().includes('/archipelago/preview/'));
for(const [button,dialog,close] of [['#player-map','.atlas','.atlas-close'],['#player-help','#help-dialog','#close-help'],['#player-awards','#awards-dialog','#close-awards']]){
 await frame.locator(button).click();await frame.locator(dialog).waitFor({state:'visible'});await frame.locator(close).click();
}
assert(true,`${engine}: Map, Controls and Achievements open and close`,results);
const start=await frame.evaluate(()=>window.__archipelago.driving.vehicle.position.toArray());
await frame.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');
const moved=await frame.evaluate(()=>window.__archipelago.driving.vehicle.position.toArray());
assert(Math.hypot(moved[0]-start[0],moved[2]-start[2])>.5,`${engine}: driving responds to keyboard input`,results);
await frame.evaluate(()=>document.fonts.ready);
const font=await frame.locator('#player-nav').evaluate(el=>({family:getComputedStyle(el).fontFamily,faces:[...document.fonts].filter(f=>f.status==='loaded').length}));
assert(font.faces>0,`${engine}: iframe loads the portfolio font (${font.family})`,results);
await page.screenshot({path:out(`polish-${engine}-world.png`)});
await frame.locator('#player-home').click();await page.waitForURL(BASE+'/');
await page.waitForFunction(()=>window.__room?.().milestones.ready,null,{timeout:60000});
await page.mouse.wheel(0,10000);await page.setViewportSize({width:390,height:844});
await page.waitForTimeout(500);await page.setViewportSize({width:2560,height:1080});
await page.waitForTimeout(500);
assert(await page.locator('#journey[inert], [data-hud][inert]').count()===0,`${engine}: return, rapid scroll and responsive resize leave input usable`,results);
await page.goBack({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.documentElement.dataset.worldPhase==='IN_WORLD',null,{timeout:90000});
assert(true,`${engine}: browser Back re-enters /world and reveals it`,results);
await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL(BASE+'/');
await page.waitForFunction(()=>!document.querySelector('[data-covered]'));
assert(await page.locator('#journey[inert]').count()===0,`${engine}: browser Forward restores the homepage without a cover`,results);

const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',hasTouch:true,isMobile:true});
const rp=await reduced.newPage();rp.on('pageerror',e=>errors.push(String(e)));
await rp.goto(BASE);await rp.waitForFunction(()=>window.__room?.().milestones.ready,null,{timeout:60000});
console.log(`${engine}: reduced-motion homepage ready`);
await rp.keyboard.press('i');const link=rp.locator('[aria-label="Chapter index"] a[href="/world"]');
await link.click();await entered(rp);
assert(await rp.locator('iframe').count()===1,`${engine}: reduced-motion phone entry completes and reveals one world`,results);
await rp.touchscreen.tap(190,400);
const rf=rp.frames().find(f=>f.url().includes('/archipelago/preview/'));
await rf.locator('#touch-controls').waitFor({state:'visible'});
assert(await rf.evaluate(()=>getComputedStyle(document.querySelector('#touch-recover')).backgroundColor===getComputedStyle(document.querySelector('#player-help')).backgroundColor),`${engine}: touch controls use the shared portfolio palette`,results);
await rp.screenshot({path:out(`polish-${engine}-reduced.png`)});await reduced.close();

if(engine==='chrome'){
 const recovery=await browser.newContext();const p=await recovery.newPage();let blocked=true;
 await p.route('**/archipelago/preview/main.js*',r=>blocked?r.abort():r.continue());
 await p.goto(BASE+'/world',{waitUntil:'domcontentloaded'});
 await p.getByRole('alert').waitFor({timeout:30000});
 assert(await p.getByRole('button',{name:'Try again'}).isEnabled(),'runtime failure offers an accessible retry over foliage',results);
 blocked=false;await p.getByRole('button',{name:'Try again'}).click();
 await p.waitForFunction(()=>document.documentElement.dataset.worldPhase==='IN_WORLD',null,{timeout:180000});
 assert(true,'retry creates a fresh runtime and reveals the world',results);
 await recovery.close();
}
assert(errors.length===0,`${engine}: no uncaught exceptions (${errors.length})`,results);
assert(missing.length===0,`${engine}: no failed resources (${missing.length})`,results);
fs.writeFileSync(out(`polish-${engine}.json`),JSON.stringify({results,errors,warnings,missing,font},null,2));
await browser.close();finish(results);
