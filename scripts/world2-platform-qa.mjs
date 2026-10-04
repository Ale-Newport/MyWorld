import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('.qa/world2',{recursive:true})
const base=process.argv.find(a=>a.startsWith('http'))??'http://localhost:3000'
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle']})
const checks=[],errors=[]
function check(name,pass,detail){checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''))}
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage()
  page.on('pageerror',e=>errors.push(String(e)))
  await page.addInitScript(()=>localStorage.setItem('alejandro-world-save-v1',JSON.stringify({sentinel:'world2-must-not-write-this'})))
  await page.goto(base+'/world2');await page.waitForFunction(()=>window.__world2?.status.ready,{timeout:120000});await page.getByRole('button',{name:'Start driving'}).click()
  // Both bridge centre/heading values are taken from the source collision deck.
  const bridges=await page.evaluate(()=>{
    const g=window.__world2,out=[]
    for(const source of ['bridgePhysicalFixed','bridgePhysicalFixed.001']){
      const root=g.environment.nodes.get(source),candidates=[]
      root.traverse(n=>{if(n.userData.w2Role!=='collider')return;const e=n.matrixWorld.elements;const sx=Math.hypot(e[0],e[1],e[2]),sy=Math.hypot(e[4],e[5],e[6]),sz=Math.hypot(e[8],e[9],e[10]);candidates.push({n,e,sx,sy,sz})})
      candidates.sort((a,b)=>a.sy-b.sy);const c=candidates[0];if(!c)continue
      const xMajor=c.sx>c.sz,axis=xMajor?[c.e[0]/c.sx,c.e[2]/c.sx]:[c.e[8]/c.sz,c.e[10]/c.sz],length=Math.max(c.sx,c.sz)
      out.push({source,center:[c.e[12],c.e[13],c.e[14]],axis,length})
    }
    return out
  })
  for(const bridge of bridges){
    await page.evaluate(b=>{const g=window.__world2;const offset=b.length/2+2.5,x=b.center[0]-b.axis[0]*offset,z=b.center[2]-b.axis[1]*offset;g.inputs.releaseAll();g.vehicle.moveTo({x,y:(g.physics.groundAt(x,z)??g.environment.terrainHeightAt(x,z))+2.2,z},Math.atan2(-b.axis[1],b.axis[0]))},bridge)
    await page.waitForTimeout(1200);const start=await page.evaluate(()=>window.__world2.player.position.toArray());await page.keyboard.down('w')
    const samples=[]
    for(let i=0;i<18;i++){await page.waitForTimeout(100);samples.push(await page.evaluate(()=>{const g=window.__world2;return{p:g.player.position.toArray(),w:g.vehicle.wheels.inContactCount,up:g.vehicle.upsideDown.active,s:g.vehicle.speed}}))}
    await page.keyboard.up('w');const end=samples.at(-1).p
    const progress=(end[0]-start[0])*bridge.axis[0]+(end[2]-start[2])*bridge.axis[1]
    check('drive '+bridge.source,progress>bridge.length&&samples.every(s=>Number.isFinite(s.p[1])&&s.p[1]>-2),{bridge,progress,start,end,minY:Math.min(...samples.map(s=>s.p[1]))})
    await page.screenshot({path:'.qa/world2/'+bridge.source+'.png'})
  }
  const metrics=await page.evaluate(()=>{const g=window.__world2;g.player.respawn('respawnLanding');return{fps:g.ticker.fps,drawCalls:g.renderer.instance.info.render.calls,geometries:g.renderer.instance.info.memory.geometries,textures:g.renderer.instance.info.memory.textures,instanced:g.environment.meshes.filter(m=>m.isInstancedMesh).length}})
  check('GPU instancing enabled',metrics.instanced>0,metrics)
  const keyBefore=await page.evaluate(()=>localStorage.getItem('alejandro-world-save-v1'))
  await page.getByRole('link',{name:'Back to portfolio'}).click();await page.waitForURL(base+'/');await page.waitForTimeout(600)
  check('original world save unchanged',await page.evaluate(()=>localStorage.getItem('alejandro-world-save-v1'))===keyBefore)
  await context.close()
  const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true}),touch=await mobile.newPage()
  touch.on('pageerror',e=>errors.push(String(e)))
  await touch.goto(base+'/world2');await touch.waitForFunction(()=>window.__world2?.status.ready,{timeout:120000});await touch.getByRole('button',{name:'Start driving'}).tap();await touch.waitForTimeout(1000)
  check('mobile touch controls visible',await touch.getByRole('button',{name:'Boost',exact:true}).isVisible())
  check('no mobile horizontal overflow',await touch.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
  const cdp=await mobile.newCDPSession(touch)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:105,y:550}]})
  await touch.waitForTimeout(150)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:60,y:220}]})
  await touch.waitForTimeout(500)
  const intent=await touch.evaluate(()=>({intent:window.__world2.nipple.intent(),accelerating:window.__world2.player.accelerating,mode:window.__world2.inputs.mode,active:window.__world2.nipple.active,progress:window.__world2.nipple.progress,touches:window.__world2.inputs.pointer.touches}))
  check('world-space touch gesture reaches Player',intent.mode==='touch'&&intent.intent&&Math.abs(intent.accelerating)>.1,intent)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  const boostBounds=await touch.getByRole('button',{name:'Boost',exact:true}).boundingBox()
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:boostBounds.x+boostBounds.width/2,y:boostBounds.y+boostBounds.height/2}]})
  check('touch boost press is active',await touch.evaluate(()=>window.__world2.inputs.isActive('boost')))
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
  check('cancelled touch releases boost',await touch.evaluate(()=>!window.__world2.inputs.isActive('boost')))
  await touch.screenshot({path:'.qa/world2/mobile.png'});await touch.getByRole('button',{name:/Controls/}).tap()
  check('mobile controls dialog fits screen',await touch.getByRole('dialog').isVisible())
  await mobile.close()
  const cancel=await browser.newContext(),loading=await cancel.newPage();loading.on('pageerror',e=>errors.push(String(e)))
  await loading.route('**/world2/models/*.glb',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.continue().catch(()=>{})})
  await loading.goto(base+'/world2');await loading.getByRole('link',{name:'Back to portfolio'}).click();await loading.waitForURL(base+'/');await loading.waitForTimeout(1800)
  check('navigation during loading cancels engine safely',await loading.evaluate(()=>!window.__world2)&&!(await loading.locator('[data-world2-ready]').count()))
  await cancel.close()
  check('no platform browser errors',errors.length===0,errors)
}catch(e){check('platform QA completed',false,String(e))}
await writeFile('.qa/world2/platform-report.json',JSON.stringify({checks,errors},null,2));await browser.close();process.exitCode=checks.some(c=>!c.pass)?1:0
