/** Physical integration checks. Fixtures place the car at an approach; real
 * keyboard input then drives the impacts/crossings. No completion methods,
 * score mutations or achievement setters. Continuous race has its own script. */
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const BASE=process.argv[2]??'http://localhost:3001',OUT='.qa/polish'
await mkdir(OUT,{recursive:true})
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle']})
const page=await browser.newPage({viewport:{width:1440,height:900}})
const errors=[],results=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.addInitScript(()=>localStorage.setItem('alejandro-world-save-v1',JSON.stringify({version:1,settings:{quality:'medium',onboarded:true,muted:true},progress:{}})))
await page.goto(`${BASE}/world`);await page.getByRole('button',{name:'ENTER',exact:true}).click({timeout:120000});await page.waitForFunction(()=>window.__world?.player?.state==='default')
const wait=ms=>page.waitForTimeout(ms)
const record=(name,data)=>{results.push({name,...data});console.log(JSON.stringify(results.at(-1)))}
const move=async(x,z,yaw=0)=>{
  await page.evaluate(({x,z,yaw})=>{const g=window.__world,y=(g.physics.groundAt(x,z)??g.terrain.colliderHeightAt(x,z))+2;g.vehicle.moveTo({x,y,z},yaw);g.view.focusPoint.trackedPosition.set(x,y,z);g.view.snapToTarget()}, {x,z,yaw});await wait(650)
}
const drive=async(ms,boost=false)=>{await page.keyboard.down('KeyW');if(boost)await page.keyboard.down('ShiftLeft');await wait(ms);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft')}
const approach=async(p,distance=10,ms=1050)=>{const yaw=p.yaw??0;await move(p.x-Math.cos(yaw)*distance,p.z+Math.sin(yaw)*distance,yaw);await drive(ms)}
const start=async id=>{await page.evaluate(id=>{const g=window.__world;g.minigames.cancel();g.store.getState().setOverlay(null);const m=g.minigames.get(id);const p=m.startPosition;g.vehicle.moveTo({x:p.x,y:g.terrain.colliderHeightAt(p.x,p.z)+2,z:p.z},0);g.player.position.copy(p);g.minigames.start(id)},id);await wait(1000)}
const state=async id=>page.evaluate(id=>{const g=window.__world,m=g.minigames.get(id);return {state:m.state,reached:m.reached,down:m.down,throw:m.throwNumber,hud:g.store.getState().minigame,car:g.player.position,elapsed:m.elapsed}},id)
const shot=async(name,x,z,radius=80)=>{await move(x,z);await page.evaluate(radius=>{const g=window.__world;g.view.spherical.radius.edges.min=radius;g.view.spherical.radius.edges.max=radius;g.view.zoom.baseRatio=0;g.view.zoom.smoothedRatio=0;g.view.snapToTarget()},radius);await wait(900);await page.screenshot({path:`${OUT}/${name}.png`})}
const selected=process.env.POLISH_TESTS?.split(',')??['terrain','visual','bowling','debugDash','riverRun','chipRelay','domino','deployment','name','water','reset']
if(selected.includes('terrain'))record('terrain',await page.evaluate(()=>{const g=window.__world,c=g.physics.physicals[0].colliders[0];const probes=[[-280,60],[-292,-30],[33,-170],[-170,33],[225,-285],[-155,253]].map(([x,z])=>{let toi=c.castRay(new g.physics.rapier.Ray({x,y:60,z},{x:0,y:-1,z:0}),200,true);if(toi<0)toi=c.castRay(new g.physics.rapier.Ray({x,y:60,z:z+.001},{x:0,y:-1,z:0}),200,true);const height=60-toi;return {x,z,visual:g.terrain.colliderHeightAt(x,z),physical:height}});return {ok:probes.every(p=>Math.abs(p.visual-p.physical)<.18),probes,ecology:g.ecology.stats,bodies:g.physics.physicals.length}}))
if(selected.includes('visual')) {
  for(const s of [['hub',0,26,110],['forest',-213,37,105],['lake',-273,87,105],['waterfall',-292,-57,100],['bridge',-292,0,90],['bowling',-79,28,100],['tnt',270,108,100],['circuit',196,-86,185],['garden',87,228,130],['gravity-well',-78,-229,90],['particle-field',-75,-169,90],['voxel-lab',67,-197,90]])await shot(...s)
  await shot('driving-view',-213,37,44)
  await page.keyboard.press('KeyM');await wait(600);await page.screenshot({path:`${OUT}/map.png`});await page.keyboard.press('Escape');await page.evaluate(()=>window.__world.store.getState().setOverlay(null))
}
for(const id of ['bowling','debugDash','riverRun','chipRelay','domino','deployment'])if(selected.includes(id)) {
  for(let attempt=0;attempt<2;attempt++) {
    await start(id)
    if(id==='bowling') {
      await drive(1650);await page.keyboard.down('KeyB');await wait(300);await page.keyboard.up('KeyB');await wait(8000)
      let s=await state(id)
      if(s.state==='running') {await move(-79,29,Math.PI/2);await page.keyboard.press('Enter');await wait(500);await drive(1650);await wait(9000)}
    } else if(id==='debugDash') {
      const blocks=await page.evaluate(()=>window.__world.minigames.get('debugDash').blocks.filter(b=>!b.safe).map(b=>({x:b.physical.initialState.position.x,z:b.physical.initialState.position.z,yaw:0})))
      for(const p of blocks){await approach(p,7,950);await page.keyboard.down('KeyB');await wait(650);await page.keyboard.up('KeyB')}
      await wait(900)
    } else if(id==='riverRun'||id==='chipRelay') {
      for(let i=0;i<(id==='riverRun'?6:3);i++) {
        const p=await page.evaluate(({id,i})=>{const p=window.__world.minigames.get(id).targets[i];return {x:p.x,z:p.z,yaw:id==='riverRun'&&i===4?Math.PI:0}}, {id,i})
        await approach(p,9,900)
        if(id==='riverRun')console.log('river-beacon',i,await state(id))
        if(id==='chipRelay')await approach({x:-6,z:67},9,950)
      }
    } else if(id==='domino') {
      await move(245,84,0);await wait(1500);await drive(1900,true);await wait(7000)
    } else {
      for(let n=0;n<12;n++){const p=await page.evaluate(()=>{const g=window.__world,c=g.playground.cargo.physical.current.position,a=g.playground.altar;return {x:c.x,z:c.z,yaw:Math.atan2(c.z-a.z,a.x-c.x),distance:Math.hypot(c.x-a.x,c.z-a.z)}});console.log('cargo',n,p);if(p.distance<3.6){await wait(1800);break}await approach(p,5,Math.min(950,400+p.distance*20));await page.keyboard.down('KeyB');await wait(500);await page.keyboard.up('KeyB');await wait(600)}
    }
    const s=await state(id);record(`${id}-${attempt+1}`,{ok:s.state==='finished',...s});await page.screenshot({path:`${OUT}/${id}-${attempt+1}.png`})
    await page.getByRole('button',{name:'Exit game',exact:true}).click().catch(()=>{});await page.evaluate(()=>window.__world.minigames.cancel());await move(0,26)
  }
}
if(selected.includes('name')) {
  await page.evaluate(()=>window.__world.playground.resetName());await wait(1000)
  const letters=await page.evaluate(()=>window.__world.playground.letters.map(l=>({...l.physical.initialState.position})))
  for(const p of letters)await approach({x:p.x,z:p.z,yaw:Math.PI/2},8,1200)
  for(let pass=0;pass<3;pass++){const remaining=await page.evaluate(()=>window.__world.playground.letters.filter(l=>!l.down).map(l=>({...l.physical.current.position,char:l.char})));console.log('letters-left',remaining);for(const p of remaining){await move(p.x+(['A','J'].includes(p.char)?1.35:0),p.z-11,Math.PI*1.5);await drive(1600,true);await wait(700)}}record('name',await page.evaluate(()=>({ok:window.__world.playground.letters.every(l=>l.down),down:window.__world.playground.letters.filter(l=>l.down).length})))
}
if(selected.includes('water')) {
  await move(-280,60);await wait(4500)
  record('deep-water',await page.evaluate(()=>{const g=window.__world;return {ok:Math.hypot(g.player.position.x+280,g.player.position.z-60)>35,position:g.player.position}}))
  await shot('shore',-306,74,95)
}
if(selected.includes('reset')) {
  await page.evaluate(()=>window.__world.resetObjects());await wait(3500)
  record('reset',await page.evaluate(()=>{const g=window.__world;return {ok:g.playground.crates.every(c=>!c.exploded&&c.fuse<0)&&g.minigames.current===null,tnt:g.playground.crates.filter(c=>c.exploded||c.fuse>=0).length,letterMax:g.playground.letters.reduce((v,l)=>Math.max(v,l.physical.current.position.distanceTo(l.physical.initialState.position)),0),bodies:g.physics.physicals.length}}))
}
await writeFile(`${OUT}/results.json`,JSON.stringify({results,errors},null,2));console.log('ERRORS',errors);await browser.close();process.exitCode=errors.length||results.some(r=>r.ok===false)?1:0
