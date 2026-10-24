/* The /world performance probe: a QA instrument, never loaded for a visitor.
 *
 * main.js imports this module dynamically, and only for  ?qa&perf  (on localhost ?perf is enough). Nothing here runs otherwise,
 * and it changes nothing the renderer draws: it wraps `renderer.render`, `renderer.shadowMap.render` and the ticker's
 * Events.on to time them, and reads `renderer.info`.
 *
 *   __perf.report()        frame ms p50/p95/p99 (rAF to rAF), per-phase CPU, GPU ms (EXT_disjoint_timer_query_webgl2 where the
 *                          browser has it), the shadow pass on its own (passes, draw calls, triangles, CPU, GPU), per-tick-subscriber
 *                          p95, hitches (frames > 33 ms with the program / geometry / texture deltas), long tasks, input latency
 *   __perf.passes()        main vs shadow draw calls / triangles / CPU by A/B (the shadow pass forced on, then off), and the
 *                          explicit cost of scene.updateMatrixWorld()
 *   __perf.census()        what the renderer is being fed: nodes, visible meshes, matrixAutoUpdate, casters, the heaviest meshes
 *   __perf.verifyFrozen()  nodes frozen with matrixAutoUpdate=false whose position / quaternion / scale no longer match their matrix
 *   __perf.verifyShadow()  casters that moved while no shadow pass ran after them (a stale shadow), by name
 *   __perf.reset()         start a clean window
 */
import {casterStatics,measureCaster,SHADOW_MOTION,STATICS,CASTER_AMBIENT,CASTER_SMALL} from './shadow-rig.js';
const ring=(n=1200)=>({a:new Float32Array(n),i:0,c:0,push(v){this.a[this.i]=v;this.i=(this.i+1)%n;if(this.c<n)this.c++;},clear(){this.c=0;this.i=0;},
 stats(){const s=Array.from(this.a.subarray(0,this.c)).sort((x,y)=>x-y),q=p=>s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:0,r=v=>Math.round(v*1000)/1000;
  return {n:s.length,p50:r(q(.5)),p95:r(q(.95)),p99:r(q(.99)),max:r(s.length?s[s.length-1]:0),mean:r(s.reduce((x,y)=>x+y,0)/(s.length||1))};}});

export function installPerfProbe(ctx){
 const {THREE}=ctx,R=()=>ctx.renderer(),phases=new Map(),subs=new Map(),hitches=[],longtasks=[],inputs=[],stamps=new Map();
 const frameMs=ring(),cpuMs=ring(),gpuMain=ring(300),gpuShadow=ring(300),shadowCalls=ring(),shadowTris=ring(),shadowCpu=ring(),mainCalls=ring(),mainTris=ring();
 let t0=0,tFrame=0,lastNow=0,prev={},frames=0,shadowPasses=0,topLevel=0,installed=false;const frameShadow={calls:0,tris:0};
 const phase=name=>phases.get(name)??phases.set(name,ring()).get(name);

 // 1. Per-subscriber timing: every tick / fixed callback registered after this point is wrapped, labelled by who registered it.
 const patched=new Set();
 async function patchEvents(){
  for(const path of ['./Events.js','../portfolio/world/core/Events.js']){
   try{const {Events}=await import(path);if(patched.has(Events))continue;patched.add(Events);
    const on=Events.prototype.on,off=Events.prototype.off,map=new WeakMap();
    Events.prototype.on=function(name,callback,order=1){
     if((name==='tick'||name==='fixed')&&typeof callback==='function'&&!callback.__perf){
      const where=(new Error().stack.split('\n').slice(2,5).map(l=>l.replace(/^\s*at\s*/,'').replace(location.origin+'/archipelago/preview/','')).find(l=>!/Events\.js|perf-probe/.test(l))||'?'),key=name+'@'+order+' '+where;
      const wrapped=function(...a){const s=performance.now();try{return callback.apply(this,a);}finally{(subs.get(key)??subs.set(key,ring(400)).get(key)).push(performance.now()-s);}};
      wrapped.__perf=true;map.set(callback,wrapped);return on.call(this,name,wrapped,order);
     }
     return on.call(this,name,callback,order);
    };
    if(off)Events.prototype.off=function(name,callback){return off.call(this,name,map.get(callback)??callback);};
   }catch{}
  }
 }

 // 2. Long tasks, long animation frames, input delay (Chromium).
 for(const type of ['long-animation-frame','longtask'])try{new PerformanceObserver(list=>{for(const e of list.getEntries())longtasks.push({type,at:Math.round(e.startTime),ms:Math.round(e.duration),blocking:Math.round(e.blockingDuration||0),scripts:(e.scripts||[]).slice(0,4).map(s=>({fn:s.sourceFunctionName,url:(s.sourceURL||'').split('/').pop(),ms:Math.round(s.duration)}))});}).observe({type,buffered:true});}catch{}
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())inputs.push({name:e.name,delay:Math.round(e.processingStart-e.startTime),processing:Math.round(e.processingEnd-e.processingStart),total:Math.round(e.duration)});}).observe({type:'event',durationThreshold:16,buffered:true});}catch{}
 // 3. Key / pointer to the end of the frame that follows it.
 for(const type of ['keydown','pointerdown'])addEventListener(type,e=>{if(!e.repeat)stamps.set(type+':'+(e.code??e.pointerId),e.timeStamp);},{capture:true});

 // 4. The renderer: GPU timer queries, the shadow pass on its own.
 let gl=null,ext=null,pending=[],current=null;
 function wrapRenderer(){
  const r=R();if(installed||!r)return;installed=true;gl=r.getContext();ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const render=r.render.bind(r),shadow=r.shadowMap.render.bind(r.shadowMap);
  // Two timer queries back to back: [start of render, end of the shadow pass] and [end of the shadow pass, end of render].
  r.render=function(scene,camera){
   const outer=topLevel===0&&r.getRenderTarget()===null;topLevel++;
   if(outer&&ext){current={shadow:gl.createQuery(),main:gl.createQuery(),state:0};gl.beginQuery(ext.TIME_ELAPSED_EXT,current.shadow);current.state=1;}
   const calls=r.info.render.calls,tris=r.info.render.triangles,t=performance.now();
   try{return render(scene,camera);}
   finally{
    topLevel--;
    if(outer){
     if(current){if(current.state===1)gl.endQuery(ext.TIME_ELAPSED_EXT);else if(current.state===2)gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(current);current=null;}
     if(!r.info.autoReset)return;
     phase('renderer.render').push(performance.now()-t);
    }
   }
  };
  r.shadowMap.render=function(lights,scene,camera){
   const c0=r.info.render.calls,tr0=r.info.render.triangles,t=performance.now(),before=r.info.render.frame;
   const out=shadow(lights,scene,camera);
   const dc=r.info.render.calls-c0;
   if(dc>0&&topLevel===1){shadowPasses++;shadowCalls.push(dc);const dt=r.info.render.triangles-tr0;shadowTris.push(dt);frameShadow.calls+=dc;frameShadow.tris+=dt;shadowCpu.push(performance.now()-t);api._onShadowPass?.();}
   if(current&&current.state===1){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.beginQuery(ext.TIME_ELAPSED_EXT,current.main);current.state=2;}
   return out;
  };
 }
 function pollGpu(){
  if(!ext)return;
  for(const q of pending.splice(0)){
   const done=(h)=>gl.getQueryParameter(h,gl.QUERY_RESULT_AVAILABLE);
   if(!done(q.shadow)||!done(q.main)){pending.push(q);if(pending.length>30){const old=pending.shift();gl.deleteQuery(old.shadow);gl.deleteQuery(old.main);}continue;}
   if(!gl.getParameter(ext.GPU_DISJOINT_EXT)){gpuShadow.push(gl.getQueryParameter(q.shadow,gl.QUERY_RESULT)/1e6);gpuMain.push(gl.getQueryParameter(q.main,gl.QUERY_RESULT)/1e6);}
   gl.deleteQuery(q.shadow);gl.deleteQuery(q.main);
  }
 }

 // 5. verifyShadow: every caster's world matrix at the moment of the last shadow pass, compared with now. A caster is stale when it moved more than a texel since that pass
 // and its shadow would land in what the camera sees (the rule shadow-rig.js redraws by, at half a texel).
 const watch={list:[],radii:[],statics:new Float32Array(0),firstSeen:new WeakMap(),snap:new Map(),violations:new Map(),frames:0,since:0,on:false};
 const ancestorsVisible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
 const casterKey=o=>o.isInstancedMesh?o.instanceMatrix.version:0;
 function snapshotCasters(){
  if(!watch.on)return;
  const list=[];ctx.scene().traverse(o=>{if(o.isMesh&&o.castShadow&&ancestorsVisible(o))list.push(o);});
  watch.list=list;watch.snap.clear();watch.radii=list.map(o=>{const g=o.geometry;g.boundingSphere??g.computeBoundingSphere();const e=o.matrixWorld.elements;return (g.boundingSphere?.radius??1)*Math.sqrt(Math.max(e[0]*e[0]+e[1]*e[1]+e[2]*e[2],e[4]*e[4]+e[5]*e[5]+e[6]*e[6],e[8]*e[8]+e[9]*e[9]+e[10]*e[10]));});
  watch.statics=new Float32Array(list.length*STATICS);list.forEach((o,i)=>casterStatics(o,watch.statics,i*STATICS));
  list.forEach(o=>watch.snap.set(o,{m:o.matrixWorld.elements.slice(),v:casterKey(o)}));
  watch.since=0;
 }
 function checkStale(){
  if(!watch.on||!watch.snap.size)return;watch.frames++;watch.since++;
  const now=new Set(),rig=ctx.rig?.(),c=ctx.sun()?.shadow?.camera,texel=c?(c.right-c.left)/ctx.sun().shadow.mapSize.x:.1,view=rig?.view,dir=rig?.dir,slope=Math.max(.2,dir?.y??.78);
  for(let i=0;i<watch.list.length;i++){
   const o=watch.list[i],s=watch.snap.get(o);if(!s)continue;const e=o.matrixWorld.elements;let stale=casterKey(o)!==s.v;
   // The rig sees a caster that has just become visible in the frame it appears (at full quality; under CPU strain at its next scan, 50 ms): grace for the second case.
   const seen=watch.firstSeen.get(o)??(watch.firstSeen.set(o,watch.frames),watch.frames);if(watch.frames-seen<=4&&watch.frames>8)continue;
   if(!stale){const move=Math.max(Math.abs(e[12]-s.m[12]),Math.abs(e[13]-s.m[13]),Math.abs(e[14]-s.m[14]));let turn=0;for(const k of [0,1,2,4,5,6,8,9,10])turn=Math.max(turn,Math.abs(e[k]-s.m[k]));
    // The rig's own classes: a translucent caster is stale at 60 cm, a small one at 10, anything else at a texel.
    const q=measureCaster(e,watch.statics,i*STATICS),cls=q.cls;stale=cls===CASTER_AMBIENT?move>SHADOW_MOTION.thinMove:move+turn*q.radius>(cls===CASTER_SMALL?Math.max(texel,SHADOW_MOTION.smallMove):texel);}
   if(!stale)continue;
   if(view&&dir){const t=Math.max(0,(e[13]-view.y)/slope),gx=e[12]-dir.x*t,gz=e[14]-dir.z*t;if(Math.hypot(gx-view.x,gz-view.z)>view.r+watch.radii[i]+2)continue;}
   const name=(o.name||o.parent?.name||o.type)+(o.parent?.name?' < '+o.parent.name:''),v=watch.violations.get(name)??{name,frames:0,run:0,maxRun:0,firstSinceShadow:watch.since};
   v.frames++;if(!now.has(name)){now.add(name);v.run++;v.maxRun=Math.max(v.maxRun,v.run);}v.firstSinceShadow=Math.min(v.firstSinceShadow,watch.since);v.sample??={t:Math.round(performance.now()),pos:[e[12],e[13],e[14]].map(x=>+x.toFixed(1)),car:(()=>{const d=globalThis.__archipelago?.driving;return d?d.vehicle.position.toArray().map(x=>+x.toFixed(1)):null;})(),cls:measureCaster(e,watch.statics,i*STATICS).cls,radius:+watch.radii[i].toFixed(2),instanced:!!o.isInstancedMesh,uuid:o.uuid.slice(0,6),chain:(()=>{const p=[];for(let n=o;n&&p.length<5;n=n.parent)p.push(n.name||n.type);return p.join(' < ');})()};watch.violations.set(name,v);
  }
  for(const [name,v] of watch.violations)if(!now.has(name))v.run=0;
 }

 // 6. verifyMatrices: what three drew each node with against what the node's own transform and its parents' give. A node the freeze or its walk left behind is stale by name; a node that
 // moves is checked only after its frame's render, so it must match to the last digit.
 const mw={on:false,every:3,frames:0,checks:0,violations:new Map(),stale:0,mats:[],freezer:null};
 const tmp=new THREE.Matrix4();
 function matrixStale(out){
  const scene=ctx.scene(),frozen=mw.freezer?.frozen,mats=mw.mats;let count=0;
  const walk=(o,depth,parent)=>{
   if(!o.visible)return;
   const t=mats[depth]??(mats[depth]=new THREE.Matrix4());
   if(!o.matrixAutoUpdate&&!frozen?.has(o))tmp.copy(o.matrix);else tmp.compose(o.position,o.quaternion,o.scale);
   if(parent)t.multiplyMatrices(parent,tmp);else t.copy(tmp);
   const a=t.elements,b=o.matrixWorld.elements;
   for(let i=0;i<16;i++)if(Math.abs(a[i]-b[i])>1e-4+1e-6*Math.abs(a[i])){count++;if(out)out.push(o);break;}
   for(let i=0,c=o.children;i<c.length;i++)walk(c[i],depth+1,t);
  };
  walk(scene,0,null);return count;
 }
 function checkMatrices(){
  if(!mw.on||++mw.frames%mw.every)return;mw.checks++;
  const list=[],n=matrixStale(list),now=new Set();mw.stale=Math.max(mw.stale,n);
  for(const o of list){
   const name=(o.name||o.type)+(o.parent?.name?' < '+o.parent.name:''),v=mw.violations.get(name)??{name,checks:0,run:0,maxRun:0,frozen:false};
   v.checks++;v.frozen||=!!mw.freezer?.frozen.has(o);if(!now.has(name)){now.add(name);v.run++;v.maxRun=Math.max(v.maxRun,v.run);}mw.violations.set(name,v);
  }
  for(const [name,v] of mw.violations)if(!now.has(name))v.run=0;
 }

 const api={
  /** Called at the top of the frame with the rAF timestamp. */
  begin(now){t0=tFrame=performance.now();if(!installed&&R())wrapRenderer();if(lastNow){const dt=now-lastNow;if(dt<500)frameMs.push(dt);}lastNow=now;},
  mark(name){const t=performance.now();phase(name).push(t-t0);t0=t;},
  /** After the frame's render. */
  end(){
   const now=performance.now();cpuMs.push(now-tFrame);frames++;pollGpu();checkStale();checkMatrices();
   for(const [k,v] of stamps){inputs.push({name:'key-to-end-of-frame '+k,delay:Math.round(now-v)});stamps.delete(k);}
   const r=R(),i=r.info,cur={programs:i.programs?.length??0,geometries:i.memory.geometries,textures:i.memory.textures};
   mainCalls.push(i.render.calls-frameShadow.calls);mainTris.push(i.render.triangles-frameShadow.tris);frameShadow.calls=frameShadow.tris=0;
   const dt=frameMs.c?frameMs.a[(frameMs.i+frameMs.a.length-1)%frameMs.a.length]:0;
   if(dt>33)hitches.push({at:Math.round(now),ms:+dt.toFixed(1),dPrograms:cur.programs-(prev.programs??cur.programs),dGeometries:cur.geometries-(prev.geometries??cur.geometries),dTextures:cur.textures-(prev.textures??cur.textures),quality:ctx.quality()?.level,heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1e6).toFixed(1):null});
   if(hitches.length>200)hitches.shift();
   prev=cur;
  },
  census({top=25}={}){
   const scene=ctx.scene(),cam=ctx.camera(),frustum=new THREE.Frustum(),m=new THREE.Matrix4();scene.updateMatrixWorld();cam.updateMatrixWorld();m.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);frustum.setFromProjectionMatrix(m);
   let nodes=0,meshes=0,visibleMeshes=0,instanced=0,auto=0,autoVisible=0,autoHidden=0,casters=0,noCull=0,transparent=0,lights=0;const heavy=[];
   scene.traverse(o=>{nodes++;if(o.matrixAutoUpdate){auto++;ancestorsVisible(o)?autoVisible++:autoHidden++;}if(o.isLight&&ancestorsVisible(o))lights++;if(!o.isMesh)return;meshes++;if(!ancestorsVisible(o))return;visibleMeshes++;
    if(o.castShadow)casters++;if(!o.frustumCulled)noCull++;if(o.material?.transparent)transparent++;if(o.isInstancedMesh)instanced+=o.count;
    const g=o.geometry,total=(g.index?g.index.count:g.attributes.position?.count)||0,tris=Math.max(0,Math.min(total-g.drawRange.start,g.drawRange.count))/3*(o.isInstancedMesh?o.count:1);
    if(tris>15000){g.boundingSphere??g.computeBoundingSphere();heavy.push({name:o.name||o.parent?.name||'?',triangles:Math.round(tris),indexed:!!g.index,castShadow:o.castShadow,inView:frustum.intersectsObject(o),radius:Math.round(g.boundingSphere.radius),instanced:!!o.isInstancedMesh,frustumCulled:o.frustumCulled});}
   });
   heavy.sort((a,b)=>b.triangles-a.triangles);const i=R().info;
   return {nodes,meshes,visibleMeshes,instancedInstances:instanced,matrixAutoUpdate:{total:auto,underVisible:autoVisible,underHidden:autoHidden},casters,notFrustumCulled:noCull,transparent,visibleLights:lights,heavy:heavy.slice(0,top),info:{render:{...i.render},memory:{...i.memory},programs:i.programs?.length??0}};
  },
  /** Main vs shadow pass by A/B on the same frame state, and what scene.updateMatrixWorld() costs. */
  passes({runs=4}={}){
   const r=R(),scene=ctx.scene(),camera=ctx.camera(),info=r.info,sm=r.shadowMap,saved={auto:sm.autoUpdate,need:sm.needsUpdate,reset:info.autoReset};
   info.autoReset=false;sm.autoUpdate=false;
   const run=shadow=>{sm.needsUpdate=shadow;info.reset();const t=performance.now();r.render(scene,camera);return {ms:performance.now()-t,calls:info.render.calls,triangles:info.render.triangles};};
   run(true);run(false);const withS=[],noS=[];for(let i=0;i<runs;i++){withS.push(run(true));noS.push(run(false));}
   const med=a=>a.map(x=>x.ms).sort((x,y)=>x-y)[Math.floor(a.length/2)],last=a=>a[a.length-1];
   sm.autoUpdate=saved.auto;sm.needsUpdate=saved.need;info.autoReset=saved.reset;
   const matrixAuto=scene.matrixWorldAutoUpdate;scene.matrixWorldAutoUpdate=false;scene.updateMatrixWorld();const t=performance.now();for(let i=0;i<20;i++)scene.updateMatrixWorld();const matrixMs=(performance.now()-t)/20;scene.matrixWorldAutoUpdate=matrixAuto;
   return {main:{calls:last(noS).calls,triangles:last(noS).triangles,cpuMs:+med(noS).toFixed(2)},shadow:{calls:last(withS).calls-last(noS).calls,triangles:last(withS).triangles-last(noS).triangles,cpuMs:+(med(withS)-med(noS)).toFixed(2)},total:{calls:last(withS).calls,triangles:last(withS).triangles},updateMatrixWorldMs:+matrixMs.toFixed(3)};
  },
  /** Nodes frozen with matrixAutoUpdate=false whose own position / quaternion / scale no longer match their matrix. */
  verifyFrozen(){
   const m=new THREE.Matrix4(),out=[];ctx.scene().traverse(o=>{if(o.matrixAutoUpdate)return;m.compose(o.position,o.quaternion,o.scale);const a=m.elements,b=o.matrix.elements;for(let i=0;i<16;i++)if(Math.abs(a[i]-b[i])>1e-6){out.push((o.name||o.type)+':'+o.uuid.slice(0,6));break;}});
   return out;
  },
  /** Start / read the stale-shadow check: every frame, any caster in range whose world matrix differs from the one the last shadow pass drew. */
  verifyShadow({start=false,stop=false}={}){
   if(start){watch.on=true;watch.violations.clear();watch.frames=0;snapshotCasters();return {started:true,casters:watch.list.length};}
   const out={frames:watch.frames,casters:watch.list.length,violations:[...watch.violations.values()].map(({name,frames,maxRun,firstSinceShadow,sample})=>({name,frames,maxRun,firstSinceShadow,sample})).sort((a,b)=>b.maxRun-a.maxRun||b.frames-a.frames)};if(stop)watch.on=false;return out;
  },
  /** Start / read the world-matrix check: every `every`-th frame, every visible node whose world matrix is not what its own transform and its parents' give. `freezer`: main.js's StaticFreeze. */
  verifyMatrices({start=false,stop=false,every=3,freezer=null}={}){
   if(start){Object.assign(mw,{on:true,every,frames:0,checks:0,stale:0,freezer});mw.violations.clear();return {started:true,now:matrixStale(null)};}
   const out={checks:mw.checks,worstFrame:mw.stale,violations:[...mw.violations.values()].sort((a,b)=>b.maxRun-a.maxRun||b.checks-a.checks).slice(0,40)};if(stop)mw.on=false;return out;
  },
  report(){
   const r=R(),i=r.info,subscribers=[...subs].map(([k,v])=>({k,...v.stats()})).sort((a,b)=>b.p95-a.p95).slice(0,20);
   return {frames,frameMs:frameMs.stats(),cpuFrameMs:cpuMs.stats(),gpu:ext?{mainMs:gpuMain.stats(),shadowMs:gpuShadow.stats()}:'EXT_disjoint_timer_query_webgl2 unavailable',
    phases:Object.fromEntries([...phases].map(([k,v])=>[k,v.stats()])),
    shadow:{passes:shadowPasses,framesWithPass:+(shadowPasses/Math.max(1,frames)).toFixed(3),calls:shadowCalls.stats(),triangles:shadowTris.stats(),cpuMs:shadowCpu.stats()},
    main:{calls:mainCalls.stats(),triangles:mainTris.stats()},subscribers,hitches:hitches.slice(-40),longTasks:longtasks.slice(-40),inputs:inputs.slice(-40),
    info:{...i.render,...i.memory,programs:i.programs?.length??0},quality:ctx.quality()?.level??null,pixelRatio:r.getPixelRatio(),tier:ctx.tier?.()??null};
  },
  reset(){for(const m of [phases,subs])m.clear();for(const x of [frameMs,cpuMs,gpuMain,gpuShadow,shadowCalls,shadowTris,shadowCpu,mainCalls,mainTris])x.clear();hitches.length=longtasks.length=inputs.length=0;frames=0;shadowPasses=0;},
  hitchLog:()=>hitches.slice(),
  _onShadowPass(){snapshotCasters();},
 };
 api.ready=patchEvents();
 globalThis.__perf=api;
 return api;
}
