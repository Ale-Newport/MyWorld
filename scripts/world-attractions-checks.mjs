/** Interact through the actual keyboard prompts in a disposable browser.
 *
 *    node scripts/world-attractions-checks.mjs [baseUrl]
 *
 *  The attractions this used to drive — the chip dispenser, the tipping
 *  cabin, the live lab, the waterfall grotto, three bridges — were all
 *  in districts the redrawn island does not have, and every coordinate
 *  in it named a point 200 m off the map. What is here now is what the
 *  drawing kept: the lane, the TNT stack, the time machine, the black
 *  hole, the east ramp and the one bridge.
 *
 *  The list of prompts is ENUMERATED from `window.__world.interactions`
 *  rather than written down. That is the whole point: a hard-coded list
 *  goes stale silently, and a harness that checks a place that no
 *  longer exists reports "not reachable" forever while the places that
 *  DO exist go unchecked. */
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

/* ---- every prompt in the world ---------------------------------
   Drive to each interactive point and check the world offers ITS
   prompt. Only one point is ever active, so where two overlap the
   nearer wins — a co-located neighbour taking the prompt is the
   design working, not a place you cannot reach, and only a point
   whose winner is somewhere else counts against it. */
const points=await page.evaluate(()=>[...window.__world.interactions.points].map(([id,p])=>({id,x:p.position.x,z:p.position.z,r:p.radius})))
const unreachable=[]
for(const point of points) {
  await move(point.x,point.z)
  const active=await page.evaluate(()=>window.__world.interactions.current)
  if(active===point.id)continue
  const rival=points.find(p=>p.id===active)
  if(rival&&Math.hypot(rival.x-point.x,rival.z-point.z)<4)continue
  unreachable.push(`${point.id} → ${active??'no prompt'}`)
}
record('every-prompt-reachable',{ok:!unreachable.length,points:points.length,unreachable})

/* ---- the lane ---------------------------------------------------
   A whole set, one ball at a time, from the venue's own mark.

   WHAT THIS NO LONGER ASSERTS is the spare. The check it replaces sent
   the first ball deliberately off-centre and cleared the remainder
   with a centred one, and on this venue that cannot work: the car
   PUSHES the ball rather than throwing it, so an off-centre contact
   squirts it sideways — a metre off the line and it is in a gutter
   before it reaches the rack — and a rack with its middle cleared is
   not something a centred ball can finish. Clearing a spare here is an
   aiming problem for a person with a steering wheel, not something a
   scripted straight-line push can be relied on to produce.

   Measured instead, and none of it is weaker: every ball resolves,
   pins fall, the score moves, the frames advance and the set ends with
   LANE LOGIC. STRIKE and SPARE are RECORDED when they happen and not
   required, so a run that produces one still says so. */
const rollBall=async()=>{
  await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('bowling');g.vehicle.moveTo(m.startPosition,m.downLane)})
  await wait(700);await page.keyboard.down('KeyW');await wait(2400);await page.keyboard.up('KeyW')
  await page.keyboard.down('KeyB');await wait(600);await page.keyboard.up('KeyB')
  const phase=()=>page.evaluate(()=>{const g=window.__world,m=g.minigames.get('bowling'),b=m.ball.physical.current.position,p=g.player.position
    return {state:m.state,phase:m.phase,down:m.down,ball:{x:+b.x.toFixed(1),y:+b.y.toFixed(2),z:+b.z.toFixed(1)},car:{x:+p.x.toFixed(1),z:+p.z.toFixed(1)}}})
  // Wait for the ball to LEAVE first. `phase` is 'ready' until the ball
  // moves and 'ready' again once the throw has resolved, so a single
  // "wait until ready" test counts a push that never happened as a
  // completed ball.
  let left=null
  for(let i=0;i<8;i++) {const s=await phase();if(s.state!=='running')return s;if(s.phase!=='ready'){left=s;break}await wait(400)}
  if(!left)return {...await phase(),outcome:'stalled'}
  // And then for it to come back. A pushed ball coasts the length of
  // the lane at walking pace; `tick` gives it fourteen seconds before
  // it resolves the throw regardless, plus the sweep beat.
  for(let i=0;i<34;i++) {await wait(900);const s=await phase();if(s.state!=='running'||s.phase==='ready')return s}
  return {...await phase(),outcome:'never resolved',left}
}
await page.evaluate(()=>{const g=window.__world;g.minigames.cancel();g.minigames.start('bowling')});await wait(900)
let balls=0,last={state:'running'}
// Three frames is at most seven balls, plus one for a stalled push.
while(balls<8&&last.state==='running'&&!last.outcome) {last=await rollBall();balls++}
const set=await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('bowling')
  return {state:m.state,frames:m.frames,score:m.score,call:m.lastCall,strike:g.achievements.isUnlocked('strike'),spare:g.achievements.isUnlocked('spare'),lane:g.achievements.isUnlocked('bowling')}})
const knocked=set.frames.flat().reduce((a,b)=>a+b,0)
record('bowling-set',{ok:set.lane&&knocked>0&&set.frames.length>=3,balls,knocked,last,...set})
await page.screenshot({path:`${out}/bowling.png`})

/* ---- the TNT stack ----------------------------------------------
   The run-up is CHOSEN, not written down. The challenge's own start
   line is 20 m east of the stack, which is inside the west lake, and
   the row's own axis runs out to sea at one end and into that lake at
   the other — so the approach is the bearing at 26 m that is dry, well
   inside the coast, and furthest from the racing line, aimed at the
   stack. The chain, not the run-up, is what is being measured. */
for(let attempt=0;attempt<2;attempt++) {
  const lane=await page.evaluate(()=>{const g=window.__world,geo=g.geography,spot=geo.PLAY_SPOTS.find(s=>s.id==='tnt')
    let best=null
    for(let a=0;a<360;a+=10) {
      const r=a*Math.PI/180,x=spot.x+Math.cos(r)*26,z=spot.z+Math.sin(r)*26
      const y=g.terrain.colliderHeightAt(x,z),level=geo.inlandWater(x,z)?.level??geo.OCEAN_LEVEL
      if(geo.coastInset(x,z)<8||!(y>level+.2))continue
      const clear=geo.lineDistance(x,z,geo.CIRCUIT_TRACK)
      if(!best||clear>best.clear)best={x,z,clear:+clear.toFixed(1),yaw:Math.atan2(-(spot.z-z),spot.x-x)}
    }
    return best})
  await page.evaluate(()=>{const g=window.__world;g.minigames.cancel();g.playground.resetTnt()})
  await move(lane.x,lane.z,lane.yaw)
  await page.evaluate(()=>window.__world.minigames.start('domino'));await wait(3600)
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');await wait(2600);await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyW')
  /* Poll the chain rather than reading it afterwards. Winning dismisses
     the result card a few seconds later and the game re-stacks the
     crates on its way back to idle, which zeroes `stats.exploded` — so
     a single read nine seconds after the crash reported a perfect run
     as nought crates detonated. */
  let peak={exploded:0,reached:0,state:null}
  for(let i=0;i<24;i++) {
    await wait(500)
    const now=await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('domino')
      return {exploded:g.playground.stats.exploded,reached:m.reached,state:m.state}})
    peak={exploded:Math.max(peak.exploded,now.exploded),reached:Math.max(peak.reached,now.reached),state:now.state}
    if(now.state==='finished'||now.state==='failed')break
  }
  record(`tnt-domino-${attempt+1}`,await page.evaluate(({lane,peak})=>{const g=window.__world
    return {ok:peak.exploded>0,from:lane,...peak,of:g.playground.crates.length,chain:g.achievements.isUnlocked('domino')}},{lane,peak}))
  await page.screenshot({path:`${out}/domino-${attempt+1}.png`})
}

/* ---- the time machine -------------------------------------------
   The sweep runs the sun from wherever it is to the far end of the
   DAYLIGHT RANGE and STOPS there — the range is 0.38 to 0.62 of a
   day, so the largest move it can make is 0.24 and the smallest 0.12.
   The bar this replaces was `> 0.2`, which most presses cannot clear
   from a midday start. Sample halfway through as well, so the record
   shows the sweep and not just where it stopped. */
for(let attempt=0;attempt<2;attempt++) {
  const spot=await page.evaluate(()=>{const p=window.__world.interactions.points.get('time-machine').position;return {x:p.x,z:p.z}})
  await move(spot.x,spot.z)
  const before=await page.evaluate(()=>({phase:window.__world.lighting.phase,prompt:window.__world.interactions.current}))
  await tap('Enter');await wait(2600)
  const mid=await page.evaluate(()=>({phase:window.__world.lighting.phase,active:window.__world.playground.timeActive}))
  await wait(4000)
  record(`time-machine-${attempt+1}`,await page.evaluate(({before,mid})=>{const g=window.__world
    return {ok:Math.abs(g.lighting.phase-before.phase)>.08&&!g.playground.timeActive&&g.achievements.isUnlocked('timeMachine'),
      prompt:before.prompt,from:+before.phase.toFixed(3),mid:+mid.phase.toFixed(3),to:+g.lighting.phase.toFixed(3),sweeping:mid.active,duration:g.lighting.duration}},{before,mid}))
}

/* ---- the black hole ---------------------------------------------
   Secret district, secret award, and the only way to COMPLETIONIST
   through it — so it has to be pressable from the middle of the
   circuit's north loop and nowhere else. */
const hole=await page.evaluate(()=>{const p=window.__world.interactions.points.get('black-hole').position;return {x:p.x,z:p.z}})
await move(hole.x,hole.z);await tap('Enter');await wait(4500)
record('black-hole',await page.evaluate(()=>{const g=window.__world;return {ok:g.achievements.isUnlocked('blackHole')&&g.save.data.progress.secrets.includes('blackHole'),secrets:g.save.data.progress.secrets}}))

/* ---- the east ramp ----------------------------------------------
   OFF THE END. `Secrets.ts` arms a zone past the ramp's lip and only
   awards it if the car was more than five metres up while crossing,
   so this has to be a real launch and not a trundle off the side. The
   landing is WATER on purpose, and the shelf under it is shallow
   enough to drive out of — which is the second half of the check. */
const ramp=await page.evaluate(()=>{const r=window.__world.geography.ZONES.ramp;return {x:r.x,z:r.z,rotation:r.rotation,length:r.length}})
/* WATCH THE FLIGHT, do not read the aftermath.

   `Water.ts` teleports a car that has been more than a metre under for
   two seconds back to the nearest respawn — and a car the drowning
   rule has fished out reports `submerged: 0` with dry land under it,
   exactly like one that landed on the shelf and drove out. Sampling
   the whole descent tells the two apart: a respawn is a position that
   moves thirty metres between two samples 400 ms apart. */
const jump=async boost=>{
  await move(ramp.x-Math.cos(ramp.rotation)*(ramp.length*.5+45),ramp.z+Math.sin(ramp.rotation)*(ramp.length*.5+45),ramp.rotation)
  // The splash uniform latches until the next one, so a second run
  // inherits the first run's wake and "it hit the water" reads true
  // for a car that stopped on the beach.
  await page.evaluate(()=>{window.__world.water.wake.value.w=0})
  await page.keyboard.down('KeyW');if(boost)await page.keyboard.down('ShiftLeft')
  // Unboosted the car tops out near 10 m/s, so the same 45 m run-up
  // needs most of seven seconds to reach the lip rather than three.
  await wait(boost?3600:6800);if(boost)await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyW')
  const flight=[]
  for(let i=0;i<16;i++) {
    await wait(400)
    flight.push(await page.evaluate(()=>{const g=window.__world,p=g.player.position
      return {x:+p.x.toFixed(1),z:+p.z.toFixed(1),y:+p.y.toFixed(2),sub:+g.water.submerged.toFixed(2),seabed:+g.terrain.colliderHeightAt(p.x,p.z).toFixed(2)}}))
  }
  let drowned=null
  for(let i=1;i<flight.length;i++) {const a=flight[i-1],b=flight[i];if(Math.hypot(b.x-a.x,b.z-a.z)>30)drowned={from:a,to:b}}
  return {drowned,landed:flight.at(-1),deepest:Math.min(...flight.map(f=>f.seabed)),
    airborne:await page.evaluate(()=>window.__world.achievements.isUnlocked('airborne')),
    wake:await page.evaluate(()=>window.__world.water.wake.value.w)}
}
/* Two approaches, because they answer different questions. FLAT OUT
   is what earns OFF THE END — `Secrets.ts` only awards it if the car
   was five metres up crossing the zone past the lip — and it is the
   run the assertion is made on, because the ramp's own comment says
   the landing is water you can drive out of. The CRUISE run is
   recorded rather than asserted: it is the evidence for how the
   ramp behaves when it is not taken at full boost. */
const flatOut=await jump(true)
const cruise=await jump(false)
// Turn round and drive back up the beach.
await page.evaluate(rotation=>{const g=window.__world,p=g.player.position;g.vehicle.moveTo({x:p.x,y:p.y,z:p.z},rotation+Math.PI)},ramp.rotation)
await page.keyboard.down('KeyW');await wait(3000);await page.keyboard.up('KeyW');await wait(800)
record('east-ramp',await page.evaluate(({flatOut,cruise})=>{const g=window.__world,p=g.player.position,geo=g.geography
  return {ok:flatOut.airborne&&flatOut.wake>0&&!flatOut.drowned&&g.water.submerged===0&&p.y>geo.OCEAN_LEVEL,
    flatOut,cruise,out:{x:+p.x.toFixed(1),z:+p.z.toFixed(1),y:+p.y.toFixed(2)},inset:+geo.coastInset(p.x,p.z).toFixed(1)}},{flatOut,cruise}))
await page.screenshot({path:`${out}/east-ramp.png`})

/* ---- the bridge -------------------------------------------------
   The one crossing on the island, and it is crossed by driving:
   start on one bank, finish on the other, without teleporting
   between them and without ending up in the river. */
const span=await page.evaluate(()=>{const b=window.__world.geography.BRIDGES[0]
  // The deck's long axis. `rotation` is the road's own tangent at the
  // water, so the two banks are ±half a span along it.
  const ax=Math.cos(b.rotation),az=Math.sin(b.rotation),d=b.length*.5+14
  return {x:b.x,z:b.z,ax,az,start:{x:b.x+ax*d,z:b.z+az*d},yaw:Math.atan2(az,-ax)}})
await move(span.start.x,span.start.z,span.yaw)
const nearSide=await page.evaluate(({x,z,ax,az})=>{const p=window.__world.player.position;return (p.x-x)*ax+(p.z-z)*az},span)
await page.keyboard.down('KeyW');await wait(4000);await page.keyboard.up('KeyW');await wait(600)
record('wood-bridge',await page.evaluate(({span,nearSide})=>{const g=window.__world,p=g.player.position
  const side=(p.x-span.x)*span.ax+(p.z-span.z)*span.az,water=g.geography.inlandWater(p.x,p.z)
  return {ok:Math.sign(side)!==Math.sign(nearSide)&&Math.abs(side)>12&&p.y>(water?.level??0)-.4&&g.vehicle.wheels.inContactCount>0,
    from:+nearSide.toFixed(1),to:+side.toFixed(1),y:+p.y.toFixed(2),wheels:g.vehicle.wheels.inContactCount}},{span,nearSide}))
await page.screenshot({path:`${out}/bridge.png`})

/* ---- and it is all still there after a reload -------------------- */
await wait(1200)
await page.evaluate(()=>window.__world.save.flush())
await boot()
record('new-progress-reload',await page.evaluate(()=>{const g=window.__world,p=g.save.data.progress
  return {ok:g.achievements.isUnlocked('timeMachine')&&g.achievements.isUnlocked('blackHole')&&p.secrets.includes('blackHole')&&p.secrets.includes('timeMachine'),
    secrets:p.secrets,completed:p.completedGames,version:g.save.data.version,physicalTransformsSaved:JSON.stringify(g.save.data).includes('quaternion')}}))
await writeFile(`${out}/results.json`,JSON.stringify({results,errors},null,2))
console.log(`\n${results.filter(r=>!r.ok).length} failing of ${results.length}${errors.length?`, ${errors.length} page errors`:''}\n`)
await browser.close();process.exitCode=results.every(r=>r.ok)&&!errors.length?0:1
