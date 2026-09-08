/** Continuous, keyboard-only driving of complete race attempts. The controller
 * reads position/heading and the centreline, but never writes a transform,
 * checkpoint, time, score or physics parameter while a run is in progress. */
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const BASE=process.argv[2]??'http://localhost:3001',OUT='.qa/race'
await mkdir(OUT,{recursive:true})
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle']})
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],results=[]
page.on('pageerror',e=>errors.push(String(e)))
await page.addInitScript(()=>{if(!localStorage.getItem('alejandro-world-save-v1'))localStorage.setItem('alejandro-world-save-v1',JSON.stringify({version:1,settings:{quality:'medium',muted:true,onboarded:true},progress:{}}))})
await page.goto(`${BASE}/world`);await page.getByRole('button',{name:'ENTER',exact:true}).click({timeout:120000});await page.waitForFunction(()=>window.__world?.player?.state==='default')
const sleep=ms=>page.waitForTimeout(ms)
const held=new Set()
async function keys(wanted) {for(const key of [...held])if(!wanted.includes(key)){await page.keyboard.up(key);held.delete(key)}for(const key of wanted)if(!held.has(key)){await page.keyboard.down(key);held.add(key)}}
const modes=process.env.RACE_MODES?.split(',')??['slow','normal','boost']
for(const mode of modes) {
  await page.evaluate(()=>{const g=window.__world;g.store.getState().setOverlay(null);g.minigames.cancel();g.minigames.start('circuit')})
  await sleep(1000)
  const countdown=await page.evaluate(()=>({state:window.__world.minigames.get('circuit').state,reached:window.__world.minigames.get('circuit').reached}))
  await sleep(2250)
  let lastReached=-1,lastLog=0,maxOff=0,stalled=0
  const began=Date.now()
  while(Date.now()-began<180000) {
    const s=await page.evaluate(mode=>{
      const g=window.__world,m=g.minigames.get('circuit'),p=g.player.position
      const samples=m.curve.getSpacedPoints(480);let closest=0,dist=Infinity
      for(let i=0;i<480;i++){const d=(p.x-samples[i].x)**2+(p.z-samples[i].z)**2;if(d<dist){dist=d;closest=i}}
      const v=g.vehicle.chassis.physical.body.linvel(),speed=Math.hypot(v.x,v.z)
      const look=mode==='boost'?14:mode==='normal'?11:9
      const length=m.curve.getLength(),target=m.curve.getPointAt((closest/480+look/length)%1)
      const tangent=m.curve.getTangentAt(closest/480),ahead=m.curve.getTangentAt((closest/480+20/length)%1)
      const curvature=Math.acos(Math.min(1,Math.max(-1,tangent.dot(ahead))))
      let error=Math.atan2(target.z-p.z,target.x-p.x)-g.player.rotationY
      error=Math.atan2(Math.sin(error),Math.cos(error))
      const angular=g.vehicle.chassis.physical.body.angvel().y
      const steer=error+angular*.22
      const targetSpeed=mode==='slow'?6.7:mode==='normal'?Math.max(7.2,12-curvature*5):Math.max(8,19-curvature*10)
      return {state:m.state,reached:m.reached,time:m.elapsed,pos:{x:p.x,y:p.y,z:p.z},speed,targetSpeed,error,steer,off:Math.sqrt(dist),wheels:g.vehicle.wheels.inContactCount,hud:g.store.getState().minigame}
    },mode)
    maxOff=Math.max(maxOff,s.off)
    if(s.state==='finished') {results.push({mode,ok:true,countdown,maxOff,...s});console.log('FINISHED',JSON.stringify(results.at(-1)));break}
    if(!['running','countdown'].includes(s.state)){results.push({mode,ok:false,...s});console.log('STOPPED',s);break}
    if(s.reached!==lastReached||Date.now()-lastLog>5000) {console.log(mode,JSON.stringify(s));lastReached=s.reached;lastLog=Date.now()}
    const wanted=[]
    if(s.speed>s.targetSpeed+1.2)wanted.push('KeyB')
    else if(s.speed<s.targetSpeed)wanted.push('KeyW')
    if(s.steer<-.075)wanted.push('KeyA');else if(s.steer>.075)wanted.push('KeyD')
    if(mode==='boost'&&Math.abs(s.error)<.12&&s.targetSpeed>13&&s.speed<17)wanted.push('ShiftLeft')
    await keys(wanted);await sleep(70)
    if(s.off>18||s.wheels===0)stalled++;else stalled=0
    if(stalled>100){results.push({mode,ok:false,reason:'driver left track',maxOff,...s});break}
  }
  await keys([])
  if(!results.some(r=>r.mode===mode)){results.push({mode,ok:false,reason:'timeout'});console.log('TIMEOUT',mode)}
  await page.screenshot({path:`${OUT}/${mode}.png`})
}
const saved=await page.evaluate(()=>{const g=window.__world;g.save.flush();return {best:g.minigames.get('circuit').bestTime,history:g.save.data.progress.raceHistory}})
await page.reload();await page.getByRole('button',{name:'ENTER',exact:true}).click({timeout:120000});await page.waitForFunction(()=>window.__world?.player?.state==='default')
const persistence=await page.evaluate(saved=>{const g=window.__world;return {ok:saved.best!==null&&g.minigames.get('circuit').bestTime===saved.best&&JSON.stringify(g.save.data.progress.raceHistory)===JSON.stringify(saved.history),best:g.minigames.get('circuit').bestTime,history:g.save.data.progress.raceHistory}},saved)
console.log('PERSISTENCE',persistence)
await writeFile(`${OUT}/continuous.json`,JSON.stringify({results,persistence,errors},null,2));await browser.close();process.exitCode=results.every(r=>r.ok)&&persistence.ok&&!errors.length?0:1
