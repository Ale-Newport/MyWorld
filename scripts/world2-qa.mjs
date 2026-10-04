/** Drives /world2 using the real input stack; no fake map or vehicle in these tests. */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:3000'
await mkdir('.qa/world2', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await context.newPage(), failures = [], report = { checks: [], errors: [], drive: [] }
page.on('pageerror', error => report.errors.push(String(error)))
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
function check(name, pass, detail) { report.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? '')); if (!pass) failures.push(name) }
const snapshot = () => page.evaluate(() => { const g = window.__world2, v = g.vehicle, p = g.player.position;return { x: p.x,y:p.y,z:p.z, speed:v.speed, kmh:v.speedKmh,wheels:v.wheels.inContactCount,upsideDown:v.upsideDown.active,forward:[v.forward.x,v.forward.z],terrain:g.environment.terrainHeightAt(p.x,p.z),ground:g.physics.groundAt(p.x,p.z),suspensions:[...g.player.suspensions],boost:g.player.boosting,angle:g.player.rotationY } })
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k) }
const roadReset = async () => {
  await page.evaluate(() => {
    const g=window.__world2, path=g.manifest.roadPaths[0].points
    let best=null
    for(let i=0;i<path.length-1;i++){
      const a=path[i],b=path[i+1],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)
      if(length<22)continue
      const x=(a[0]+b[0])/2,z=(a[2]+b[2])/2
      let clear=true
      for(let along=-10;along<=10;along+=2)for(const across of [-1.2,0,1.2]){
        const px=x+dx/length*along-dz/length*across,pz=z+dz/length*along+dx/length*across
        const y=g.physics.groundAt(px,pz)
        if(y===null||Math.abs(y-a[1])>.15)clear=false
      }
      const origin={x,y:1.5,z}, rotation={x:0,y:Math.sin(Math.atan2(-dz,dx)/2),z:0,w:Math.cos(Math.atan2(-dz,dx)/2)}
      g.physics.world.intersectionsWithShape(origin,rotation,new g.physics.rapier.Cuboid(11,1.1,1.4),collider=>{if(collider.parent()?.handle!==g.vehicle.chassis.physical.body.handle)clear=false})
      if(clear&&(!best||length>best.length))best={x,z,length,angle:Math.atan2(-dz,dx)}
    }
    if(!best)throw new Error('No clear road segment for input QA')
    g.inputs.releaseAll();g.vehicle.moveTo({x:best.x,y:g.physics.groundAt(best.x,best.z)+2.2,z:best.z},best.angle)
  })
  await page.waitForTimeout(900)
}
const reset = async name => { await page.evaluate(name => window.__world2.player.respawn(name), name); await page.waitForTimeout(900) }
try {
  await page.goto(base + '/world2', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__world2?.status.ready, { timeout: 120000 })
  await page.getByRole('button', { name: 'Start driving' }).click()
  await page.waitForTimeout(1600)
  if (!process.argv.includes('--only-road')) {
  const spawn = await snapshot(); check('spawn settles on four wheels',spawn.wheels===4 && spawn.y-spawn.ground<1.7,spawn)
  const transforms = await page.evaluate(async () => {
    const g=window.__world2
    // Read constructor APIs from scene instances, keeping the production bundle free of test helpers.
    const result=[]
    for (const [name, expected] of Object.entries(g.manifest.validationBounds)) {
      const mesh=g.environment.nodes.get(name); if(!mesh?.geometry) {result.push({name,missing:true});continue}
      const pos=mesh.geometry.getAttribute('position'), matrix=mesh.matrixWorld.elements
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
      for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);const p=[matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]];p.forEach((v,j)=>{min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v)})}
      result.push({name,error:Math.max(...min.map((v,i)=>Math.abs(v-expected.min[i])),...max.map((v,i)=>Math.abs(v-expected.max[i])))})
    }
    return result
  })
  check('Blender vs GLB bounds (terrain, road, bridges, ramp, grass)',transforms.every(r=>!r.missing&&r.error<.001),transforms)
  const measurements=await page.evaluate(()=>{const g=window.__world2;return{scale:g.manifest.scale,terrainWidth:g.manifest.bounds.max[0]-g.manifest.bounds.min[0],terrainHeight:g.manifest.bounds.max[1]-g.manifest.bounds.min[1],treeRoots:[...new Set(g.environment.nodes.values())].filter(n=>n.userData.w2Role==='tree').length,spawns:g.respawns.items.size,areas:g.environment.areas.length,bodies:g.physics.world.bodies.len(),colliders:g.physics.world.colliders.len()}})
  check('authored scale and elevations',measurements.scale===1&&measurements.terrainHeight>1.49,measurements)
  await page.screenshot({path:'.qa/world2/drive-spawn.png'})
  // Every original respawn is tested on its actual physical surface.
  const spawns=await page.evaluate(()=>[...window.__world2.respawns.items.keys()])
  for(const name of spawns){await reset(name);const s=await snapshot();check('respawn '+name,Number.isFinite(s.y)&&s.y>s.terrain&&s.wheels>=2,s)}
  // Circuit marker provides clear authored tarmac for input/handling checks.
  await roadReset();const a=await snapshot();await hold(['w'],900);const b=await snapshot()
  check('accelerate with W',Math.hypot(b.x-a.x,b.z-a.z)>3&&b.speed>1,{a,b})
  await hold(['b'],700);const brake=await snapshot();check('brake with B',brake.speed<2,brake)
  await roadReset();await hold(['s'],900);const rev=await snapshot();check('reverse with S',Math.hypot(rev.x-a.x,rev.z-a.z)>2,rev)
  await roadReset();await hold(['w','d'],1200);const turn=await snapshot();check('steer with D',Math.abs(turn.angle-a.angle)>.1,turn)
  await roadReset();await hold(['w','Shift'],700);const boost=await snapshot();check('boost with Shift',boost.speed>b.speed*1.2 && boost.speed>8,boost)
  await roadReset();const jumpStart=await snapshot();await page.keyboard.down('Space');await page.waitForTimeout(250);const jump=await snapshot();await page.keyboard.up('Space');check('hydraulic jump with Space',jump.suspensions.every(s=>s==='high')&&jump.y>jumpStart.y+.15,{jumpStart,jump})
  await roadReset();await page.keyboard.down('2');await page.waitForTimeout(150);const hydraulic=await snapshot();await page.keyboard.up('2');check('corner hydraulics with 2',hydraulic.suspensions[1]==='mid',hydraulic.suspensions)
  await page.keyboard.press('r');await page.waitForTimeout(1000);const respawned=await snapshot();check('R resets boost, wheel/suspension and motion',respawned.speed<1&&respawned.boost===0&&respawned.suspensions.every(s=>s==='low'),respawned)
  const zoom0=await page.evaluate(()=>window.__world2.view.zoom.baseRatio);await page.mouse.move(800,450);await page.mouse.wheel(0,250);await page.waitForTimeout(300);const zoom1=await page.evaluate(()=>window.__world2.view.zoom.baseRatio);check('wheel zoom',zoom0!==zoom1,{zoom0,zoom1})
  const orbit0=await page.evaluate(()=>window.__world2.view.spherical.targetTheta);await page.mouse.move(700,450);await page.mouse.down();await page.mouse.move(980,530,{steps:12});await page.mouse.up();const orbit1=await page.evaluate(()=>window.__world2.view.spherical.targetTheta);check('mouse orbit',Math.abs(orbit1-orbit0)>.1,{orbit0,orbit1});await page.keyboard.press('c');check('C resets camera',await page.evaluate(()=>window.__world2.view.spherical.targetTheta===window.__world2.view.spherical.baseTheta))
  await page.keyboard.press('m');check('M opens the source-derived map',await page.getByRole('dialog',{name:'Island map'}).isVisible());await page.screenshot({path:'.qa/world2/map.png'});await page.keyboard.press('Escape')
  }
  // Exhaustively sample the original road ribbon on physical/visual elevations.
  const coverage=await page.evaluate(()=>{const g=window.__world2;return g.manifest.roadPaths.map(path=>({name:path.name,points:path.points.length,missing:path.points.filter(([x,,z])=>g.physics.groundAt(x,z)===null).length,levels:path.points.filter((_,i)=>i%20===0).map(([x,,z])=>[x,z,g.physics.groundAt(x,z),g.environment.terrainHeightAt(x,z)])}))})
  check('every authored road path point has a physical surface',coverage.length>0&&coverage.every(p=>!p.missing),coverage)
  // Drive the entire source ribbon. It is open: the gap between its endpoints
  // is a one-way jump, tested separately in the intended direction below.
  await page.evaluate(()=>{const g=window.__world2;g.stop();g.inputs.releaseAll();g.status.topDown=false;g.__qaNow=performance.now();})
  const route=await page.evaluate(()=>window.__world2.manifest.roadPaths[0])
  if(route){
    route.points = await page.evaluate(points => {
      const g=window.__world2,R=g.physics.rapier,stations=[]
      for(let i=0;i<points.length-1;i++){
        const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[2]-a[2]),steps=Math.max(1,Math.ceil(length/1.5))
        for(let j=0;j<steps;j++)stations.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps,a[2]+(b[2]-a[2])*j/steps])
      }
      stations.push(points.at(-1))
      const offsets=[-3.6,-2.4,-1.2,0,1.2,2.4,3.6],rows=[]
      for(let i=0;i<stations.length;i++){
        const s=stations[i],next=stations[Math.min(i+1,stations.length-1)],prev=stations[Math.max(0,i-1)]
        const dx=next[0]-prev[0],dz=next[2]-prev[2],len=Math.hypot(dx,dz)||1,angle=Math.atan2(-dz,dx)
        const row=offsets.map(offset=>{
          const x=s[0]-dz/len*offset,z=s[2]+dx/len*offset
          const floor=s[1]
          let blocked=false
          g.physics.world.intersectionsWithShape({x,y:floor+1.05,z},{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},new R.Cuboid(1.35,.42,.92),collider=>{if(collider.parent()?.handle!==g.vehicle.chassis.physical.body.handle)blocked=true;return true})
          return {p:[x,floor,z],blocked,cost:Infinity,from:0,offset}
        })
        for(let j=0;j<row.length;j++){
          const cost=(row[j].blocked?10000:0)+Math.abs(row[j].offset)*.08
          if(!i){row[j].cost=cost;continue}
          for(let k=0;k<rows[i-1].length;k++){
            const shift=Math.abs(offsets[j]-offsets[k]);if(shift>1.21)continue
            const candidate=rows[i-1][k].cost+cost+shift*shift*1.8
            if(candidate<row[j].cost){row[j].cost=candidate;row[j].from=k}
          }
        }
        rows.push(row)
      }
      let index=rows.at(-1).reduce((best,item,i,row)=>item.cost<row[best].cost?i:best,0),out=[]
      for(let i=rows.length-1;i>=0;i--){out.push(rows[i][index].p);index=rows[i][index].from}
      return out.reverse()
    },route.points)
    const start=route.points[0],next=route.points[1]
    await page.evaluate(({start,next})=>{const g=window.__world2;g.vehicle.moveTo({x:start[0],y:g.physics.groundAt(start[0],start[2])+2.2,z:start[2]},Math.atan2(-(next[2]-start[2]),next[0]-start[0]));for(let i=0;i<80;i++){g.__qaNow+=1000/60;g.ticker.update(g.__qaNow)}},{start,next})
    let index=1,steps=0,rescues=0,noProgressSteps=0;const total=route.points.length
    while(index<total&&steps<14000){
      const state=await page.evaluate(({points,index})=>{
        const g=window.__world2;let waypoint=index;let lost=0,minWheels=4
        for(let frame=0;frame<100&&waypoint<points.length;frame++){
          const p=g.player.position;let target=points[waypoint];let dx=target[0]-p.x,dz=target[2]-p.z
          while(Math.hypot(dx,dz)<2.3&&waypoint<points.length-1){waypoint++;target=points[waypoint];dx=target[0]-p.x;dz=target[2]-p.z}
          if(waypoint===points.length-1&&Math.hypot(dx,dz)<2.3){waypoint++;break}
          const desired=Math.atan2(dz,dx);let error=desired-g.player.rotationY;error=Math.atan2(Math.sin(error),Math.cos(error))
          // Native gamepad stick supplies proportional steering; the same Player
          // handling, engine force and Rapier controller run at every fixed step.
          const stick=g.inputs.gamepad.joysticks.left;stick.active=true;stick.safeX=Math.max(-1,Math.min(1,error*1.4))
          const f=g.inputs.actions.get('forward');f.active=true;f.value=Math.abs(error)>.65?.3:.55
          const brake=g.inputs.actions.get('brake');brake.active=Math.abs(error)>.5&&g.vehicle.speed>4;brake.value=brake.active?1:0
          // Poll only updates hardware; use fixed + tick channels after setting
          // driver intent so a nonexistent physical gamepad cannot overwrite it.
          g.ticker.delta=1/60;g.ticker.deltaScaled=1/30;g.ticker.elapsed+=1/60;g.ticker.elapsedScaled+=1/30;g.ticker.alpha=1
          g.ticker.events.trigger('fixed');if(frame%3===0)g.ticker.events.trigger('tick')
          if(g.vehicle.wheels.inContactCount===0)lost++
          minWheels=Math.min(minWheels,g.vehicle.wheels.inContactCount)
        }
        return{index:waypoint,x:g.player.position.x,y:g.player.position.y,z:g.player.position.z,wheels:g.vehicle.wheels.inContactCount,speed:g.vehicle.speed,upside:g.vehicle.upsideDown.active,lost,minWheels}
      },{points:route.points,index})
      steps+=100;report.drive.push(state)
      noProgressSteps=state.index===index?noProgressSteps+100:0
      if(noProgressSteps>=1800){rescues++;console.log('STALLED',state);await page.screenshot({path:'.qa/world2/road-stall.png'});break}
      index=state.index
      if(steps%1000===0)console.log('ROAD',index,'/',total,state)
    }
    check('full source road driven continuously',index>=total&&rescues===0,{index,total,steps,rescues,last:report.drive.at(-1)})
  }
  await page.evaluate(()=>{const g=window.__world2;g.inputs.releaseAll();g.inputs.gamepad.joysticks.left.active=false;g.player.respawn('respawnLanding');g.start()})
  // Approach the ramp from the first ribbon endpoint toward the last. Both
  // endpoints are extracted from Blender, not hand-maintained map coordinates.
  const ramp=await page.evaluate(()=>{
    const g=window.__world2,points=g.manifest.roadPaths[0].points,a=points[0],b=points.at(-1)
    const length=Math.hypot(b[0]-a[0],b[2]-a[2]),axis=[(b[0]-a[0])/length,(b[2]-a[2])/length]
    const x=a[0]-axis[0]*4,z=a[2]-axis[1]*4
    g.inputs.releaseAll();g.vehicle.moveTo({x,y:g.physics.groundAt(x,z)+2.2,z},Math.atan2(-axis[1],axis[0]))
    return{a,b,axis,length}
  })
  await page.waitForTimeout(1000);await page.keyboard.down('w');await page.keyboard.down('Shift')
  const rampSamples=[]
  for(let i=0;i<24;i++){await page.waitForTimeout(70);rampSamples.push(await snapshot())}
  await page.keyboard.up('Shift');await page.keyboard.up('w')
  const beyond=s=>(s.x-ramp.b[0])*ramp.axis[0]+(s.z-ramp.b[2])*ramp.axis[1]
  const airborne=rampSamples.filter(s=>s.wheels===0&&s.y>2)
  check('authored ramp launches and lands beyond the road gap',airborne.length>0&&rampSamples.some(s=>beyond(s)>1&&s.wheels>=2)&&rampSamples.every(s=>s.y>-2),{ramp,airborneSamples:airborne.length,maxY:Math.max(...rampSamples.map(s=>s.y)),samples:rampSamples})
  await page.screenshot({path:'.qa/world2/ramp.png'})
  await reset('respawnLanding')
  await page.waitForTimeout(700)
  await page.evaluate(()=>window.__world2.toggleTopDown());await page.waitForTimeout(400);await page.screenshot({path:'.qa/world2/browser-top.png'});await page.evaluate(()=>window.__world2.toggleTopDown())
  // Same-document navigation proves React disposal, not just tab destruction.
  await page.getByRole('link',{name:'Back to portfolio'}).click();await page.waitForURL(base+'/');await page.waitForTimeout(600)
  check('World2 releases its dev handle on navigation',await page.evaluate(()=>!window.__world2))
  check('home route remains usable',await page.locator('body').innerText().then(t=>t.length>100))
  await page.screenshot({path:'.qa/world2/home-regression.png'})
  await page.goto(base+'/world');await page.waitForFunction(()=>window.__world?.vehicle,{timeout:120000});check('original /world still initialises',await page.evaluate(()=>!!window.__world.vehicle&&!window.__world2))
  await page.screenshot({path:'.qa/world2/world-regression.png'})
  await page.goto(base+'/world2');await page.waitForFunction(()=>window.__world2?.status.ready,{timeout:120000});check('World2 remounts with one canvas',await page.locator('main canvas').count()===1)
  check('no browser errors',report.errors.length===0,report.errors)
}catch(error){check('QA harness completed',false,String(error));console.error(error)}
await writeFile('.qa/world2/qa-report.json',JSON.stringify(report,null,2))
await browser.close()
process.exitCode=failures.length?1:0
