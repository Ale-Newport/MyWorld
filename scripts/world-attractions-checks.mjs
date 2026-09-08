/** Interact through the actual keyboard prompts in a disposable browser. */
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const base=process.argv[2]??'http://localhost:3001',out='.qa/attractions'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle']}),page=await browser.newPage({viewport:{width:1440,height:900}}),results=[],errors=[]
page.on('pageerror',e=>errors.push(String(e)))
await page.addInitScript(()=>{if(!localStorage.getItem('alejandro-world-save-v1'))localStorage.setItem('alejandro-world-save-v1',JSON.stringify({version:1,settings:{quality:'medium',onboarded:true,muted:true},progress:{}}))})
const boot=async()=>{await page.goto(`${base}/world`);await page.getByRole('button',{name:'ENTER',exact:true}).click({timeout:120000});await page.waitForFunction(()=>window.__world?.player?.state==='default')}
await boot()
const wait=ms=>page.waitForTimeout(ms)
const tap=async key=>{await page.keyboard.down(key);await wait(160);await page.keyboard.up(key)}
const move=async(x,z,yaw=0)=>{await page.evaluate(({x,z,yaw})=>{const g=window.__world,y=(g.physics.groundAt(x,z)??g.terrain.colliderHeightAt(x,z))+2;g.minigames.cancel();g.vehicle.moveTo({x,y,z},yaw);g.view.focusPoint.trackedPosition.set(x,y,z);g.view.snapToTarget()}, {x,z,yaw});await wait(800)}
const record=(name,data)=>{results.push({name,...data});console.log(JSON.stringify(results.at(-1)))}
const roll=async offset=>{await page.evaluate(offset=>{const g=window.__world,m=g.minigames.get('bowling');g.vehicle.moveTo({x:-79+offset,y:m.startPosition.y,z:29},Math.PI/2)},offset);await wait(600);await page.keyboard.down('KeyW');await wait(1650);await page.keyboard.up('KeyW');await page.keyboard.down('KeyB');await wait(400);await page.keyboard.up('KeyB');await wait(10500)}
// Intentionally send the first ball off-centre; the second centred ball tests
// clearing a real partial rack and the spare rule, without moving any pins.
for(let attempt=0;attempt<2;attempt++) {
  await page.evaluate(()=>{const g=window.__world;g.minigames.cancel();g.minigames.start('bowling')});await wait(900)
  await roll(.4)
  const first=await page.evaluate(()=>{const m=window.__world.minigames.get('bowling');return {state:m.state,down:m.down,awaiting:m.awaiting}})
  if(first.state==='running') {
    await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('bowling');g.vehicle.moveTo(m.startPosition,Math.PI/2)});await wait(700);await tap('Enter');await wait(450);await roll(0)
  }
  const end=await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('bowling');return {state:m.state,down:m.down,throw:m.throwNumber,screen:m.screenText,spare:g.achievements.isUnlocked('spare')}})
  record(`bowling-spare-${attempt+1}`,{ok:first.down>0&&first.down<10&&first.awaiting&&end.state==='finished'&&end.throw===2&&end.down===10,first,...end})
  await page.screenshot({path:`${out}/spare-${attempt+1}.png`})
}
await move(17,70)
for(let i=0;i<12;i++){await tap('Enter');await wait(550)}
record('chip-dispenser',await page.evaluate(()=>{const g=window.__world;return {ok:g.achievements.isUnlocked('chips'),collected:g.playground.stats.collected,pool:g.playground.chips.length}}))
for(let attempt=0;attempt<2;attempt++) {
  await move(-226,54,Math.PI/2);await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');await wait(1750);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await wait(1500)
  record(`cabin-${attempt+1}`,await page.evaluate(()=>{const g=window.__world,q=g.playground.cabin.physical.current.quaternion;return {ok:1-2*(q.x*q.x+q.z*q.z)<.4,up:1-2*(q.x*q.x+q.z*q.z)}}))
  await move(-220,43);await tap('Enter');await wait(700)
}
for(let attempt=0;attempt<2;attempt++) {
  await move(73,205);const before=await page.evaluate(()=>window.__world.lighting.phase);await tap('Enter');await wait(5500)
  record(`time-machine-${attempt+1}`,await page.evaluate(before=>{const g=window.__world;return {ok:Math.abs(g.lighting.phase-before)>.2&&!g.playground.timeActive,phase:g.lighting.phase,duration:g.lighting.duration}},before))
}
for(const [x,z] of [[-78,-229],[-75,-169],[67,-197]]) {await move(x,z);await tap('Enter');await wait(350);await tap('Enter');await wait(350)}
record('live-lab',await page.evaluate(()=>({ok:window.__world.achievements.isUnlocked('labPlay'),progress:window.__world.achievements.progressOf('labPlay')})))
await move(-292,-55);await tap('Enter');await wait(500)
record('waterfall-grotto',await page.evaluate(()=>({ok:window.__world.achievements.isUnlocked('waterfall'),saved:window.__world.save.data.progress.secrets.includes('waterfall')})))
// The first bridge is crossed without teleporting between its banks.
await move(-306,0,0);await page.keyboard.down('KeyW');await wait(3000);await page.keyboard.up('KeyW')
record('wood-bridge',await page.evaluate(()=>{const g=window.__world;return {ok:g.player.position.x>-276&&g.player.position.y>-.4,position:g.player.position,wheels:g.vehicle.wheels.inContactCount}}))
await move(-310,60,Math.PI*1.5);await page.keyboard.down('KeyW');await wait(600);await page.keyboard.up('KeyW');await page.keyboard.down('KeyB');await wait(250);await page.keyboard.up('KeyB')
record('shallow-shore',await page.evaluate(()=>{const g=window.__world,p=g.player.position;return {ok:p.y>-.7&&Math.hypot(p.x+310,p.z-60)<15&&g.water.wake.value.w>0&&g.water.submerged===0,position:p,wake:g.water.wake.value}}))
await wait(1200)
await page.evaluate(()=>window.__world.save.flush())
await boot()
record('new-progress-reload',await page.evaluate(()=>{const g=window.__world;return {ok:g.achievements.isUnlocked('chips')&&g.achievements.isUnlocked('labPlay')&&g.save.data.progress.secrets.includes('waterfall'),secrets:g.save.data.progress.secrets,completed:g.save.data.progress.completedGames,physicalTransformsSaved:JSON.stringify(g.save.data).includes('quaternion')}}))
await writeFile(`${out}/results.json`,JSON.stringify({results,errors},null,2));await browser.close();process.exitCode=results.every(r=>r.ok)&&!errors.length?0:1
