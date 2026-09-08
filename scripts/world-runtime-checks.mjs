import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle']})
const page=await browser.newPage({viewport:{width:1440,height:900}}),results=[],errors=[]
const base=process.argv[2]??'http://localhost:3001'
page.on('pageerror',e=>errors.push(String(e)))
await page.addInitScript(()=>{if(!localStorage.getItem('alejandro-world-save-v1'))localStorage.setItem('alejandro-world-save-v1',JSON.stringify({version:1,settings:{quality:'medium',muted:true,onboarded:true},progress:{notes:['legacy-note'],bestTimes:{chess:12.5},districts:['hub']}}))})
const boot=async()=>{await page.goto(`${base}/world`);await page.getByRole('button',{name:'ENTER',exact:true}).click({timeout:120000});await page.waitForFunction(()=>window.__world?.player?.state==='default')}
const wait=ms=>page.waitForTimeout(ms)
const rec=(name,data)=>{results.push({name,...data});console.log(JSON.stringify(results.at(-1)))}
const state=()=>page.evaluate(()=>{const g=window.__world,m=g.minigames.get('circuit');return {state:m.state,time:m.elapsed,reached:m.reached,countdown:m.countdown,position:{...g.player.position},enabled:g.vehicle.chassis.physical.body.isEnabled(),player:g.player.state,overlay:g.store.getState().overlay}})
const tap=async key=>{await page.keyboard.down(key);await wait(130);await page.keyboard.up(key)}
const drive=async(ms,boost=false)=>{await page.keyboard.down('KeyW');if(boost)await page.keyboard.down('ShiftLeft');await wait(ms);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.keyboard.down('KeyB');await wait(350);await page.keyboard.up('KeyB')}
async function fixture(index,side=0,reverse=false,height=2,distance=9){await page.evaluate(({index,side,reverse,height,distance})=>{const g=window.__world,m=g.minigames.get('circuit'),gate=m.gates[index],n=gate.normal,c=gate.centre,sign=reverse?1:-1;const x=c.x+n.x*distance*sign-n.y*side,z=c.z+n.y*distance*sign+n.x*side;g.vehicle.moveTo({x,y:g.terrain.colliderHeightAt(x,z)+height,z},gate.rotation+(reverse?Math.PI:0));g.view.focusPoint.trackedPosition.set(x,c.y+height,z);g.view.snapToTarget()}, {index,side,reverse,height,distance});await wait(height>5?50:600)}
await boot()
rec('legacy-save',await page.evaluate(()=>{const s=window.__world.save.data;return {ok:s.progress.notes.includes('legacy-note')&&s.progress.bestTimes.chess===12.5&&Array.isArray(s.progress.completedGames)&&Array.isArray(s.progress.raceHistory)}}))
await page.evaluate(()=>window.__world.minigames.start('circuit'));await wait(1000)
await page.keyboard.down('KeyW');await wait(300);await page.keyboard.up('KeyW')
rec('countdown-lock',{ok:(await state()).reached===0&&(await state()).state==='countdown',...await state()})
await tap('Escape');await wait(150);const before=await state();await wait(900);const during=await state()
rec('countdown-pause',{ok:before.countdown===during.countdown&&!during.enabled,before,during})
await tap('Escape');await wait(2100)
await fixture(0,0,true);await drive(1100);rec('reverse-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(1);await drive(1100);rec('skip-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(0,11);await drive(1100);rec('outside-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(0,0,false,24,9);await drive(1100);rec('overhead-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(0,0,false,2,12);await drive(1150,true);rec('boost-sweep',{ok:(await state()).reached>0,...await state()})
const reached=(await state()).reached;await tap('KeyR');await wait(500);rec('checkpoint-recovery',{ok:(await state()).reached===reached&&(await state()).state==='running',...await state()})
await drive(250);await tap('Escape');await wait(100);const paused=await state();await wait(850);const held=await state()
rec('race-pause',{ok:paused.time===held.time&&Math.hypot(paused.position.x-held.position.x,paused.position.z-held.position.z)<.001,paused,held})
await tap('Escape');await wait(500);rec('race-resume',{ok:(await state()).enabled&&(await state()).time-held.time<.85,...await state()})
await page.getByRole('button',{name:'Restart',exact:true}).click();await wait(250);rec('restart',{ok:(await state()).reached===0&&(await state()).state==='countdown',...await state()})
await page.getByRole('button',{name:'Exit game',exact:true}).click();await wait(200);rec('exit',{ok:(await state()).player==='default'&&(await state()).enabled,...await state()})
await page.evaluate(()=>{const g=window.__world;g.minigames.start('circuit');g.vehicle.moveTo({x:0,y:3,z:26},0)});await wait(350)
rec('leave-race-area',{ok:(await state()).state==='idle'&&(await state()).player==='default'&&(await state()).enabled,...await state()})
// Force bad storage only in this disposable browser context, never the user's.
await page.evaluate(()=>localStorage.setItem('alejandro-world-save-v1','{broken json'))
await boot();rec('corrupt-save-recovery',await page.evaluate(()=>({ok:!!window.__world.player&&window.__world.save.data.version===1})))
// Count all render passes, not only the final two-triangle composite.
const cdp=await page.context().newCDPSession(page),trace=[]
await cdp.send('Performance.enable')
cdp.on('Tracing.dataCollected',({value})=>trace.push(...value))
await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,disabled-by-default-v8.gc,gpu',transferMode:'ReportEvents'})
await page.evaluate(()=>{
  const g=window.__world,r=g.renderer.instance;r.info.autoReset=false
  const gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),queries=[]
  g.__samples=[];g.__gpu=[];g.__gpuAvailable=!!ext
  let query=null
  const begin=()=>{r.info.reset();if(ext&&queries.length<8){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}}
  const end=()=>{
    if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(query);query=null}
    if(ext)for(let i=queries.length-1;i>=0;i--)if(gl.getQueryParameter(queries[i],gl.QUERY_RESULT_AVAILABLE)){
      if(!gl.getParameter(ext.GPU_DISJOINT_EXT)){g.__gpu.push(gl.getQueryParameter(queries[i],gl.QUERY_RESULT)/1e6);if(g.__gpu.length>200)g.__gpu.shift()}
      gl.deleteQuery(queries[i]);queries.splice(i,1)
    }
    g.__samples.push({ms:g.ticker.delta*1000,calls:r.info.render.calls,triangles:r.info.render.triangles});if(g.__samples.length>200)g.__samples.shift()
  }
  g.ticker.events.on('tick',begin,0);g.ticker.events.on('tick',end,999)
  g.bin.add(()=>{g.ticker.events.off('tick',begin);g.ticker.events.off('tick',end);for(const q of queries)gl.deleteQuery(q)})
})
for(const quality of ['low','medium','high']) {
  await page.evaluate(quality=>{const g=window.__world;g.quality.setPreference(quality);g.vehicle.moveTo({x:-221,y:g.terrain.colliderHeightAt(-221,30)+2,z:30},0);g.view.focusPoint.trackedPosition.set(-221,1,30);g.view.snapToTarget();g.__samples=[];g.__gpu=[]},quality)
  const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
  await wait(4500)
  const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
  rec(`performance-${quality}`,{...await page.evaluate(()=>{const g=window.__world,s=g.__samples.slice(-150),sorted=s.map(s=>s.ms).sort((a,b)=>a-b),gpu=g.__gpu.slice(-150).sort((a,b)=>a-b);return {ok:sorted.length>20,fps:1000/(sorted.reduce((a,b)=>a+b,0)/sorted.length),p95ms:sorted[Math.floor(sorted.length*.95)],gpuP95ms:gpu.length?gpu[Math.floor(gpu.length*.95)]:null,gpuTimerAvailable:g.__gpuAvailable,drawCalls:Math.max(...s.map(s=>s.calls)),triangles:Math.max(...s.map(s=>s.triangles)),bodies:g.physics.physicals.length,activeTrunks:g.ecology.stats.activeColliders,geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures}}),scriptCpuMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskCpuMs:(after.TaskDuration-before.TaskDuration)*1000,heapMB:after.JSHeapUsedSize/1048576})
}
const traced=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await traced
await mkdir('.qa/runtime',{recursive:true});await writeFile('.qa/runtime/performance-trace.json',JSON.stringify({traceEvents:trace}))
const gc=trace.filter(e=>e.ph==='X'&&/MinorGC|MajorGC|V8.GC/.test(e.name)&&e.dur)
rec('gc-profile',{ok:true,slices:gc.length,longestSliceMs:Math.max(0,...gc.map(e=>e.dur/1000))})
await page.goto(base);await wait(800);rec('unmount',await page.evaluate(()=>({ok:!window.__world})))
await boot();rec('remount',await page.evaluate(()=>({ok:window.__world.player.state==='default',bodies:window.__world.physics.physicals.length})))
await mkdir('.qa/runtime',{recursive:true});await writeFile('.qa/runtime/results.json',JSON.stringify({results,errors},null,2));await browser.close();process.exitCode=results.every(r=>r.ok)&&!errors.length?0:1
