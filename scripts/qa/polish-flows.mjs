/* Production regression coverage for the homepage → foliage → world path. */
import {launch,BASE,out,assert,finish} from './lib.mjs';
import fs from 'node:fs';
const results=[],errors=[],missing=[];
const browser=await launch();
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)missing.push([r.status(),r.url()])});
await page.addInitScript(()=>{window.__phases=[];window.addEventListener('world:phase',e=>window.__phases.push({phase:e.detail,at:performance.now()}))});
const goHome=async()=>{await page.goto(BASE);await page.waitForFunction(()=>window.__room?.().milestones.ready,null,{timeout:60000})};
for(const [w,h] of [[1440,900],[1920,1080],[2560,1080],[768,1024],[390,844]]){
 await page.setViewportSize({width:w,height:h});await goHome();
 const first=await page.evaluate(()=>({fov:window.__room().fovY,inset:window.__room().inset,soffit:window.__room().soffitY}));
 for(let i=0;i<10;i++){await page.mouse.wheel(0,32);await page.waitForTimeout(40)}
 await page.waitForTimeout(600);
 const next=await page.evaluate(()=>({fov:window.__room().fovY,inset:window.__room().inset,soffit:window.__room().soffitY}));
 assert(JSON.stringify(first)===JSON.stringify(next),`${w}×${h}: room camera stable from first frame through early scrolling`,results);
 assert(await page.locator('iframe').count()===0,`${w}×${h}: no background world iframe`,results);
 await page.screenshot({path:out(`polish-home-${w}.png`)});
}
await page.setViewportSize({width:1440,height:900});await goHome();
assert(!(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('/archipelago/')))),'cold hero makes no world asset requests',results);
await page.evaluate(()=>scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*.65));
await page.waitForFunction(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('/api/world/release')),null,{timeout:30000});
await page.waitForFunction(()=>window.__canopy?.().ready,null,{timeout:30000});
assert(await page.locator('iframe').count()===0,'approach warms assets and canopy without starting the world',results);
await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
await page.waitForFunction(()=>document.documentElement.scrollHeight-innerHeight-scrollY<3);
// One continuing wheel input must begin the cover without a dwell gate.
await page.mouse.wheel(0,160);await page.waitForTimeout(80);
assert(await page.evaluate(()=>{const el=document.querySelector('[class*="ruleFill"]');return parseFloat(/scaleX\(([^)]+)/.exec(el?.style.transform??'')?.[1]??'0')>0}),'first wheel at the end immediately charges the vegetation',results);
for(let i=0;i<60;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(25);if(await page.evaluate(()=>document.documentElement.dataset.worldPhase==='COVERED'||location.pathname==='/world'))break;}
await page.waitForFunction(()=>document.documentElement.dataset.worldPhase==='IN_WORLD',null,{timeout:120000});
let frame=page.frames().find(f=>f.url().includes('/archipelago/preview/'));
assert(await page.locator('text=Building the island').count()===0,'blue loading screen is absent',results);
const phases=await page.evaluate(()=>window.__phases);
assert(JSON.stringify(phases.map(p=>p.phase))===JSON.stringify(['COVERING','COVERED','LOADING_WORLD','WORLD_READY','REVEALING','IN_WORLD']),'scroll entry follows verified coverage and runtime readiness',results);
await page.screenshot({path:out('polish-world-final.png')});
// Drive through real input, then exercise all modal controls and their layouts.
const before=await frame.evaluate(()=>window.__archipelago.driving.vehicle.position.toArray());
await frame.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');
const after=await frame.evaluate(()=>window.__archipelago.driving.vehicle.position.toArray());
assert(Math.hypot(after[0]-before[0],after[2]-before[2])>.5,'vehicle responds to driving controls',results);
for(const [w,h] of [[1440,900],[2560,1080],[768,1024],[390,844]]){
 await page.setViewportSize({width:w,height:h});await frame.locator('#player-map').click();
 await frame.locator('.atlas').waitFor({state:'visible'});await page.waitForTimeout(300);
 const box=await frame.locator('.atlas').boundingBox();
 assert(box.x>=9&&box.y>=9&&box.width<=Math.min(1121,w-18)&&Math.abs(box.x+box.width/2-w/2)<2,`${w}×${h}: map centered with bounded size and margins`,results);
 await page.screenshot({path:out(`polish-map-${w}.png`)});
 await frame.locator('.atlas-close').click();
}
await page.setViewportSize({width:1440,height:900});
const mem=[];for(let i=0;i<3;i++){await frame.locator('#player-map').click();await frame.locator('.atlas-close').click();mem.push(await frame.evaluate(()=>window.__archipelago.renderer.info.memory));}
assert(mem[2].textures<=mem[0].textures&&mem[2].geometries<=mem[0].geometries,'reopening Map does not accumulate GPU resources',results);
for(const [button,dialog,close] of [['#player-help','#help-dialog','#close-help'],['#player-awards','#awards-dialog','#close-awards']]){await frame.locator(button).click();assert(await frame.locator(dialog).isVisible(),`${button} opens`,results);await page.screenshot({path:out(`polish-${button.slice(1)}.png`)});await frame.locator(close).click();}
// Inspect the real in-world board with live records, no geometry mirroring.
const board=await frame.evaluate(()=>{const A=window.__archipelago,i=A.gameplay.instances.find(i=>i.parts.circuit),c=i.parts.circuit,n=i.references.node('refLeaderboard');c.records=[{time:63.271,at:Date.now()},{time:72.482,at:Date.now()}];c.drawBoard();const p=n.getWorldPosition(new A.THREE.Vector3()),normal=new A.THREE.Vector3(1,0,0).transformDirection(n.matrixWorld);A.atlas.isOpen=true;A.camera.position.copy(p).addScaledVector(normal,10);A.camera.lookAt(p);A.camera.updateMatrixWorld();A.renderer.render(A.scene,A.camera);const fabric=[];i.frame.traverse(o=>{if(o.isMesh&&['Cylinder.022','Cylinder.037','Cylinder.039','refBanners','refBanners.001'].includes(o.userData.w2Source??o.name))for(const m of [o.material].flat())if(['circuitBrand','circuitWebgl','circuitWebgpu'].includes(m.name))fabric.push({color:m.color.getHexString(),map:!!m.map})});return {repeat:c.board.texture.repeat.x,scale:n.scale.toArray(),fabric}});
await page.screenshot({path:out('polish-leaderboard.png')});
assert(board.repeat===-1&&board.scale.every(n=>n>0),'leaderboard texture reads from its authored approach; geometry is not mirrored',results);
assert(board.fabric.length>=3&&new Set(board.fabric.map(f=>f.color)).size>=3&&board.fabric.every(f=>!f.map),'racetrack fabric has a coordinated palette without logo textures',results);
await frame.evaluate(()=>{window.__archipelago.atlas.isOpen=false});
await frame.locator('#player-home').click();await page.waitForURL(BASE+'/');await page.waitForFunction(()=>window.__room?.().milestones.ready);
assert(await page.locator('#journey[inert], [data-hud][inert]').count()===0&&await page.locator('[data-covered]').count()===0,'return to portfolio clears the cover and input lock',results);
await page.keyboard.press('i');const link=page.locator('[aria-label="Chapter index"] a[href="/world"]');await link.waitFor({state:'visible'});await link.hover();await page.waitForTimeout(300);const t=Date.now();await link.click();await page.waitForFunction(()=>document.documentElement.dataset.worldPhase==='COVERING');assert(Date.now()-t<700,'Enter my world starts the same cover immediately',results);await page.waitForFunction(()=>document.documentElement.dataset.worldPhase==='IN_WORLD',null,{timeout:120000});
assert(await page.locator('iframe').count()===1,'second entry creates exactly one world',results);
assert(errors.length===0,`no browser exceptions: ${errors.join(' | ')}`,results);assert(missing.length===0,`no failed resources: ${JSON.stringify(missing)}`,results);
fs.writeFileSync(out('polish-flows.json'),JSON.stringify({results,phases,board,mem,errors,missing},null,2));
await browser.close();finish(results);
