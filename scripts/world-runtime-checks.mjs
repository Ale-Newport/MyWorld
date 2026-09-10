import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle']})
const page=await browser.newPage({viewport:{width:1440,height:900}}),results=[],errors=[]
const base=process.argv[2]??'http://localhost:3001'
page.on('pageerror',e=>errors.push(String(e)))
/* A version-1 blob from the island before it was redrawn, half of it naming
   places this world no longer has. Every pair below is one live id and one
   dead one, because the 2→3 migration has to do BOTH things: keep what the
   drawing kept and drop what it did not. The fixture this replaces seeded
   `notes:['legacy-note']` and `bestTimes:{chess:12.5}` and then asserted both
   SURVIVED — the exact opposite of what `migrateToDrawnIsland` is for, so it
   went red the moment the migration started working. */
const LEGACY={version:1,settings:{quality:'medium',muted:true,onboarded:true},progress:{
  notes:['note-1','legacy-note'],districts:['landing','hub'],landmarks:['landing-name','archive-ring'],
  bestTimes:{bowling:12.5,chess:9.9},completedGames:['bowling','chess'],
  raceHistory:[131.2,104.5],achievements:{explorer:['landing','hub'],gymCircuit:1},
}}
await page.addInitScript(legacy=>{if(!localStorage.getItem('alejandro-world-save-v1'))localStorage.setItem('alejandro-world-save-v1',JSON.stringify(legacy))},LEGACY)
const boot=async()=>{await page.goto(`${base}/world`);await page.getByRole('button',{name:'ENTER',exact:true}).click({timeout:120000});await page.waitForFunction(()=>window.__world?.player?.state==='default')}
const wait=ms=>page.waitForTimeout(ms)
const rec=(name,data)=>{results.push({name,...data});console.log(JSON.stringify(results.at(-1)))}
const state=()=>page.evaluate(()=>{const g=window.__world,m=g.minigames.get('circuit');return {state:m.state,time:m.elapsed,reached:m.reached,countdown:m.countdown,position:{...g.player.position},enabled:g.vehicle.chassis.physical.body.isEnabled(),player:g.player.state,overlay:g.store.getState().overlay}})
const tap=async key=>{await page.keyboard.down(key);await wait(130);await page.keyboard.up(key)}
const drive=async(ms,boost=false)=>{await page.keyboard.down('KeyW');if(boost)await page.keyboard.down('ShiftLeft');await wait(ms);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.keyboard.down('KeyB');await wait(350);await page.keyboard.up('KeyB')}
async function fixture(index,side=0,reverse=false,height=2,distance=9){await page.evaluate(({index,side,reverse,height,distance})=>{const g=window.__world,m=g.minigames.get('circuit'),gate=m.gates[index],n=gate.normal,c=gate.centre,sign=reverse?1:-1;const x=c.x+n.x*distance*sign-n.y*side,z=c.z+n.y*distance*sign+n.x*side;g.vehicle.moveTo({x,y:g.terrain.colliderHeightAt(x,z)+height,z},gate.rotation+(reverse?Math.PI:0));g.view.focusPoint.trackedPosition.set(x,c.y+height,z);g.view.snapToTarget()}, {index,side,reverse,height,distance});await wait(height>5?50:600)}
await boot()
/* The track and the island, read off the running world once. Every fixture
   below used to carry its own numbers: the pass mark for "outside the gate"
   was a literal 11 against a gate that is 14 m wide, the frame-rate sample
   was taken at (-221,30) — 42 m past the waterline, on the sea bed — and
   "leave the race area" drove to (0,26), which on this island is 1.7 m from
   the racing line and so never strays at all. */
const track=await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('circuit'),geo=g.geography
  const district=id=>{const z=g.zones.items.find(z=>z.id===`district-${id}`);return {x:z.position.x,z:z.position.z}}
  // The furthest district centre from the racing line, which is what a
  // cancel-on-stray test needs and what the drawing is free to move.
  const far=g.zones.items.filter(z=>z.id.startsWith('district-'))
    .map(z=>({id:z.id.slice(9),x:z.position.x,z:z.position.z,distance:geo.lineDistance(z.position.x,z.position.z,geo.CIRCUIT_TRACK)}))
    .sort((a,b)=>b.distance-a.distance)[0]
  return {gates:m.gates.length,expected:geo.CIRCUIT.gates,laps:geo.CIRCUIT.laps,halfWidth:m.gates[0].halfWidth,
    spacing:Math.hypot(m.gates[1].centre.x-m.gates[0].centre.x,m.gates[1].centre.z-m.gates[0].centre.z),
    // The busiest ground in the world and the one every visitor lands on:
    // a frame budget measured anywhere else is a view nobody has first.
    viewpoint:district('landing'),far}})
/* The precondition for every fixture below, rather than a count for its own
   sake: `skip-rejected` puts the car 9 m short of gate 1 and `boost-sweep`
   puts it 12 m short of gate 0, so consecutive gates have to be further apart
   than that or those fixtures are standing on the gate they mean to skip. The
   gate count was hard-coded as twelve in eleven places once; it is data now,
   and this is the one place that checks the data against what was built. */
rec('gate-data',{ok:track.gates===track.expected&&track.spacing>14,...track})
rec('legacy-save',await page.evaluate(()=>{const p=window.__world.save.data.progress,s=window.__world.save.data
  const kept=p.notes.includes('note-1')&&p.districts.includes('landing')&&p.landmarks.includes('landing-name')
    &&p.bestTimes.bowling===12.5&&p.completedGames.includes('bowling')
  const dropped=!p.notes.includes('legacy-note')&&!p.districts.includes('hub')&&!p.landmarks.includes('archive-ring')
    &&p.bestTimes.chess===undefined&&!p.completedGames.includes('chess')&&p.achievements.gymCircuit===undefined
    &&Array.isArray(p.achievements.explorer)&&!p.achievements.explorer.includes('hub')
  // 1 → 2 as well as 2 → 3: a bare list of times becomes a dated board, with
  // `at: 0` standing for "before this site kept dates".
  const board=p.raceBoard.length===2&&p.raceBoard[0].time===104.5&&p.raceBoard.every(e=>e.at===0)
  return {ok:kept&&dropped&&board&&s.version>1,version:s.version,kept,dropped,board,notes:p.notes,bestTimes:p.bestTimes,raceBoard:p.raceBoard}}))
await page.evaluate(()=>window.__world.minigames.start('circuit'));await wait(1000)
await page.keyboard.down('KeyW');await wait(300);await page.keyboard.up('KeyW')
rec('countdown-lock',{ok:(await state()).reached===0&&(await state()).state==='countdown',...await state()})
await tap('Escape');await wait(150);const before=await state();await wait(900);const during=await state()
rec('countdown-pause',{ok:before.countdown===during.countdown&&!during.enabled,before,during})
await tap('Escape');await wait(2100)
await fixture(0,0,true);await drive(1100);rec('reverse-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(1);await drive(1100);rec('skip-rejected',{ok:(await state()).reached===0,...await state()})
/* Eight hundred milliseconds and six metres of margin, not eleven hundred and
   four. The lap is 633 m over 24 gates, so they are 26 m apart rather than 40:
   a car that drives for 1.1 s from nine metres in front of one gate reaches
   the run-off of the next and slides back onto the racing line inside its
   width, which is a legal crossing and made both of these report a gate they
   had not been given. */
await fixture(0,track.halfWidth+6);await drive(800);rec('outside-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(0,0,false,24,9);await drive(800);rec('overhead-rejected',{ok:(await state()).reached===0,...await state()})
await fixture(0,0,false,2,12);await drive(1150,true);rec('boost-sweep',{ok:(await state()).reached>0,...await state()})
const reached=(await state()).reached;await tap('KeyR');await wait(500);rec('checkpoint-recovery',{ok:(await state()).reached===reached&&(await state()).state==='running',...await state()})
await drive(250);await tap('Escape');await wait(100);const paused=await state();await wait(850);const held=await state()
rec('race-pause',{ok:paused.time===held.time&&Math.hypot(paused.position.x-held.position.x,paused.position.z-held.position.z)<.001,paused,held})
await tap('Escape');await wait(500);rec('race-resume',{ok:(await state()).enabled&&(await state()).time-held.time<.85,...await state()})
await page.getByRole('button',{name:'Restart',exact:true}).click();await wait(250);rec('restart',{ok:(await state()).reached===0&&(await state()).state==='countdown',...await state()})
await page.getByRole('button',{name:'Exit game',exact:true}).click();await wait(200);rec('exit',{ok:(await state()).player==='default'&&(await state()).enabled,...await state()})
// The race strays at `CircuitRace.strayRadius` from the RACING LINE, not from
// a world origin, so the fixture has to be the furthest named place from it
// rather than a number. The radius is READ from the game: it was 110 on a
// 380 m island and is 77 on a 266 m one, and a copy here would have gone
// green while testing nothing.
await page.evaluate(far=>{const g=window.__world;g.minigames.start('circuit');g.vehicle.moveTo({x:far.x,y:g.terrain.colliderHeightAt(far.x,far.z)+3,z:far.z},0)},track.far);await wait(350)
// `far.distance > 110` is part of the assertion, not decoration: if the
// drawing ever pulls every district inside the stray radius this fixture stops
// testing anything and has to say so rather than quietly going green.
const strayRadius=await page.evaluate(()=>window.__world.minigames.get('circuit').strayRadius)
rec('leave-race-area',{ok:track.far.distance>strayRadius&&(await state()).state==='idle'&&(await state()).player==='default'&&(await state()).enabled,far:track.far,strayRadius,...await state()})
// Force bad storage only in this disposable browser context, never the user's.
// The world has to be torn down FIRST: `Save.schedule` debounces its writes by
// 700 ms, so a live world put the migrated blob straight back over the garbage
// while the next navigation was still in flight, and the "corrupt" boot below
// was reading a perfectly good save.
await page.goto(base);await wait(900)
await page.evaluate(()=>localStorage.setItem('alejandro-world-save-v1','{broken json'))
/* `version===1` was the old assertion, and SAVE_VERSION is 3: it was reading
   the number the fixture wrote rather than the one `defaults()` rebuilds with,
   so it went red the moment the save format moved. What actually has to hold
   is that garbage produces a FRESH blob — the world boots, the version is a
   real one, and none of the previous session's progress is resurrected. */
await boot();rec('corrupt-save-recovery',await page.evaluate(()=>{const s=window.__world.save.data
  return {ok:!!window.__world.player&&Number.isInteger(s.version)&&s.version>=1
    &&Object.keys(s.progress.bestTimes).length===0&&s.progress.notes.length===0&&s.progress.raceBoard.length===0,
    version:s.version,progress:{notes:s.progress.notes.length,bestTimes:Object.keys(s.progress.bestTimes).length,raceBoard:s.progress.raceBoard.length}}}))
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
  await page.evaluate(({quality,at})=>{const g=window.__world;g.quality.setPreference(quality);const y=g.terrain.colliderHeightAt(at.x,at.z);g.vehicle.moveTo({x:at.x,y:y+2,z:at.z},0);g.view.focusPoint.trackedPosition.set(at.x,y+1,at.z);g.view.snapToTarget();g.__samples=[];g.__gpu=[]},{quality,at:track.viewpoint})
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
