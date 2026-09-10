/** Physical integration checks. Fixtures place the car at an approach; real
 * keyboard input then drives the impacts/crossings. No completion methods,
 * score mutations or achievement setters. Continuous race has its own script.
 *
 * NOTHING BELOW IS A HAND-TYPED WORLD COORDINATE. Districts come out of the
 * zone registry, venues out of `geography.PLAY_SPOTS`, the maze out of its own
 * two zones and the open sea out of `geography.coastRayDistance`. The version
 * this replaces named twelve places by literal — 'waterfall' at (-292,-57),
 * 'voxel-lab' at (67,-197) — and drove the domino run to (245,84), which is
 * sixty metres off the east coast of an island only 380 m wide. Every one of
 * those numbers came from a world that no longer exists, and a harness that
 * carries its own copy of the map stops measuring the moment the map moves.
 *
 * The circuit is deliberately absent: `world-runtime-checks.mjs` owns the gate
 * rules and `world-race-drive.mjs` owns the lap, and a third script driving the
 * same 954 m would be three places to fix when the track is re-traced. */
import {chromium} from 'playwright'
import {mkdir,stat,writeFile} from 'node:fs/promises'
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
const until=async(fn,arg,timeout=16000)=>{try{await page.waitForFunction(fn,arg,{timeout,polling:150});return true}catch{return false}}
/** Yaw that points a car sitting at `from` straight at `to`. Forward is
 *  (cos yaw, -sin yaw), which is the convention `approach` already assumed. */
const heading=(from,to)=>Math.atan2(from.z-to.z,to.x-from.x)
const move=async(x,z,yaw=0)=>{
  await page.evaluate(({x,z,yaw})=>{const g=window.__world,y=(g.physics.groundAt(x,z)??g.terrain.colliderHeightAt(x,z))+2;g.vehicle.moveTo({x,y,z},yaw);g.view.focusPoint.trackedPosition.set(x,y,z);g.view.snapToTarget()}, {x,z,yaw});await wait(650)
}
const drive=async(ms,boost=false)=>{await page.keyboard.down('KeyW');if(boost)await page.keyboard.down('ShiftLeft');await wait(ms);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft')}
const approach=async(p,distance=10,ms=1050)=>{const yaw=p.yaw??0;await move(p.x-Math.cos(yaw)*distance,p.z+Math.sin(yaw)*distance,yaw);await drive(ms)}
/** Places the car on the game's own start mark, aimed at whatever it is meant
 *  to be driven into, then starts through the manager. The mark's own Y is
 *  used verbatim: the bowling deck stands on a plinth above the natural
 *  ground, so recomputing the height from the terrain drops the car through
 *  the lane and into the foundation. */
const start=async(id,aim=null)=>{
  const mark=await page.evaluate(id=>{const p=window.__world.minigames.get(id).startPosition;return p?{x:p.x,y:p.y,z:p.z}:null},id)
  const yaw=mark&&aim?heading(mark,aim):0
  await page.evaluate(({id,mark,yaw})=>{
    const g=window.__world;g.minigames.cancel();g.store.getState().setOverlay(null)
    if(mark){g.vehicle.moveTo(mark,yaw);g.player.position.set(mark.x,mark.y,mark.z)}
    g.minigames.start(id)
  }, {id,mark,yaw});await wait(1000)}
const state=async id=>page.evaluate(id=>{const g=window.__world,m=g.minigames.get(id)
  const extra=id==='bowling'?{standing:m.standing.filter(Boolean).length,down:m.down,frame:m.frame,ball:m.ballNumber,score:m.score,phase:m.phase}
    :id==='domino'?{reached:m.reached,exploded:g.playground.crates.filter(c=>c.exploded).length}
    :id==='labyrinth'?{ratio:m.ratio}:{}
  return {state:m.state,elapsed:m.elapsed,hud:g.store.getState().minigame,car:{...g.player.position},...extra}},id)
const shot=async(name,x,z,radius=80)=>{await move(x,z);await page.evaluate(radius=>{const g=window.__world;g.view.spherical.radius.edges.min=radius;g.view.spherical.radius.edges.max=radius;g.view.zoom.baseRatio=0;g.view.zoom.smoothedRatio=0;g.view.snapToTarget()},radius);await wait(900);await page.screenshot({path:`${OUT}/${name}.png`})}

/* The map, read from the running world exactly once. Everything downstream
   is an offset from these, so re-tracing the island moves the harness with
   it instead of leaving it measuring empty sea. */
const map=await page.evaluate(()=>{
  const g=window.__world,geo=g.geography
  const zone=id=>{const z=g.zones.items.find(z=>z.id===id);return z?{x:z.position.x,z:z.position.z,radius:z.radius}:null}
  // Forty metres past the waterline is the threshold `Game` itself uses for
  // the OUT OF BOUNDS achievement; fifty-five puts the car past the shelf on
  // the first bearing that stays inside the heightfield. Bearings run
  // south-west first, away from the north-east bay and its islet.
  let sea=null
  for(const a of [Math.PI*.75,Math.PI*.62,Math.PI*.88,Math.PI*.5]) {
    const shore=geo.coastRayDistance(a),d=shore+55,x=Math.cos(a)*d,z=Math.sin(a)*d
    if(Math.abs(x)<235&&Math.abs(z)<235&&geo.coastInset(x,z)<-40){sea={x,z,inset:geo.coastInset(x,z),bearing:a,shore:{x:Math.cos(a)*shore,z:Math.sin(a)*shore}};break}
  }
  return {
    districts:g.zones.items.filter(z=>z.id.startsWith('district-')).map(z=>({id:z.id.slice(9),x:z.position.x,z:z.position.z,radius:z.radius})),
    spots:geo.PLAY_SPOTS.map(s=>({id:s.id,x:s.x,z:s.z,radius:s.radius})),
    /* Water gets its own frames. The old list had a 'lake' and a 'bridge'
       shot and neither has a district or a play spot to hang off, so without
       these two the only water in the set would be whatever wandered into a
       district frame. A lake body is several overlapping ellipses; the frame
       is the box that holds all of them. */
    lakes:geo.LAKE_BODIES.map(b=>{
      const cx=b.ellipses.reduce((t,e)=>t+e.x,0)/b.ellipses.length,cz=b.ellipses.reduce((t,e)=>t+e.z,0)/b.ellipses.length
      return {id:b.id,x:cx,z:cz,radius:Math.max(...b.ellipses.map(e=>Math.max(Math.abs(e.x-cx)+e.rx,Math.abs(e.z-cz)+e.rz)))}
    }),
    bridges:geo.BRIDGES.map(b=>({id:b.road,x:b.x,z:b.z,radius:b.length*0.8})),
    maze:{...geo.ZONES.maze,mouth:zone('labyrinth-mouth'),centre:zone('labyrinth-centre')},
    landing:(()=>{const z=g.zones.items.find(z=>z.id==='district-landing');return {x:z.position.x,z:z.position.z}})(),
    sea,
  }
})
const selected=process.env.POLISH_TESTS?.split(',')??['terrain','visual','bowling','domino','labyrinth','name','water','reset']

/* Six probes, none on the grid diagonal and none symmetric: three TRANSPOSED
   PAIRS, which is the only shape of fixture that can catch the heightfield
   being uploaded rows-for-columns — `Terrain.buildCollider` transposes on
   purpose and says a raycast fixture verifies it. Each probe therefore checks
   two things: that the sampler agrees with the ray to 0.18 m, and that its
   MIRROR reads at least a metre different, because a probe where h(x,z) and
   h(z,x) happen to match is a probe that would pass a transposed upload.
   They sat at ±280 and ±292, outside a field whose half-extent dropped from
   290 to 250 when the void island went. Four of the six then compared a
   clamped edge value against a mesh that stops at 250 and reported a 100 m
   disagreement about ground that does not exist. */
if(selected.includes('terrain'))record('terrain',await page.evaluate(()=>{const g=window.__world,c=g.physics.physicals[0].colliders[0];/* Inside FIELD_HALF, which is 175 now and was 250: at (-204, 53) the
     ray misses the heightfield entirely and the check compares a
     sampled height against the 60 m the ray started at. Still three
     TRANSPOSED PAIRS, still asymmetric and off-axis — a probe where
     h(x,z) equals h(z,x) would pass a transposed heightfield. */
  const probes=[[-143,37],[37,-143],[-116,26],[26,-116],[92,-62],[-62,92]].map(([x,z])=>{let toi=c.castRay(new g.physics.rapier.Ray({x,y:60,z},{x:0,y:-1,z:0}),200,true);if(toi<0)toi=c.castRay(new g.physics.rapier.Ray({x,y:60,z:z+.001},{x:0,y:-1,z:0}),200,true);const height=60-toi;return {x,z,visual:g.terrain.colliderHeightAt(x,z),physical:height,transposed:g.terrain.colliderHeightAt(z,x)}});return {ok:probes.every(p=>Math.abs(p.visual-p.physical)<.18&&Math.abs(p.visual-p.transposed)>1),probes,ecology:g.ecology.stats,bodies:g.physics.physicals.length}}))

if(selected.includes('visual')) {
  /* One shot per named place, framed from its own radius. A play spot that
     sits on a district centre — tnt, timeMachine and blackHole all do — would
     only re-photograph the same ground, so it is dropped; the bowling venue
     stands off its district's middle and keeps a frame of its own. */
  const frame=r=>Math.round(Math.min(170,Math.max(70,r*2.4)))
  const places=[
    ...map.districts.map(d=>({name:`district-${d.id}`,x:d.x,z:d.z,radius:frame(d.radius)})),
    ...map.spots.filter(s=>!map.districts.some(d=>Math.hypot(d.x-s.x,d.z-s.z)<6)).map(s=>({name:`venue-${s.id}`,x:s.x,z:s.z,radius:frame(s.radius)})),
    ...map.lakes.map(l=>({name:`water-${l.id}`,x:l.x,z:l.z,radius:frame(l.radius)})),
    ...map.bridges.map(b=>({name:`bridge-${b.id}`,x:b.x,z:b.z,radius:frame(b.radius)})),
  ]
  for(const p of places)await shot(p.name,p.x,p.z,p.radius)
  await shot('driving-view',map.landing.x,map.landing.z,44)
  /* Counting the shots proves nothing — a black frame is still a file. Size
     is the cheap stand-in for "something was drawn": these are 1440x900 PNGs
     of a lit scene and the smallest of them runs to hundreds of kilobytes,
     while a frame captured before the renderer had anything in it is a few. */
  const sizes=Object.fromEntries(await Promise.all(places.map(async p=>[p.name,await stat(`${OUT}/${p.name}.png`).then(s=>s.size).catch(()=>0)])))
  record('visual',{ok:Object.values(sizes).every(s=>s>20000),shots:places.map(p=>`${p.name}@${p.radius}`),sizes})
  await page.keyboard.press('KeyM');await wait(600);await page.screenshot({path:`${OUT}/map.png`});await page.keyboard.press('Escape');await page.evaluate(()=>window.__world.store.getState().setOverlay(null))
}

if(selected.includes('bowling')) {
  /* The lane runs EAST TO WEST with the pins at the west end and the mark
     34 m up-lane of the venue origin, so the whole throw is one drive due
     west into a stationary ball. The version this replaces drove at a
     hard-coded (-79,29) and pressed B, which was a handbrake at a venue that
     had moved 130 m south and turned ninety degrees. */
  const spot=map.spots.find(s=>s.id==='bowling')
  const pins={x:spot.x-3.6,z:spot.z}
  for(let attempt=0;attempt<2;attempt++) {
    await start('bowling',pins)
    const balls=[]
    for(let ball=0;ball<9;ball++) {
      if(!await until(id=>{const m=window.__world.minigames.get(id);return m.phase==='ready'||m.state==='finished'},'bowling',12000))break
      if((await state('bowling')).state==='finished')break
      await drive(1250)
      // Two waits, not one. The ball leaving home is what puts the game
      // into 'rolling', and reading `standing` before that happens reads
      // the rack the last ball left behind.
      await until(id=>window.__world.minigames.get(id).phase!=='ready','bowling',7000)
      await until(id=>{const m=window.__world.minigames.get(id);return m.phase==='ready'||m.state==='finished'},'bowling',20000)
      const s=await state('bowling');balls.push({ball,standing:s.standing,score:s.score,frame:s.frame})
      console.log('bowling-ball',JSON.stringify(balls.at(-1)))
      if(s.state==='finished')break
    }
    const s=await state('bowling'),frames=await page.evaluate(()=>window.__world.minigames.get('bowling').frames)
    /* The score is the assertion, not the state: a set that ends with
       every ball a gutter also reads 'finished'. */
    record(`bowling-${attempt+1}`,{ok:s.state==='finished'&&s.score>0,balls,frames,...s})
    await page.screenshot({path:`${OUT}/bowling-${attempt+1}.png`})
    await page.getByRole('button',{name:'Exit game',exact:true}).click().catch(()=>{});await page.evaluate(()=>window.__world.minigames.cancel());await move(map.landing.x,map.landing.z)
  }
}

if(selected.includes('domino')) {
  /* Eighteen crates in two rows on the infield verge beside the west run.
     The run-up is the game's OWN start mark, 20 m up the near row, and
     lengthening it is not an option: the ground twenty metres further east
     is the west lake, three metres under water. A fixture placed there sank
     the car, respawned it at the circuit and cancelled the run before the
     countdown had finished, which reads as "the domino chain is broken".
     The mark is enough — a fuse needs a 42 N impulse and boost from
     standstill clears the five metres to the first crate with room. */
  const stack=map.spots.find(s=>s.id==='tnt')
  for(let attempt=0;attempt<2;attempt++) {
    await start('domino',stack)
    await wait(3400) // the three-second lead-in, plus a beat to settle
    await drive(1500,true)
    await until(id=>window.__world.minigames.get(id).state!=='running','domino',20000)
    const s=await state('domino');record(`domino-${attempt+1}`,{ok:s.state==='finished'&&s.exploded>0,...s})
    await page.screenshot({path:`${OUT}/domino-${attempt+1}.png`})
    await page.getByRole('button',{name:'Exit game',exact:true}).click().catch(()=>{});await page.evaluate(()=>window.__world.minigames.cancel());await move(map.landing.x,map.landing.z)
  }
}

if(selected.includes('labyrinth')) {
  /* Four physical claims, all of them the maze's own. The walls are 1.2 m
     thick and the file that builds them argues at length that a boosting car
     cannot tunnel one, so: boost in through the mouth and check the car is
     still inside the footprint afterwards. Corridors came down from 7 m to
     5.2 m in the 7x7 rebuild, so a car boosting for 2.3 s now meets the far
     wall of the first corridor about seven metres in rather than nine — the
     hardest version of the same claim, which is why the boost stayed.

     And the run is started by driving ACROSS the mouth zone, not by a button
     — with the mouth zone down from 5 m to 2.2 m so the clock starts at the
     threshold rather than five metres short of it, this is now also the check
     that a tight trigger cannot be sampled straight past. The state is
     asserted as 'running' and not merely 'not idle', because the 3-2-1 was
     removed by dropping `leadIn` and a 'countdown' here would mean it is back.

     WHICH SIDE THE MOUTH IS ON IS NOT WRITTEN HERE. It used to be — the
     approach was `mouth.z + 14`, the +Z side — and when the generator moved
     its opening to the north face (the old one came out three metres from
     the waterline) this drove at the back wall, bounced off and reported the
     walls as broken because the car ended up a hundred and thirty metres
     away. The mouth's own offset from the centre says which face it is. */
  const {mouth,centre,size,rotation=0}=map.maze
  const half=size/2+3
  const cos=Math.cos(rotation),sin=Math.sin(rotation)
  const mx=mouth.x-map.maze.x,mz=mouth.z-map.maze.z
  const reach=Math.hypot(mx,mz)||1
  const from={x:mouth.x+mx/reach*14,z:mouth.z+mz/reach*14}
  await page.evaluate(()=>window.__world.minigames.cancel())
  await move(from.x,from.z,heading(from,mouth))
  await drive(2300,true);await wait(900)
  const entered=await state('labyrinth')
  /* Measured in the maze square's own frame — the inverse of the `rectangle`
     helper in `world-environment.ts` — because ZONES.maze carries a rotation
     and an axis-aligned box would start lying the day it stops being zero.
     The face the mouth is cut in is excluded: being shoved back out the way
     you came is the walls working, not a car through one. The other three
     are solid boundary wall for their whole length. */
  const mlx=mx*cos+mz*sin,mlz=-mx*sin+mz*cos
  const face=Math.abs(mlz)>=Math.abs(mlx)?{x:0,z:Math.sign(mlz)}:{x:Math.sign(mlx),z:0}
  const dx=entered.car.x-map.maze.x,dz=entered.car.z-map.maze.z
  const lx=dx*cos+dz*sin,lz=-dx*sin+dz*cos
  const escaped=(face.z!==-1&&lz<-half)||(face.z!==1&&lz>half)||(face.x!==-1&&lx<-half)||(face.x!==1&&lx>half)
  record('labyrinth-walls',{ok:entered.state==='running'&&!escaped,escaped,local:{lx,lz},footprint:{x:map.maze.x,z:map.maze.z,size,rotation},...entered})
  await page.screenshot({path:`${OUT}/labyrinth-mouth.png`})

  /* THE RESTART, which half the brief for this mode turns on: pressing ENTER
     at the mark while a run is live has to put the car back on the mark with
     the clock at zero — and has to do it from the prompt only, never from
     `reset` or `cancel`, which the manager fires for opening the map. The
     fixture drives a live run in, then teleports four metres to one side of
     the mark: inside the prompt's 7 m radius so the key reaches the point,
     and about nine metres from the run's origin against a 66 m abandon
     radius, so the run is still live when it lands. */
  const mark=await page.evaluate(()=>{const p=window.__world.minigames.get('labyrinth').startPosition;return {x:p.x,y:p.y,z:p.z}})
  const live=await state('labyrinth')
  await move(mark.x+4,mark.z,0);await wait(500)
  await page.keyboard.press('Enter');await wait(1000)
  const back=await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('labyrinth')
    return {state:m.state,elapsed:m.elapsed,gap:Math.hypot(g.player.position.x-m.startPosition.x,g.player.position.z-m.startPosition.z)}})
  record('labyrinth-restart',{ok:live.state==='running'&&back.state==='running'&&back.gap<3&&back.elapsed<2,live,back,mark})

  /* The last corridor before the centre, read off the game's own flood fill:
     distance 0 is the centre cell, 1 the gap in its wall, 2 the corridor
     that opens onto it. Driving that crossing is what proves the centre
     zone still fires and still ends the run. On seed 5236 the middle is a
     one-way chamber, so there is exactly one such cell. */
  const last=await page.evaluate(()=>{const m=window.__world.minigames.get('labyrinth'),w=m.xAxis.centre.length
    for(let i=0;i<m.distance.length;i++)if(m.distance[i]===2){const gx=i%w,gz=(i-gx)/w;return {x:m.centre.x+m.xAxis.centre[gx],z:m.centre.z+m.zAxis.centre[gz]}}
    return null})
  if(last) {
    await move(last.x,last.z,heading(last,centre));await drive(1100)
    await until(()=>window.__world.minigames.get('labyrinth').state==='finished',null,8000)
  }
  const done=await state('labyrinth')
  /* Finishing sends the car home too, on a 1.2 s delay so the confetti lands
     at the fountain first. Two and a bit seconds is past that and well short
     of the 5 s the result card takes to dismiss itself. */
  await wait(2300)
  const home=await page.evaluate(()=>{const g=window.__world,m=g.minigames.get('labyrinth')
    return {state:m.state,gap:Math.hypot(g.player.position.x-m.startPosition.x,g.player.position.z-m.startPosition.z)}})
  record('labyrinth-centre',{ok:done.state==='finished'&&home.gap<6,last,home,...done})
  await page.screenshot({path:`${OUT}/labyrinth-centre.png`})
  await page.getByRole('button',{name:'Exit game',exact:true}).click().catch(()=>{});await page.evaluate(()=>window.__world.minigames.cancel());await move(map.landing.x,map.landing.z)
}

if(selected.includes('name')) {
  /* Sixteen movable letters at the LANDING, knocked flat with the car. The
     count is asserted as well as the state: on an empty list `every` is
     vacuously true, which is a green tick for a playground that was never
     built. */
  await page.evaluate(()=>window.__world.playground.resetName());await wait(1000)
  const letters=await page.evaluate(()=>window.__world.playground.letters.map(l=>({...l.physical.initialState.position})))
  for(const p of letters)await approach({x:p.x,z:p.z,yaw:Math.PI/2},8,1200)
  for(let pass=0;pass<3;pass++){const remaining=await page.evaluate(()=>window.__world.playground.letters.filter(l=>!l.down).map(l=>({...l.physical.current.position,char:l.char})));console.log('letters-left',remaining);for(const p of remaining){await move(p.x+(['A','J'].includes(p.char)?1.35:0),p.z-11,Math.PI*1.5);await drive(1600,true);await wait(700)}}record('name',await page.evaluate(()=>({ok:window.__world.playground.letters.length>0&&window.__world.playground.letters.every(l=>l.down),built:window.__world.playground.letters.length,down:window.__world.playground.letters.filter(l=>l.down).length})))
}

if(selected.includes('water')) {
  /* Deep water, found by walking a bearing out to the traced coastline and
     going 55 m past it. It used to be the literal (-280,60), which on this
     island is outside the heightfield altogether. */
  if(!map.sea)record('deep-water',{ok:false,note:'no bearing put open sea inside the heightfield'})
  else {
    await move(map.sea.x,map.sea.z);await wait(9000)
    record('deep-water',await page.evaluate(sea=>{const g=window.__world;return {ok:Math.hypot(g.player.position.x-sea.x,g.player.position.z-sea.z)>35,sea,position:{...g.player.position}}},map.sea))
    await shot('shore',map.sea.shore.x,map.sea.shore.z,95)
  }
}

if(selected.includes('reset')) {
  await page.evaluate(()=>window.__world.resetObjects());await wait(3500)
  record('reset',await page.evaluate(()=>{const g=window.__world;return {ok:g.playground.crates.every(c=>!c.exploded&&c.fuse<0)&&g.minigames.current===null,tnt:g.playground.crates.filter(c=>c.exploded||c.fuse>=0).length,letterMax:g.playground.letters.reduce((v,l)=>Math.max(v,l.physical.current.position.distanceTo(l.physical.initialState.position)),0),bodies:g.physics.physicals.length}}))
}
await writeFile(`${OUT}/results.json`,JSON.stringify({map,results,errors},null,2));console.log('ERRORS',errors);await browser.close();process.exitCode=errors.length||results.some(r=>r.ok===false)?1:0
