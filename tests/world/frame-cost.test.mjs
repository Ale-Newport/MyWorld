import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ShadowRig,SHADOW_RADIUS,SHADOW_RESCAN,boxHalf,viewPoints,SHADOW_BOX,SHADOW_MOTION,STATICS,casterStatics,measureCaster,turnedBy,CASTER_NORMAL,CASTER_SMALL,CASTER_AMBIENT} from '../../public/archipelago/preview/runtime/shadow-rig.js';
import {StaticFreeze} from '../../public/archipelago/preview/runtime/freeze.js';
import {AdaptiveQuality,FramePacer,FRAME_CAP_FPS} from '../../public/archipelago/preview/runtime/quality.js';

const offset=new THREE.Vector3(-70,130,80);
function rig(options={}){
 const renderer={shadowMap:{autoUpdate:true,needsUpdate:false,type:0}},sun=new THREE.DirectionalLight();sun.shadow.mapSize.set(2048,2048);
 return {renderer,sun,rig:new ShadowRig({renderer,sun,offset,...options})};
}
/** The chase camera of /world: 25 degrees, 21 m from the car, 41 degrees down, from the south east. */
function chaseCamera(at=new THREE.Vector3(),radius=21){
 const camera=new THREE.PerspectiveCamera(25,16/10,.1,800),spherical=new THREE.Vector3().setFromSphericalCoords(radius,Math.PI*.27,Math.PI*.25);
 camera.position.copy(at).add(spherical);camera.lookAt(at);camera.updateMatrixWorld(true);return camera;
}
const mesh=(x,y,z,s=1)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(s,s,s));m.castShadow=true;m.position.set(x,y,z);m.updateMatrixWorld(true);return m;};

test('the shadow box is a quantised size with a hysteresis, within its limits',()=>{
 assert.equal(boxHalf(10),SHADOW_BOX.min);assert.equal(boxHalf(500),SHADOW_BOX.max);
 assert.equal(boxHalf(25),28);
 // it grows at once and shrinks only 8 m under the current size
 assert.equal(boxHalf(29,28),32);assert.equal(boxHalf(25,32),32);assert.equal(boxHalf(25,36),28);
});

test('the 21 m chase camera needs a box a fifth as wide as the old 240 m one',()=>{
 const camera=chaseCamera(),out=new Float64Array(15),focus=new THREE.Vector3(),visible=viewPoints(camera,0,out,focus,{point:new THREE.Vector3(),dir:new THREE.Vector3()});
 assert.ok(focus.length()<1,'the camera looks at the car: '+focus.toArray());
 assert.ok(visible>8&&visible<30,'ground in view '+visible);
 const a=rig();a.rig.update(camera,0);
 assert.ok(a.rig.half>=24&&a.rig.half<=40,'half '+a.rig.half);
});

test('a parked camera redraws nothing; the centre moves in whole texels; a mover near the view redraws, a far one does not',()=>{
 const {renderer,sun,rig:r}=rig(),scene=new THREE.Group(),near=mesh(2,.5,2),far=mesh(80,.5,80),camera=chaseCamera();
 scene.add(near,far);
 assert.equal(r.update(camera,0),true,'the first frame draws');r.watch(scene,0);
 assert.equal(r.update(camera,0),true,'and the second: the casters were found');r.watch(scene,16);
 renderer.shadowMap.needsUpdate=false;
 for(let i=2;i<20;i++){assert.equal(r.update(camera,0),false,'frame '+i);r.watch(scene,i*16);}
 // a small move of the camera: still inside one texel
 const texel=2*r.half/2048;camera.position.x+=texel*.2;camera.updateMatrixWorld(true);
 // (a camera shift of a fifth of a texel may or may not cross a rounding boundary; many of them must)
 let draws=0;for(let i=0;i<10;i++){camera.position.x+=texel*.3;camera.updateMatrixWorld(true);if(r.update(camera,0)){draws++;r.watch(scene,1000+i);}else r.watch(scene,1000+i);}
 assert.ok(draws>=2&&draws<=5,'about one redraw per 3 steps of 0.3 texel: '+draws);
 // the light sits on whole texels
 const rightCoord=sun.target.position.dot(r.right)/texel,upCoord=sun.target.position.dot(r.up)/texel;
 assert.ok(Math.abs(rightCoord-Math.round(rightCoord))<1e-6&&Math.abs(upCoord-Math.round(upCoord))<1e-6,'snapped to texels');
 // movers
 r.update(camera,0);r.watch(scene,2000);for(let i=0;i<3;i++){r.update(camera,0);r.watch(scene,2001+i);}
 far.position.x+=.5;far.updateMatrixWorld(true);r.watch(scene,3000);assert.equal(r.update(camera,0),false,'something moving far away is not in the picture');
 near.position.x+=.5;near.updateMatrixWorld(true);r.watch(scene,3016);assert.equal(r.update(camera,0),true,'something moving beside the car is');
 // a movement under half a texel does not count, however often it happens, until it adds up
 r.watch(scene,3032);r.update(camera,0);
 const before=near.position.x;let counted=0;for(let i=0;i<10;i++){near.position.x+=r.threshold*.2;near.updateMatrixWorld(true);r.watch(scene,4000+i*16);if(r.update(camera,0)){counted++;r.watch(scene,4001+i*16);}}
 assert.ok(counted>=1&&counted<=4,'the drift adds up to a redraw now and then, not every frame: '+counted+' after '+(near.position.x-before)+' m');
});

test('an instanced caster whose matrices were rewritten redraws; a hidden or new caster is noticed at the next scan',()=>{
 const {rig:r}=rig(),scene=new THREE.Group(),camera=chaseCamera(),inst=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),4);inst.castShadow=true;scene.add(inst);
 r.update(camera,0);r.watch(scene,0);r.update(camera,0);r.watch(scene,16);
 assert.equal(r.update(camera,0),false);
 inst.setMatrixAt(0,new THREE.Matrix4().makeTranslation(1,0,0));inst.instanceMatrix.needsUpdate=true;r.watch(scene,32);
 assert.equal(r.update(camera,0),true);r.watch(scene,48);
 scene.add(mesh(1,1,1));r.watch(scene,700);assert.equal(r.update(camera,0),true,'a new caster is a reason');
});

test('the old box and the every-frame redraw stay available, and the map\'s photograph or anything else that drew in between invalidates',()=>{
 const {renderer,sun,rig:r}=rig({legacy:true});
 assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(sun.shadow.camera.right,120);
 const camera=chaseCamera(),car=new THREE.Vector3(5,0,5);
 assert.equal(r.update(camera,0,car),true);assert.ok(sun.target.position.distanceTo(car)<1e-9);
 r.setLegacy(false);assert.equal(renderer.shadowMap.autoUpdate,false);r.update(camera,0);r.invalidate();assert.equal(r.update(camera,0),true);
 r.setOff(true);assert.equal(sun.shadow.intensity,0);assert.equal(r.update(camera,0),false);r.setOff(false);assert.equal(sun.shadow.intensity,1);
});

test('half-rate: a due redraw waits one frame after the last; a forced one does not',()=>{
 const {rig:r}=rig(),camera=chaseCamera(),scene=new THREE.Group(),m=mesh(1,0,1);scene.add(m);
 r.update(camera,0);r.watch(scene,0);r.setEvery(2);
 let drawn=[];for(let i=0;i<8;i++){m.position.x+=.5;m.updateMatrixWorld(true);r.watch(scene,10+i);drawn.push(r.update(camera,0));if(drawn.at(-1))r.watch(scene,10+i);}
 assert.ok(drawn.filter(Boolean).length<=5&&drawn.filter(Boolean).length>=3,'about every other frame: '+drawn);
});

test('freezing: the static world stops being recomposed, the movers do not, and a node written after the freeze is freed',()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),group=new THREE.Group(),still=mesh(1,0,0),mover=mesh(2,0,0),child=mesh(0,1,0);
 group.add(still,mover);mover.add(child);root.add(group);scene.add(root);
 const freezer=new StaticFreeze();freezer.freeze(scene,root,[mover]);
 assert.equal(scene.matrixAutoUpdate,false);assert.equal(root.matrixAutoUpdate,false);assert.equal(group.matrixAutoUpdate,false);assert.equal(still.matrixAutoUpdate,false);
 assert.equal(mover.matrixAutoUpdate,true);assert.equal(child.matrixAutoUpdate,true);
 mover.position.x=5;scene.updateMatrixWorld();assert.equal(child.matrixWorld.elements[12],5,'a mover still moves its children');
 // somebody moves a frozen node: not drawn there until audit() notices
 still.position.x=9;scene.updateMatrixWorld();assert.equal(still.matrixWorld.elements[12],1);
 freezer.audit(100);assert.equal(still.matrixAutoUpdate,true);assert.deepEqual(freezer.freed.length,1);
 scene.updateMatrixWorld();assert.equal(still.matrixWorld.elements[12],9);
 freezer.release();assert.equal(root.matrixAutoUpdate,true);assert.equal(scene.matrixAutoUpdate,true);
});

test('the governor: a CPU-bound slow window raises the CPU tier first, a GPU-bound one the level; the budget lifts after a calm window; a canvas under 8.6 Mpx never has one',()=>{
 globalThis.devicePixelRatio=3;globalThis.innerWidth=3840;globalThis.innerHeight=2160;globalThis.document={body:{dataset:{}}};
 const renderer={ratio:1.5,getPixelRatio(){return this.ratio},setPixelRatio(v){this.ratio=v}},sun={shadow:{mapSize:{x:2048,set(x,y){this.x=x;this.y=y}},map:null}},tiers=[],calls=[];
 const fake={setSize:s=>calls.push(['size',s]),setEvery:n=>calls.push(['every',n]),setOff:o=>calls.push(['off',o])};
 const q=new AdaptiveQuality(renderer,sun,{cores:8,memory:8,rig:fake,onCpu:t=>tiers.push(t)});
 assert.ok(renderer.ratio<1.5,'a 3840x2160 canvas starts under the 5 Mpx budget: '+renderer.ratio);
 for(let i=0;i<200;i++)q.sample(16,6);
 assert.equal(q.budgeted,false,'a calm window lifts it');assert.equal(renderer.ratio,1.5);
 for(let i=0;i<110;i++)q.sample(40,32);   // slow, and the main thread had most of it
 assert.equal(q.cpu,1);assert.equal(q.level,0);assert.deepEqual(tiers,[1]);assert.deepEqual(calls.filter(c=>c[0]==='every').at(-1),['every',2]);
 for(let i=0;i<110;i++)q.sample(40,32);assert.equal(q.cpu,2);assert.deepEqual(calls.filter(c=>c[0]==='off').at(-1),['off',true]);
 for(let i=0;i<110;i++)q.sample(40,8);    // slow with the main thread idle: the GPU
 assert.ok(q.level>=1,'the GPU axis moved: '+q.level);assert.ok(sun.shadow.mapSize.x<=1024);assert.equal(q.cpu,2);
});

test('a 2560x1440 canvas at 1.5 (8.3 Mpx) starts at its full ratio, so nothing re-samples after the reveal',()=>{
 globalThis.devicePixelRatio=2;globalThis.innerWidth=2560;globalThis.innerHeight=1440;globalThis.document={body:{dataset:{}}};
 const renderer={ratio:1.5,getPixelRatio(){return this.ratio},setPixelRatio(v){this.ratio=v}},sun={shadow:{mapSize:{x:2048,set(x,y){this.x=x;this.y=y}},map:null}};
 const q=new AdaptiveQuality(renderer,sun,{cores:8,memory:8});
 assert.equal(renderer.ratio,1.5);
 const seen=new Set();for(let i=0;i<600;i++){q.sample(16,6);seen.add(renderer.ratio);}
 assert.deepEqual([...seen],[1.5],'the ratio never moved');
});

test('the cut walk visits only what leads to something live; a child added to a frozen node, a node moved after the freeze and a forced update are all still right',()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),A=new THREE.Group(),B=new THREE.Group(),C=new THREE.Group(),D=new THREE.Group(),live=new THREE.Group();
 const a1=mesh(1,0,0),a2=mesh(2,0,0),b1=mesh(0,0,3),mover=mesh(0,0,0),d1=mesh(0,0,0),liveChild=mesh(0,2,0);
 A.position.set(10,0,0);A.add(a1,a2);B.add(b1,mover);D.add(d1);C.add(D);C.position.set(0,0,20);root.add(A,B,C);scene.add(root,live);live.add(liveChild);
 const visits=new Map(),spy=o=>{const own=o.updateMatrixWorld;visits.set(o,0);o.updateMatrixWorld=function(f){visits.set(this,visits.get(this)+1);return own.call(this,f);};};
 for(const o of [A,a1,a2,b1,C,D,d1,mover,liveChild])spy(o);
 const freezer=new StaticFreeze();freezer.freeze(scene,root,[mover]);
 for(const o of [A,a1,a2,b1,C,D,d1,mover])visits.set(o,0);
 for(let i=0;i<3;i++){mover.position.x=i;liveChild.position.x=-i;scene.updateMatrixWorld();}
 assert.equal(mover.matrixWorld.elements[12],2,'a mover moves');assert.equal(liveChild.matrixWorld.elements[12],-2,'what is outside the world stays live');
 for(const o of [A,a1,a2,b1,C,D,d1])assert.equal(visits.get(o),0,'a frozen subtree with nothing live in it is not walked');
 assert.equal(visits.get(mover),3);assert.equal(freezer.stats().stubs,3,'the scene, the root and B lead to something live');
 // a child added to a frozen node (one that nothing under it leads to) is on its way at once
 const added=mesh(0,0,0);added.position.x=4;A.add(added);scene.updateMatrixWorld();
 assert.equal(added.matrixWorld.elements[12],14,'a child of a frozen node is placed by its parent');assert.equal(freezer.stats().stubs,4,'A leads to something live now');
 // a node written after the freeze is freed, and from then on reached
 d1.position.x=7;freezer.audit(200);assert.equal(d1.matrixAutoUpdate,true);scene.updateMatrixWorld();
 assert.deepEqual([d1.matrixWorld.elements[12],d1.matrixWorld.elements[14]],[7,20],'the freed node is drawn where it was put, under its frozen parents');
 // a child that came by a road the event did not see (straight into the array) is found by the audit
 const sneaked=mesh(0,0,0);sneaked.parent=b1;b1.children.push(sneaked);sneaked.position.x=2;
 freezer.audit(200);scene.updateMatrixWorld();assert.equal(sneaked.matrixWorld.elements[12],2);
 // a forced update is three's own, whole
 const spied=visits.get(a1);root.updateMatrixWorld(true);assert.ok(visits.get(a1)>spied,'forced: every node');
 // flags only: the same frozen world, walked as before
 const scene2=new THREE.Scene(),root2=new THREE.Group(),n2=mesh(0,0,0);root2.add(n2);scene2.add(root2);const f2=new StaticFreeze();f2.freeze(scene2,root2,[],[],{cut:false});assert.equal(f2.stats().stubs,0);
 freezer.release();assert.equal(scene.updateMatrixWorld===THREE.Object3D.prototype.updateMatrixWorld,true,'release puts the walk back');assert.equal(root.matrixAutoUpdate,true);
});

test('what moves only a hair of shadow does not ask for a redraw: ambient (translucent water), small (a charm) and real casters (a thin sheet included) are told apart, by what they are this frame',()=>{
 const S=new Float32Array(STATICS),at=o=>{o.updateMatrixWorld(true);casterStatics(o,S,0);return measureCaster(o.matrixWorld.elements,S,0).cls;};
 const sheet=new THREE.Mesh(new THREE.BoxGeometry(1,.02,1)),water=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({transparent:true,opacity:.77})),charm=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2)),banner=new THREE.Mesh(new THREE.BoxGeometry(1.5,.9,.06)),instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(.01,.01,.01),new THREE.MeshBasicMaterial(),2);
 assert.equal(at(sheet),CASTER_NORMAL,'an opaque sheet that stands free shades a sheet of ground: a real caster');assert.equal(at(water),CASTER_AMBIENT);assert.equal(at(charm),CASTER_SMALL);assert.equal(at(banner),CASTER_NORMAL,'a 6 cm banner is cloth, its shadow waves');assert.equal(at(instanced),CASTER_NORMAL);
 // it is what it is now: a caster that grows from nothing counts as a real one once it has a shadow worth the name
 const grower=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));grower.scale.setScalar(.001);assert.equal(at(grower),CASTER_SMALL);grower.scale.setScalar(1);assert.equal(at(grower),CASTER_NORMAL);
 // the rig: each is moved well past a texel
 const {rig:r}=rig(),camera=chaseCamera(),scene=new THREE.Group(),make=(m,x)=>{m.castShadow=true;m.position.set(x,.5,1);scene.add(m);m.updateMatrixWorld(true);return m;};
 make(sheet,1);make(water,2);make(charm,3);make(banner,-1);
 const settle=()=>{for(let i=0;i<3;i++){r.update(camera,0);r.watch(scene,1000*(i+1)+settle.t++*60);}};settle.t=0;
 settle();assert.equal(r.update(camera,0),false,'settled');
 const redraws=(move)=>{move();scene.updateMatrixWorld(true);r.watch(scene,100000+settle.t++*60);const drew=r.update(camera,0);if(drew)r.watch(scene,100001+settle.t++*60);settle();return drew;};
 assert.equal(redraws(()=>{sheet.position.x+=.2;}),true,'a thin sheet that travels 20 cm: its shadow travels with it (the stones of the career walkway)');
 assert.equal(redraws(()=>{water.scale.setScalar(3);water.position.x+=.1;}),false,'translucent water that grows and drifts');
 assert.equal(redraws(()=>{charm.position.y+=.05;}),false,'a charm bobbing 5 cm');
 assert.equal(redraws(()=>{charm.position.x+=.3;}),true,'a small thing that travels 30 cm');
 assert.equal(redraws(()=>{water.position.x+=SHADOW_MOTION.thinMove+.1;}),true,'translucent water that travels 70 cm');
 assert.equal(redraws(()=>{banner.position.x+=.05;}),true,'a banner waving');
 // a ripple that comes and goes is not a reason; a small opaque thing that comes or goes is (a cookie taken, a charm swapped)
 const ripple=make(new THREE.Mesh(new THREE.BoxGeometry(.7,.03,.7),new THREE.MeshBasicMaterial({transparent:true,opacity:.5})),2);r.watch(scene,200000);assert.equal(r.update(camera,0),false,'a translucent caster that appears');settle();
 ripple.visible=false;r.watch(scene,300000);assert.equal(r.update(camera,0),false,'and goes');settle();
 const bead=make(new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1)),-2);r.watch(scene,400000);assert.equal(r.update(camera,0),true,'a small opaque one that appears');settle();
 bead.visible=false;r.watch(scene,500000);assert.equal(r.update(camera,0),true,'and goes');
});

test('the map photograph keeps the old one-texel kernel, and the game gets its own back',()=>{
 const {sun,rig:r}=rig();assert.equal(sun.shadow.radius,SHADOW_RADIUS);
 r.photograph(true);assert.equal(sun.shadow.radius,1,'the photograph: the island-wide frustum has texels as big as the old box');
 r.photograph(false);assert.equal(sun.shadow.radius,SHADOW_RADIUS);
 const legacy=rig({legacy:true});legacy.rig.photograph(false);assert.equal(legacy.sun.shadow.radius,1,'the old look stays the old look');
});

test('the 60 fps cap draws every Nth display refresh: equal gaps at 60, 72, 75, 90, 100, 120, 144, 165 and 240 Hz whatever the jitter, never under 60 fps, never a mix of long and short frames',()=>{
 const cap=1000/FRAME_CAP_FPS,want={60:1,72:1,75:1,90:1,100:1,120:2,144:2,165:2,240:4};
 let seed=7;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 for(const jitter of [0,.05,.5])for(const hz of Object.keys(want).map(Number)){
  const period=1000/hz,pacer=new FramePacer(),drew=[];
  for(let k=1;k<=hz*8;k++){const now=5000+k*period+(random()-.5)*2*jitter;pacer.observe(now);if(pacer.draw(now,cap))drew.push(k);}
  const settled=drew.filter(k=>k>hz*.5),gaps=new Set(settled.slice(1).map((k,i)=>k-settled[i]));
  assert.deepEqual([...gaps],[want[hz]],hz+' Hz, jitter '+jitter+': every gap is '+want[hz]+' refresh(es), got '+[...gaps]);
  assert.ok(hz/want[hz]>=59.9,hz+' Hz draws '+hz/want[hz]+' fps');
  assert.ok(Math.abs(pacer.refresh/period-1)<.01+jitter/period/10,hz+' Hz: the refresh was measured: '+pacer.refresh+' vs '+period);
 }
 // 90 Hz is the case the old test (gap < 16.67 - refresh/2) tied on: 11.11 against 11.11, a mix of 11 and 22 ms.
 const p90=new FramePacer();let draws=0;for(let k=1;k<=900;k++){const now=k*1000/90;p90.observe(now);if(p90.draw(now,cap))draws++;}
 assert.equal(draws,900,'90 Hz draws every refresh');
 // no cap, no gate
 const free=new FramePacer();for(let k=1;k<=50;k++){const now=k*1000/144;free.observe(now);assert.equal(free.draw(now,0),true);}
});

test('the cap holds its rhythm through a late frame, a stalled one, a display that changes rate and a throttled callback rate',()=>{
 const cap=1000/FRAME_CAP_FPS,pacer=new FramePacer(),period=1000/120,drew=[];let t=1000;
 const tick=(refreshes=1)=>{t+=refreshes*period;pacer.observe(t);if(pacer.draw(t,cap))drew.push(t);};
 for(let i=0;i<300;i++)tick();
 // a frame that ran long and missed two vsyncs, then one that missed eleven: the rate is still 120 Hz and the draws keep a whole number of refreshes apart
 tick(3);for(let i=0;i<60;i++)tick();tick(12);for(let i=0;i<200;i++)tick();
 assert.ok(Math.abs(pacer.refresh/period-1)<.01,'the refresh is still measured as 8.33 ms: '+pacer.refresh);
 const gaps=drew.slice(1).map((v,i)=>Math.round((v-drew[i])/period)),after=gaps.slice(-80);
 assert.ok(after.every(g=>g===2),'even again after the stalls: '+after.join(' '));
 assert.ok(gaps.slice(8).every(g=>g>=2),'never two draws in neighbouring refreshes once the first block has measured the display: '+gaps.slice(8).filter(g=>g<2));
 // the display goes from 120 to 90 Hz (a power mode, an external monitor): the new rhythm after a block or two
 const to90=1000/90;for(let i=0;i<150;i++){t+=to90;pacer.observe(t);if(pacer.draw(t,cap))drew.push(t);}
 const last=drew.slice(-40),g90=last.slice(1).map((v,i)=>+(v-last[i]).toFixed(1));
 assert.ok(g90.every(g=>Math.abs(g-to90)<.3),'every refresh at 90 Hz: '+g90.slice(0,8));
 // timestamps that are not a display's (a gap of a fraction of a millisecond, a long pause) leave the measurement alone
 const before=pacer.refresh;for(const gap of [.2,150,.1,500]){t+=gap;pacer.observe(t);}
 assert.equal(pacer.refresh,before);
 // a callback rate throttled to 30 (a low-power mode): nothing to skip, every callback draws
 const slow=new FramePacer();let n=0;for(let k=1;k<=200;k++){const now=k*1000/30;slow.observe(now);if(slow.draw(now,cap))n++;}
 assert.equal(n,200);
});

test('the gate this replaced (gap < cap - refresh/2, refresh smoothed) is a tie at 90 Hz: the same clock gives it a mix of one- and two-refresh gaps (the negative control of the test above)',()=>{
 const cap=1000/60,period=1000/90;let seed=3;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 let previous=0,last=0,refresh=16.7;const gaps=new Set(),drew=[];
 for(let k=1;k<=900;k++){
  const now=5000+k*period+(random()-.5)*.1;
  if(last){const gap=now-last;if(gap>2&&gap<100)refresh+=(gap-refresh)*.1;}last=now;
  if(now-previous<cap-refresh*.5)continue;previous=now;drew.push(k);
 }
 for(let i=1;i<drew.length;i++)if(drew[i-1]>200)gaps.add(drew[i]-drew[i-1]);
 assert.ok(gaps.size>1,'the old gate judders at 90 Hz: gaps '+[...gaps]);
});

/** A camera a few metres from a board, looking at it (the Projects board's cinematic: 5 to 10 m on a desktop, pulled back on a phone). */
function boardCamera(distance=6){
 const camera=new THREE.PerspectiveCamera(25,16/10,.1,800);camera.position.set(0,1.2,distance);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);return camera;
}
/** A rig settled on `scene` and `camera` (everything found, nothing pending), `flip(move)` applies a change to the world and says whether the next frame redraws the shadow. */
function settled(camera,cinematic,build){
 const {rig:r}=rig(),scene=new THREE.Group(),things=build(scene);scene.updateMatrixWorld(true);
 let clock=0;const settle=()=>{for(let i=0;i<3;i++){r.update(camera,0,null,cinematic);r.watch(scene,clock+=60);}};
 settle();assert.equal(r.update(camera,0,null,cinematic),false,'settled');
 return {r,scene,...things,flip(change){change();scene.updateMatrixWorld(true);r.watch(scene,clock+=60);const drew=r.update(camera,0,null,cinematic);if(drew)r.watch(scene,clock+=60);settle();return drew;}};
}
const sheetWorld=scene=>{const sheet=new THREE.Mesh(new THREE.BoxGeometry(1,.02,.6)),charm=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2));
 for(const m of [sheet,charm]){m.castShadow=true;scene.add(m);}sheet.position.set(0,1,0);charm.position.set(1,1,0);return {sheet,charm};};

test('a panel that only turns (a title that flips on a board: no translation, a thin sheet) redraws the shadow, up close and from the chase camera, and growing translucent water does not',()=>{
 for(const [name,camera,cinematic] of [['board camera',boardCamera(6),false],['cinematic',boardCamera(6),true],['chase camera',chaseCamera(new THREE.Vector3(0,1,0)),false]]){
  const w=settled(camera,cinematic,sheetWorld);
  assert.equal(w.flip(()=>{w.sheet.rotation.x+=.3;}),true,name+': a sheet that turns 0.3 rad');
  assert.equal(w.flip(()=>{w.sheet.rotation.x+=.3;}),true,name+': and again');
  assert.equal(w.flip(()=>{w.sheet.position.x+=.2;}),true,name+': a sheet that slides 20 cm');
 }
 const water=settled(chaseCamera(new THREE.Vector3(0,1,0)),false,scene=>{const m=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({transparent:true,opacity:.77}));m.castShadow=true;m.position.set(2,.5,0);scene.add(m);return {water:m};});
 assert.equal(water.flip(()=>{water.water.scale.setScalar(3);}),false,'translucent water that only grows');
 assert.equal(water.flip(()=>{water.water.scale.setScalar(5);water.water.position.x+=.1;}),false,'and drifts 10 cm');
 const turning=settled(chaseCamera(new THREE.Vector3(0,1,0)),false,scene=>{const m=new THREE.Mesh(new THREE.BoxGeometry(2,.02,2),new THREE.MeshBasicMaterial({transparent:true,opacity:.6}));m.castShadow=true;m.position.set(2,.5,0);scene.add(m);return {pane:m};});
 assert.equal(turning.flip(()=>{turning.pane.rotation.x+=.3;}),true,'a translucent sheet that turns 0.3 rad swings its edge a texel and more');
});

test('close to the camera every class is a real caster; the same motion from the chase camera is not a reason',()=>{
 // a 4 mm turn of a sheet, a 1 cm bob of a charm
 const near=settled(boardCamera(6),false,sheetWorld),far=settled(chaseCamera(new THREE.Vector3(0,1,0)),false,sheetWorld);
 assert.equal(near.flip(()=>{near.sheet.rotation.x+=.006;}),true,'a turn of 6 mrad of a sheet, up close');
 assert.equal(near.flip(()=>{near.charm.position.y+=.01;}),true,'a charm bobbing 1 cm, up close');
 assert.equal(far.flip(()=>{far.sheet.rotation.x+=.006;}),false,'the same turn from the chase camera');
 assert.equal(far.flip(()=>{far.charm.position.y+=.01;}),false,'the same bob from the chase camera');
 // 20 m away is not close, unless the view is a cinematic one (a phone pulls the board\'s camera back)
 const away=boardCamera(20),a=settled(away,false,sheetWorld),c=settled(away,true,sheetWorld);
 assert.equal(a.flip(()=>{a.charm.position.y+=.01;}),false,'20 m from the camera');
 assert.equal(c.flip(()=>{c.charm.position.y+=.01;}),true,'20 m from a cinematic camera');
 // a caster that appears or goes close to the camera asks for a redraw by itself; a ripple far from it does not
 const vis=settled(boardCamera(6),false,sheetWorld);
 vis.r.watch(vis.scene,1e6);vis.charm.visible=false;vis.r.watch(vis.scene,2e6);assert.equal(vis.r.update(boardCamera(6),0),true,'a charm that goes, up close');
 const ripple=settled(chaseCamera(new THREE.Vector3(0,1,0)),false,scene=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.7,.03,.7),new THREE.MeshBasicMaterial({transparent:true,opacity:.5}));m.castShadow=true;m.position.set(1,1,0);scene.add(m);return {ripple:m};});
 ripple.ripple.visible=false;ripple.r.watch(ripple.scene,3e6);assert.equal(ripple.r.update(chaseCamera(new THREE.Vector3(0,1,0)),0),false,'a translucent one that goes, far from it');
 const near2=settled(boardCamera(6),false,scene=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.7,.03,.7),new THREE.MeshBasicMaterial({transparent:true,opacity:.5}));m.castShadow=true;m.position.set(1,1,0);scene.add(m);return {ripple:m};});
 near2.ripple.visible=false;near2.r.watch(near2.scene,3e6);assert.equal(near2.r.update(boardCamera(6),0),true,'and up close');
});

test('a cinematic view is fitted to 60 m of ground, and its poses are read before the frame is drawn',()=>{
 const flat=boardCamera(8),out=new Float64Array(15),focus=new THREE.Vector3(),scratch={point:new THREE.Vector3(),dir:new THREE.Vector3()};
 flat.position.set(0,3.5,8);flat.lookAt(0,1.6,-2);flat.updateMatrixWorld(true);
 const wide=viewPoints(flat,0,out,focus,scratch),close=viewPoints(flat,0,out,focus,scratch,{reach:SHADOW_BOX.closeReach,top:SHADOW_BOX.top});
 assert.ok(wide>70&&close<=SHADOW_BOX.closeReach+.001,'ground in view '+wide+' (110 m reach) against '+close);
 const a=rig(),b=rig();a.rig.update(flat,0,null,false);b.rig.update(flat,0,null,true);
 assert.ok(b.rig.half<a.rig.half,'the box is '+a.rig.half+' m wide and the cinematic one '+b.rig.half+' (a finer texel up close)');
 // compare() before update(): the frame that moves the panel is the frame that draws its shadow
 const w=settled(flat,true,sheetWorld);
 w.sheet.rotation.x+=.4;w.scene.updateMatrixWorld(true);w.r.compare(flat,true);
 assert.equal(w.r.update(flat,0,null,true),true,'drawn in the same frame, with no post-render watch in between');
 w.r.watch(w.scene,5e6);assert.equal(w.r.update(flat,0,null,true),false,'and nothing is left pending');
});

test('how far a matrix has turned is blind to its scale',()=>{
 const m=new THREE.Matrix4().compose(new THREE.Vector3(1,2,3),new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,0,0)),new THREE.Vector3(3,3,3)),ref=new Float64Array(16);
 const base=new THREE.Matrix4().compose(new THREE.Vector3(1,2,3),new THREE.Quaternion(),new THREE.Vector3(3,3,3));ref.set(base.elements);
 assert.ok(Math.abs(turnedBy(m.elements,ref,0)-.3)<.05,'a 0.3 rad turn: '+turnedBy(m.elements,ref,0));
 const grown=new THREE.Matrix4().compose(new THREE.Vector3(1,2,3),new THREE.Quaternion(),new THREE.Vector3(9,.2,5));
 assert.ok(turnedBy(grown.elements,ref,0)<1e-6,'a matrix that only changed scale has not turned: '+turnedBy(grown.elements,ref,0));
});

test('a display that changes its rate (adaptive refresh, a power mode) is followed within a few callbacks, with no judder in between',()=>{
 const cap=1000/FRAME_CAP_FPS,pacer=new FramePacer();let t=1000,seed=11;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 const drew=[];
 const run=(hz,count)=>{const period=1000/hz,mine=[];for(let i=0;i<count;i++){t+=period;const now=t+(random()-.5)*.1;pacer.observe(now);if(pacer.draw(now,cap))mine.push(now);}drew.push(...mine);return {period,mine};};
 const want={60:1,90:1,120:2,144:2,100:1,240:4};
 let previous=null;
 for(const hz of [60,120,90,144,60,100,240,120,60]){
  const {period,mine}=run(hz,hz*2),after=mine.slice(8),gaps=new Set(after.slice(1).map((v,i)=>Math.round((v-after[i])/period)));
  assert.deepEqual([...gaps],[want[hz]],(previous?previous+' to ':'')+hz+' Hz: even after 8 draws, gaps '+[...gaps]);
  previous=hz;
 }
 // how fast: callbacks from the switch to the first draw that has the new rhythm
 const lag=(from,to)=>{const p=new FramePacer();let t0=0;const feed=(hz,n)=>{for(let i=0;i<n;i++){t0+=1000/hz;p.observe(t0);p.draw(t0,cap);}};feed(from,120);let n=0;const wantEvery=Math.max(1,Math.floor(to/60+.05));for(;n<60;n++){feed(to,1);if(p.every===wantEvery&&Math.abs(p.refresh-1000/to)<.05)break;}return n+1;};
 for(const [a,b] of [[60,120],[120,90],[90,144],[144,60],[100,240]])assert.ok(lag(a,b)<=5,a+' to '+b+' Hz: the new refresh is known after '+lag(a,b)+' callbacks');
});

/** What main.js hands update() (the scene, the time, the matrices made current), and a frame of the loop: update(), the render (nothing here), watch(). */
function loop(scene,camera,r,cinematic=false){
 const f={scene,now:0,prepared:0,prepare(){f.prepared++;scene.updateMatrixWorld(true);}};
 return {f,frame(change){change?.();f.now+=16;const drew=r.update(camera,0,null,cinematic,f);r.watch(scene,f.now);return drew;}};
}

test('with a frame, the poses are read before the draw: the frame that moves a caster draws its shadow, and a caster that appears has its shadow in its first frame',()=>{
 const {rig:r}=rig(),scene=new THREE.Group(),camera=chaseCamera(new THREE.Vector3(0,1,0)),{f,frame}=loop(scene,camera,r);
 const card=new THREE.Mesh(new THREE.BoxGeometry(1,.02,1));card.castShadow=true;card.position.set(1,1,0);scene.add(card);
 assert.equal(frame(),true,'the first frame draws');assert.equal(frame(),false,'the casters were found in it, nothing is pending');
 for(let i=0;i<30;i++)assert.equal(frame(),false,'parked frame '+i);
 assert.equal(f.prepared,32,'the world matrices are made current once per frame, by the caller');
 // a card that rises (the career stones: thin, opaque, a few cm to 10 cm a frame): every one of those frames draws the pose it shows, the first included
 for(let i=0;i<12;i++)assert.equal(frame(()=>{card.position.y+=.06;}),true,'rising, frame '+i);
 assert.equal(frame(),false,'and at rest the frame after it');
 // the first frame of a turn of a flipping panel
 assert.equal(frame(()=>{card.rotation.x+=.05;}),true,'a sheet that has just started to turn');
 // a cookie taken from the jar: a big caster that appears and starts to fall
 const cookie=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,.5));cookie.castShadow=true;cookie.position.set(3,.7,2);
 assert.equal(frame(()=>scene.add(cookie)),true,'a caster that appears is drawn in its first frame');
 assert.equal(frame(),false);
 assert.equal(frame(()=>{cookie.removeFromParent();}),true,'and the frame it goes');
 // a translucent one (a ripple) neither comes nor goes with a redraw
 const ripple=new THREE.Mesh(new THREE.BoxGeometry(.7,.03,.7),new THREE.MeshBasicMaterial({transparent:true,opacity:.5}));ripple.castShadow=true;
 assert.equal(frame(()=>scene.add(ripple)),false,'ripple in');assert.equal(frame(()=>{ripple.visible=false;}),false,'ripple out');
});

test('the list of casters is rebuilt the frame a child comes or goes anywhere in the scene (an event), and every 50 ms for what has no event',()=>{
 const {rig:r}=rig(),scene=new THREE.Group(),inner=new THREE.Group(),empty=new THREE.Group(),camera=chaseCamera(new THREE.Vector3(0,1,0)),{frame}=loop(scene,camera,r);
 const m=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));m.castShadow=true;m.position.set(1,.5,0);inner.add(m);scene.add(inner,empty);
 for(let i=0;i<4;i++)frame();
 const a=r.state().scans;for(let i=0;i<64;i++)frame();
 const parked=r.state().scans-a;assert.ok(parked>=14&&parked<=17,'64 parked frames of 16 ms: '+parked+' scans, one in the first frame that is '+SHADOW_RESCAN+' ms after the last (every fourth), not one a frame');
 // a child added deep in the scene, to a group that was empty when the rig first walked it, and one taken away: the next frame
 const before=r.state().scans,cookie=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,.5));cookie.castShadow=true;cookie.position.set(3,.7,2);
 assert.equal(frame(()=>empty.add(cookie)),true,'a cookie into a group that had no child: drawn in its first frame');assert.equal(r.state().scans,before+1,'one rebuild, for the event');
 assert.equal(frame(()=>inner.remove(m)),true,'a caster taken away');
 assert.equal(frame(()=>inner.add(m)),true,'and put back');
 // a node that is shown has no event: the scan finds it within the 50 ms
 const hidden=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));hidden.castShadow=true;hidden.visible=false;hidden.position.set(-1,.5,0);inner.add(hidden);frame();frame();
 let seen=-1;for(let i=0;i<8&&seen<0;i++)if(frame(i===0?()=>{hidden.visible=true;}:null))seen=i;
 assert.ok(seen>=0&&seen<=4,'a node shown is seen in frame '+seen+' (three frames of 16 ms at most)');
 // under CPU strain the same, with the half-rate wait for the redraw
 r.setEvery(2);const late=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));late.castShadow=true;late.position.set(-3,.5,0);
 let drawn=-1;for(let i=0;i<8&&drawn<0;i++)if(frame(i===0?()=>scene.add(late):null))drawn=i;
 assert.ok(drawn>=0&&drawn<=2,'a caster that appears under CPU strain is drawn within the half-rate wait: frame '+drawn);
});

test('an update without a frame still reads the poses in watch(), after the render (the tests, the map\'s photograph, a caller that has no way to make the matrices current)',()=>{
 const {rig:r}=rig(),scene=new THREE.Group(),camera=chaseCamera(new THREE.Vector3(0,1,0)),m=mesh(1,.5,0);scene.add(m);
 r.update(camera,0);r.watch(scene,0);r.update(camera,0);r.watch(scene,16);
 assert.equal(r.update(camera,0),false);r.watch(scene,32);
 m.position.x+=.5;m.updateMatrixWorld(true);
 assert.equal(r.update(camera,0),false,'this frame is drawn with the shadow of the pose before');r.watch(scene,48);
 assert.equal(r.update(camera,0),true,'and the next one draws it');
});

test('a scene whose casters come and go every frame (a chain of crates, debris) stops allocating once its buffers have grown',()=>{
 const {rig:r}=rig(),scene=new THREE.Group(),camera=chaseCamera(new THREE.Vector3(0,1,0)),{frame}=loop(scene,camera,r),blink=[];
 for(let i=0;i<40;i++){const m=mesh(i%7-3,.5,Math.floor(i/7)-3,.3);if(i>=30)blink.push(m);else scene.add(m);}
 const toggle=(i,mod)=>blink.forEach((m,k)=>{if((i+k)%mod!==0){if(!m.parent)scene.add(m);}else m.removeFromParent();});
 for(let i=0;i<12;i++)frame(()=>toggle(i,2));
 const caps=()=>[r.ref.length,r.refSpare.length,r.statics.length,r.staticsSpare.length,r.kept.length].join();
 const before=caps(),scans=r.state().scans;
 let redraws=0;for(let i=0;i<200;i++)if(frame(()=>toggle(i,3)))redraws++;
 assert.equal(caps(),before,'the buffers did not grow again');
 assert.ok(redraws>150,'every change of casters is a reason: '+redraws);
 assert.ok(r.state().scans-scans>=190,'and a rebuild: '+(r.state().scans-scans));
 assert.equal(r.watched.length,scene.children.filter(m=>m.isMesh).length,'the list is the casters in the scene');
});
