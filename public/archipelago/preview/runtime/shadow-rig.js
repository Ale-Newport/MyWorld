import * as THREE from 'three';

/* The sun's shadow, fitted to what the chase camera can see, and redrawn only when something it shows has changed.
 *
 * Before: one 2048 map over 240 x 220 m (about 80-180 times the ground a 15-30 m chase camera sees), re-rendered every frame
 * from a light that followed the car by fractions of a texel, so shadow edges crawled; the pass was 85 % of the draw calls.
 *
 *   fit     the ortho box is the light-space bounding square of what the camera can see (its frustum, cut off at the ground and at `reach` m),
 *           plus a margin; for the 21 m chase camera that is about +/-30 m, 20 % of the old box's width, and the 15-30 m camera, a portrait phone's
 *           56 m and a cinematic camera all get their own. Quantised in 4 m steps with a hysteresis (a continuous size would move the texel grid
 *           every frame and the shadows would swim), 24-96 m, never wider than the old fixed box.
 *           (A caster and the ground it shades share the same light-space x and y, so what a box has to cover laterally is the receivers in view.)
 *   snap    its centre moves in whole texels along the light's right and up axes
 *   redraw  only when the snapped centre or the box changed, or a shadow caster that can put a shadow in view has moved three quarters of a texel
 *           since the map was last drawn. update() reads the poses itself, before the frame is drawn (main.js makes the world matrices current and hands it a `frame`): the frame that
 *           moves a caster is the frame that draws its shadow, never the one after, and a caster that has just appeared (a cookie taken from the jar) has its shadow in its first frame.
 *           Every visible shadow-casting mesh (an InstancedMesh by its instanceMatrix version) is compared with its world matrix at the last redraw; where its shadow would land on the
 *           ground is what decides whether it counts (a balloon bobbing 60 m away does not redraw the shadow of a parked car). A parked car in a quiet street costs no shadow pass.
 *           The list of casters (what is visible, what appeared, what went) is rebuilt the frame a child is added or removed anywhere in the scene (the groups tell the rig: a cookie from the jar has its shadow in
 *           its first frame) and every 50 ms for what tells it nothing (a node that was hidden and is shown).
 *           What moves only a hair of shadow does not count (SHADOW_MOTION): a translucent caster (the fountain's water: ripples, plumes, streams) matters only when it travels 60 cm or when
 *           its turning swings its edge (up to a metre of it) by 3/4 texel; a caster under 30 cm across, 10 cm (a charm bobbing on a sign, not a ball rolling); a translucent one appearing or
 *           going asks for no redraw. They are drawn into the map whenever it is redrawn for any other reason. Everything else, thin sheets included (the stones of the career walkway
 *           rise as cards, and a card that stands free shades a card's worth of ground; only text lying on a board hides its shadow in the board's), 3/4 texel: a waving banner's shadow waves, a few times a second.
 *           Close up none of that holds. A caster within 10 m of the camera, or within 30 m while the view is a cinematic one (the Projects board's: a phone pulls it back), is seen at ten
 *           pixels and more to a texel (a metre of a board is 300 px on a desktop): every class counts as a real caster and 2 mm of motion is a reason, so a panel that flips never shows
 *           its shadow of a moment ago. A cinematic view is also fitted to 60 m of ground rather than 110.
 *
 * The renderer-level gate (shadowMap.autoUpdate=false + needsUpdate) is the one used here, so whatever else renders in between (the map's
 * photograph, QA) composes with it: main.js calls invalidate() when a frame other than its own was drawn.
 * `?shadow=legacy` restores the old fixed box and the every-frame redraw, for A/B. */

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const SHADOW_RADIUS=2;
export const SHADOW_BOX={min:24,max:96,margin:6,step:4,hysteresis:8,reach:110,top:40,closeReach:60};
/** What of a caster's motion is worth a redraw (metres): an ambient caster (a translucent one) counts when it has travelled `thinMove`, or when its turning has moved its edge (a radius of at most `sheet`)
 * as far as any caster's must, a small one (bounding radius under `small`) `smallMove`. Close to the camera (`near` m, `nearCinematic` in a cinematic view) every caster is a real one and `detail`
 * is all the motion it takes. */
export const SHADOW_MOTION={thinMove:.6,sheet:1,small:.3,smallMove:.1,near:10,nearCinematic:30,nearRadius:3,detail:.002};
/** How long the list of casters is kept (ms) when no child has come or gone: what has no event (a node shown), and `watch()` callers that read the poses after the frame. */
export const SHADOW_RESCAN=50;
export const CASTER_NORMAL=0,CASTER_SMALL=1,CASTER_AMBIENT=2;
/** A caster's own numbers, `STATICS` to a caster, taken when the list is rebuilt: the radius of its geometry, whether it is an instanced mesh (its instances' own sizes are not known here: always a real caster),
 * and whether its material is translucent. `out` is filled at `at`. */
export const STATICS=3;
const translucent=o=>{const m=Array.isArray(o.material)?o.material[0]:o.material;return m?.transparent&&m.opacity<1?1:0;};
export function casterStatics(o,out,at=0){
 const g=o.geometry;let radius=1;
 if(g){g.boundingSphere??g.computeBoundingSphere();radius=g.boundingSphere?.radius??1;}
 out[at]=radius;out[at+1]=o.isInstancedMesh?1:0;out[at+2]=translucent(o);
 return out;
}
const measured={cls:CASTER_NORMAL,radius:1};
const CLOSE_VIEW={reach:SHADOW_BOX.closeReach,top:SHADOW_BOX.top};
/** The nine elements of a world matrix that hold its axes (column-major). */
const AXIS_ELEMENTS=[0,1,2,4,5,6,8,9,10];
/** How far the axes of a world matrix `e` have turned from the pose `ref` holds at `at` (the largest change of any unit axis: about the angle, and blind to scale). */
export function turnedBy(e,ref,at){
 let t=0;
 for(let a=0;a<12;a+=4){
  const s=Math.hypot(e[a],e[a+1],e[a+2]),r=Math.hypot(ref[at+a],ref[at+a+1],ref[at+a+2]);
  if(!(s>1e-9&&r>1e-9))continue;
  t=Math.max(t,Math.abs(e[a]/s-ref[at+a]/r),Math.abs(e[a+1]/s-ref[at+a+1]/r),Math.abs(e[a+2]/s-ref[at+a+2]/r));
 }
 return t;
}
/** How a caster's motion counts right now, from its world matrix `e` (its size is what it is this frame, so a caster that grows from nothing counts as a real one once it has a shadow worth the name) and its statics at `at`.
 * Fills and returns `{cls, radius}` (radius: its geometry's, scaled). A thin sheet is not a class of its own: one that stands free (a card, a stone's top) shades as much ground as it covers. */
export function measureCaster(e,S,at,{small}=SHADOW_MOTION){
 const radius=S[at]*Math.sqrt(Math.max(e[0]*e[0]+e[1]*e[1]+e[2]*e[2],e[4]*e[4]+e[5]*e[5]+e[6]*e[6],e[8]*e[8]+e[9]*e[9]+e[10]*e[10]));
 measured.radius=radius;
 // (An instanced mesh, whose instances are of any size: always a real caster.)
 measured.cls=S[at+1]===1?CASTER_NORMAL:S[at+2]===1?CASTER_AMBIENT:radius<small?CASTER_SMALL:CASTER_NORMAL;
 return measured;
}

/** Half the width of the shadow box for a wanted `half`: quantised in `step` m; it only shrinks once the wanted size is `hysteresis` m under the current one. */
export function boxHalf(wanted,current=0,{min,max,step,hysteresis}=SHADOW_BOX){
 wanted=clamp(wanted,min,max);const stepped=Math.min(max,Math.ceil(wanted/step)*step);
 if(!current)return stepped;
 return wanted>current||wanted<current-hysteresis?stepped:current;
}
/** What the camera sees, as points: its own position and, along each of its four corner rays, where the ray meets the ground (a plane at `groundY`) or, for a ray that does not go
 * down, where it leaves the slab `top` m above the ground; never farther than `reach` m. Writes the points to `out` (a Float64Array of 15) and the ground point where the camera's axis
 * lands to `focus`; returns the farthest a ground point is from `focus` (the ground in view). */
export function viewPoints(camera,groundY,out,focus,scratch,{reach=SHADOW_BOX.reach,top=SHADOW_BOX.top}={}){
 const c=camera.position,p=scratch.point,d=scratch.dir;
 out[0]=c.x;out[1]=c.y;out[2]=c.z;
 camera.getWorldDirection(d);
 const t=d.y<-.05?clamp((groundY-c.y)/d.y,8,reach):d.y>.05&&c.y<groundY+top?clamp((groundY+top-c.y)/d.y,8,reach):Math.min(60,reach);
 focus.copy(d).multiplyScalar(t).add(c);
 let far=0;
 for(let k=0;k<4;k++){
  p.set(k&1?1:-1,k&2?1:-1,.5).unproject(camera);d.copy(p).sub(c).normalize();
  const tt=d.y<-.05?clamp((groundY-c.y)/d.y,0,reach):d.y>.05&&c.y<groundY+top?clamp((groundY+top-c.y)/d.y,0,reach):reach;
  const x=c.x+d.x*tt,y=c.y+d.y*tt,z=c.z+d.z*tt,at=3+k*3;out[at]=x;out[at+1]=y;out[at+2]=z;
  far=Math.max(far,Math.hypot(x-focus.x,z-focus.z));
 }
 return Math.min(reach,far);
}

/** Every visible mesh that casts a shadow, in scene order, into `out`; and every node that can have children is listened to (`rig.onStructure`): a child that comes or goes there is the rig's cue to
 * rebuild its list now. (A node that is hidden is not walked, so it is not listened to until it is shown: the 50 ms scan finds it.) */
function collect(o,out,rig){
 if(!o.visible)return;
 if(o.isMesh&&o.castShadow)out.push(o);
 const c=o.children;
 if((!o.isMesh||c.length>0)&&!rig.listening.has(o)){rig.listening.add(o);o.addEventListener('childadded',rig.onStructure);o.addEventListener('childremoved',rig.onStructure);}
 for(let i=0;i<c.length;i++)collect(c[i],out,rig);
}

export class ShadowRig{
 constructor({renderer,sun,offset,size=2048,legacy=false,legacyBox={left:-120,right:120,top:110,bottom:-110,near:1,far:420}}){
  Object.assign(this,{renderer,sun,legacy,legacyBox,size});
  this.offset=offset.clone();this.dir=offset.clone().normalize();this.length=offset.length();
  this.right=new THREE.Vector3(0,1,0).cross(this.dir).normalize();this.up=new THREE.Vector3().crossVectors(this.dir,this.right).normalize();
  this.half=0;this.ix=NaN;this.iy=NaN;this.dirty=true;this.moved=false;this.every=1;this.waited=0;this.off=false;this.target=new THREE.Vector3();
  this.watched=[];this.found=[];this.ref=new Float64Array(0);this.versions=[];this.statics=new Float32Array(0);this.refSpare=new Float64Array(0);this.versionsSpare=[];this.staticsSpare=new Float32Array(0);this.kept=new Uint8Array(0);this.was=new Map();this.scannedAt=-Infinity;this.structure=false;this.listening=new WeakSet();this.onStructure=()=>{this.structure=true;};this.pre=false;this.centre=new THREE.Vector3();
  this.view={x:0,y:0,z:0,r:30};this.cam=new THREE.Vector3();this.close=false;this.threshold=.03;this.drew=false;this.points=new Float64Array(15);this.focus=new THREE.Vector3();this.scratch={point:new THREE.Vector3(),dir:new THREE.Vector3()};
  this.stats={frames:0,passes:0,scans:0,onEvent:0,watchMs:0,why:{dirty:0,moved:0,centre:0,skipped:0}};
  renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate=legacy;
  // Texels 4x finer than the old box's: the kernel is two of them wide, which keeps the soft edge the world has always had without the stair-steps of one.
  sun.shadow.radius=legacy?1:SHADOW_RADIUS;
  if(legacy)Object.assign(sun.shadow.camera,legacyBox),sun.shadow.camera.updateProjectionMatrix();
 }
 /** A/B: the old fixed box redrawn every frame (`?shadow=legacy`), or back to the fitted one. */
 setLegacy(on){
  if(on===this.legacy)return;this.legacy=on;this.renderer.shadowMap.autoUpdate=on;this.sun.shadow.radius=on?1:SHADOW_RADIUS;
  if(on){Object.assign(this.sun.shadow.camera,this.legacyBox);this.sun.shadow.camera.updateProjectionMatrix();}else{this.half=0;this.ix=this.iy=NaN;}
  this.dirty=true;
 }
 /** The map's photograph is shot with a sun frustum as wide as the island, texels as big as the old box's: it keeps the old one-texel kernel (a kernel of two would soften it twice over). */
 photograph(on){this.sun.shadow.radius=on||this.legacy?1:SHADOW_RADIUS;}
 /** The map was re-created at another size (runtime/quality.js). */
 setSize(size){if(size===this.size)return;this.size=size;this.ix=this.iy=NaN;this.dirty=true;}
 /** Redraw on the next frame whatever else is true. */
 invalidate(){this.dirty=true;}
 /** Frames of the shadow pass skipped between two redraws (1: every frame that needs one). */
 setEvery(n){this.every=Math.max(1,n|0);}
 /** Off: nothing is drawn and the sun's shadow is invisible (the shader variant stays, so no program is rebuilt). */
 setOff(off){if(off===this.off)return;this.off=off;this.sun.shadow.intensity=off?0:1;this.dirty=true;}
 box(half){
  const c=this.sun.shadow.camera;
  Object.assign(c,{left:-half,right:half,top:half,bottom:-half,near:Math.max(1,this.length-half-110),far:this.length+half+90});c.updateProjectionMatrix();
 }
 /** The shadow camera is placed from the sun's and its target's world matrices: with the caller's matrices made current before this frame's update() (`frame`), the render no longer does it after. */
 placeSun(){this.sun.updateMatrixWorld();this.sun.target.updateMatrixWorld();}
 /** Called once per frame before the render: fits the box to what `camera` sees of the ground at `groundY`, places the sun, and says whether the shadow map is redrawn.
  * `cinematic`: the view is a cinematic one (a board up close): see the header.
  * `frame`: `{scene, now, prepare()}`, the way main.js calls it: `prepare()` makes the world matrices current (the render that follows must not redo them), the list of casters is
  * rebuilt and every caster's pose read before the decision, so the shadow drawn is of the pose that is drawn. Without it (`watch()` after the render, the tests) the poses are read when `watch()` runs. */
 update(camera,groundY,car=null,cinematic=false,frame=null){
  const stats=this.stats;stats.frames++;this.drew=false;this.close=cinematic;this.cam.copy(camera.position);this.pre=frame!==null;
  if(frame)frame.prepare();
  const pts=this.points,focus=this.focus,visible=viewPoints(camera,groundY,pts,focus,this.scratch,cinematic?CLOSE_VIEW:undefined);
  if(this.legacy){const at=car??focus;this.sun.position.copy(at).add(this.offset);this.sun.target.position.copy(at);this.placeSun();stats.passes++;this.drew=true;return true;}
  this.view.x=focus.x;this.view.y=groundY;this.view.z=focus.z;this.view.r=visible;
  if(this.off)return false;
  // What is there and where it is, before the decision: the list of casters is rebuilt the frame a child comes or goes anywhere in the scene (an event), and every 50 ms for what has no event (a node shown).
  let t0=0;
  if(frame){t0=performance.now();this.scan(frame.scene,frame.now);stats.watchMs+=performance.now()-t0;}
  // The light-space rectangle the camera's view covers.
  const R=this.right,U=this.up;let r0=Infinity,r1=-Infinity,u0=Infinity,u1=-Infinity;
  for(let k=0;k<15;k+=3){const x=pts[k],y=pts[k+1],z=pts[k+2],r=x*R.x+y*R.y+z*R.z,u=x*U.x+y*U.y+z*U.z;if(r<r0)r0=r;if(r>r1)r1=r;if(u<u0)u0=u;if(u>u1)u1=u;}
  const half=boxHalf(Math.max(r1-r0,u1-u0)/2+SHADOW_BOX.margin,this.half),texel=2*half/this.size,ix=Math.round((r0+r1)/2/texel),iy=Math.round((u0+u1)/2/texel);
  const centre=half!==this.half||ix!==this.ix||iy!==this.iy;
  // (A redraw that is due anyway has no use for the comparison.)
  if(frame&&!centre&&!this.dirty){t0=performance.now();this.compare();stats.watchMs+=performance.now()-t0;}
  const need=this.dirty||this.moved||centre;
  if(!need)return false;
  const why=stats.why;
  // Half-rate (the governor's CPU tier): a redraw due now waits for the frame after the last one.
  if(this.every>1&&!this.dirty&&this.waited<this.every-1){this.waited++;why.skipped++;return false;}
  if(this.dirty)why.dirty++;if(this.moved)why.moved++;if(centre)why.centre++;
  this.waited=0;
  if(half!==this.half){this.half=half;this.box(half);}
  this.ix=ix;this.iy=iy;this.dirty=false;this.moved=false;this.threshold=texel*.75;
  const t=this.target;t.copy(R).multiplyScalar(ix*texel).addScaledVector(U,iy*texel).addScaledVector(this.dir,focus.dot(this.dir));
  this.sun.target.position.copy(t);this.sun.position.copy(t).addScaledVector(this.dir,this.length);this.placeSun();
  this.centre.copy(t);
  this.renderer.shadowMap.needsUpdate=true;stats.passes++;this.drew=true;
  return true;
 }

 /** Is a caster at world matrix `e`, of bounding radius `radius`, close enough to the camera to be seen at ten pixels or more to a texel? */
 nearCamera(e,radius){
  const cam=this.cam;
  return Math.hypot(e[12]-cam.x,e[13]-cam.y,e[14]-cam.z)-Math.min(radius,SHADOW_MOTION.nearRadius)<(this.close?SHADOW_MOTION.nearCinematic:SHADOW_MOTION.near);
 }
 /** Has a caster that is visible moved enough, since the map was last drawn, to put a different shadow in view? Sets `moved`. Reads the world matrices as they are: `update()` calls it, with the
  * camera and the mode it was given, once main.js has made them current (the frame that moves a caster draws its shadow); a caller that has no `frame` gets it from `watch()`, after the render. */
 compare(camera=null,cinematic=false){
  if(this.legacy||this.off||this.moved)return;
  if(camera){this.cam.copy(camera.position);this.close=cinematic;}
  const list=this.watched,ref=this.ref,versions=this.versions,thr=this.threshold,dir=this.dir,view=this.view,reach=view.r,slope=Math.max(.2,dir.y);
  for(let i=0;i<list.length&&!this.moved;i++){
   const o=list[i],e=o.matrixWorld.elements,at=i*16;let same=true;
   for(let k=0;k<16;k++)if(e[k]!==ref[at+k]){same=false;break;}
   const version=o.isInstancedMesh?o.instanceMatrix.version:0;
   if(same&&version===versions[i])continue;
   if(version!==versions[i]){this.moved=true;break;}
   // How far its surface has moved: the origin, plus its radius times how much its axes turned or scaled.
   const move=Math.max(Math.abs(e[12]-ref[at+12]),Math.abs(e[13]-ref[at+13]),Math.abs(e[14]-ref[at+14]));
   let turn=0;for(let a=0;a<AXIS_ELEMENTS.length;a++)turn=Math.max(turn,Math.abs(e[AXIS_ELEMENTS[a]]-ref[at+AXIS_ELEMENTS[a]]));
   const q=measureCaster(e,this.statics,i*STATICS),radius=q.radius,cls=q.cls;
   // Close to the camera a texel is ten pixels or more: whatever it is, it is a real caster, and a hair of motion is a reason.
   if(this.nearCamera(e,radius)){if(move+turn*radius<SHADOW_MOTION.detail)continue;}
   else if(cls===CASTER_AMBIENT){if(move<SHADOW_MOTION.thinMove&&turnedBy(e,ref,at)*Math.min(radius,SHADOW_MOTION.sheet)<thr)continue;}
   else if(move+turn*radius<(cls===CASTER_SMALL?Math.max(thr,SHADOW_MOTION.smallMove):thr))continue;
   // Where its shadow lands on the ground: along the light, down to the ground in view.
   const t=Math.max(0,(e[13]-view.y)/slope),gx=e[12]-dir.x*t,gz=e[14]-dir.z*t;
   if(Math.hypot(gx-view.x,gz-view.z)<reach+radius+2)this.moved=true;
  }
 }
 /** The list of casters, rebuilt when a child has come or gone anywhere in the walked scene since the last time (an event: exact, the frame it happens) or when it is `rescan` ms old (a node that was shown has no event): what became visible, what appeared, what went. What stays keeps its reference pose and its numbers (a slow drift is
  * measured from the last redraw, not from the last scan); what is new asks for a redraw, and what went too if it was worth one: a real caster or a small one, one close to the camera. A translucent
  * caster that comes or goes (a ripple) does not, unless it is close to the camera. Nothing is allocated unless the list changed. A rebuild walks the whole scene (0.1 ms hot, a few times that in a frame), so it is not done every frame. */
 scan(scene,now,rescan=SHADOW_RESCAN){
  if(!this.structure&&now-this.scannedAt<rescan)return;
  if(this.structure)this.stats.onEvent++;
  this.structure=false;this.scannedAt=now;this.stats.scans++;
  const list=this.watched,next=this.found;next.length=0;collect(scene,next,this);
  let same=next.length===list.length;if(same)for(let i=0;i<next.length;i++)if(next[i]!==list[i]){same=false;break;}
  if(same){
   // The list is what it was: only a material that turned translucent (or opaque) changes what a caster is worth.
   const S=this.statics;
   for(let i=0;i<next.length;i++)S[i*STATICS+2]=translucent(next[i]);
   return;
  }
  // The list changed: what stays keeps its pose and numbers, copied into the spare buffers (two sets, swapped: a scene that changes its casters every frame, a chain of crates, allocates nothing once they have grown).
  const ref=this.ref,versions=this.versions,was=this.was,old=list.length,n=next.length;
  was.clear();for(let i=0;i<old;i++)was.set(list[i],i);
  if(this.refSpare.length<n*16){const cap=Math.ceil(n*1.25)+64;this.refSpare=new Float64Array(cap*16);this.staticsSpare=new Float32Array(cap*STATICS);}
  if(this.kept.length<old)this.kept=new Uint8Array(Math.ceil(old*1.25)+64);
  const nextRef=this.refSpare,statics=this.staticsSpare,nextVersions=this.versionsSpare,kept=this.kept;kept.fill(0,0,old);let moved=false;
  for(let i=0;i<n;i++){
   const o=next[i],k=was.get(o);
   if(k!==undefined){kept[k]=1;for(let j=0;j<16;j++)nextRef[i*16+j]=ref[k*16+j];for(let j=0;j<STATICS;j++)statics[i*STATICS+j]=this.statics[k*STATICS+j];nextVersions[i]=versions[k];}
   else{nextRef.set(o.matrixWorld.elements,i*16);nextVersions[i]=o.isInstancedMesh?o.instanceMatrix.version:0;casterStatics(o,statics,i*STATICS);const q=measureCaster(o.matrixWorld.elements,statics,i*STATICS);if(q.cls!==CASTER_AMBIENT||this.nearCamera(o.matrixWorld.elements,q.radius))moved=true;}
  }
  for(let i=0;i<old&&!moved;i++)if(!kept[i]){const gone=ref.subarray(i*16,i*16+16),q=measureCaster(gone,this.statics,i*STATICS);if(q.cls!==CASTER_AMBIENT||this.nearCamera(gone,q.radius))moved=true;}
  if(moved)this.moved=true;
  was.clear();
  // (What held the old list is the next scan's.)
  this.watched=next;this.found=list;this.refSpare=ref;this.ref=nextRef;this.staticsSpare=this.statics;this.statics=statics;this.versionsSpare=versions;this.versions=nextVersions;
 }
 /** After the frame's render. When the map was redrawn this frame, every caster's pose is what the map now shows. When `update()` had no `frame` to read the poses with, this reads them now and
  * schedules a redraw for the next frame (a mover's shadow then lags by one frame, and a new caster's by up to `rescan` ms). */
 watch(scene,now,{rescan=SHADOW_RESCAN}={}){
  if(this.legacy||this.off)return;
  const t0=performance.now(),list=this.watched,ref=this.ref,versions=this.versions;
  if(this.drew){
   for(let i=0;i<list.length;i++){const o=list[i];ref.set(o.matrixWorld.elements,i*16);versions[i]=o.isInstancedMesh?o.instanceMatrix.version:0;}
  }else if(!this.pre)this.compare();
  if(!this.pre)this.scan(scene,now,rescan);
  this.pre=false;
  this.stats.watchMs+=performance.now()-t0;
 }
 state(){return {legacy:this.legacy,half:this.half,size:this.size,every:this.every,off:this.off,passes:this.stats.passes,frames:this.stats.frames,scans:this.stats.scans,onEvent:this.stats.onEvent,why:{...this.stats.why},watched:this.watched.length,watchMs:+this.stats.watchMs.toFixed(1)};}
}
