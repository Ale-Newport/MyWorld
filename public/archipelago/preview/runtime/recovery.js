import * as THREE from 'three';
import {PLACEMENT,headingOf,headingVector,entrancesOf,isGround} from './placement.js';
/* LOCAL RECOVERY — back on the wheels near where it went wrong.

   Before, every way out of trouble (the sea, the void, R, a car beached on
   its belly) ended at one fixed spawn on the far west of the island. Now a
   recovery lands near the incident, on ground runtime/placement.js has just
   validated, and Driving.place() does the moving.

   Where to: in this order, the first candidate that validates NOW wins.
   1. The breadcrumb trail. Every RECOVERY.every s the car leaves a crumb if
      it is meaningfully grounded: four wheels on fixed drivable ground (not
      ice), upright, dry, not just slowed by an impact (RECOVERY.impact m/s
      lost since the last sample), and the spot itself re-validates
      away from the very edge (dry for 2.5 m all round, and for 4.5 m in
      at least six of eight directions). Forty are kept,
      RECOVERY.spacing apart. The newest crumb at least RECOVERY.backoff
      metres BACK from the incident is used — not the dangerous edge itself.
   2. Recovery anchors: entrances of the experience groups, World2's authored
      prefab spawns, road samples when roads exist, and a coarse grid of
      drivable points, all derived from the scene and validated in idle
      slices after load (a session is rebuilt from the edited world each
      time the studio drives it, so studio edits are always reflected).
      Ranked by distance from the last place the car stood on land, with a
      large penalty when the straight line to them crosses open water — the
      same landmass first — and re-validated before use.
   3. The best valid spot within 30 m of the incident; 4. the session's spawn.
   The car always lands upright, still, facing along its trail when that way
   is open (else the most open direction, turned away from the danger).

   Loops: an incident within RECOVERY.repeat.seconds and .metres of the last
   one doubles the back-off and excludes the spots already used there.

   What counts as an incident (Driving.fixed): the car more than
   RECOVERY.sink m under the water level, or below every surface (void);
   sustained deep water (VehicleWater, 2.2 s); a NaN or runaway physics
   state; the in-place self-righting failing; three unstuck hops failing; R.
   Jumps, collisions, stops and ordinary airborne driving never are: nothing
   here looks at speed, contacts or air time. For RECOVERY.grace s after any
   placement nothing but a NaN state is treated as an incident. */

export const RECOVERY=Object.freeze({every:.75,keep:40,spacing:2.5,backoff:6,minAge:.9,impact:6,sink:3.5,grace:1.2,repeat:{seconds:10,metres:25},exclude:3.5,anchorGrid:10,anchorBudgetMs:6,reach:80,nearRadius:30});
const finite=v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const visibleNode=o=>{for(let p=o;p;p=p.parent)if(!p.visible||p.userData.deleted)return false;return true;};

/** Recovery anchor candidates from the scene and the navigation data (three.js coordinates). */
export function anchorCandidates({root,navigation={},bounds,grid=RECOVERY.anchorGrid}){
 const out=[];
 root?.traverse(n=>{if(!n.userData.worldExperience||!visibleNode(n))return;for(const e of entrancesOf(n)){const d=e.direction;out.push({x:e.x+d.x*(4+(n.userData.recommendedClearance??3)),z:e.z+d.z*(4+(n.userData.recommendedClearance??3)),heading:headingOf(d.clone().negate()),source:'entrance',name:n.name});}});
 for(const s of navigation.prefabSpawns??[])if(Array.isArray(s.position))out.push({x:s.position[0],z:s.position[2],heading:s.rotation??0,source:'prefab',name:s.name});
 for(const r of navigation.roads??[]){let travelled=Infinity;for(let i=1;i<r.samples.length;i++){const [ax,an]=r.samples[i-1],[bx,bn]=r.samples[i],len=Math.hypot(bx-ax,bn-an);travelled+=len;if(travelled<12)continue;travelled=0;out.push({x:bx,z:-bn,heading:Math.atan2(bn-an,bx-ax),source:'road',name:r.name});}}
 if(bounds)for(let x=bounds.minX+grid/2;x<bounds.maxX;x+=grid)for(let z=bounds.minZ+grid/2;z<bounds.maxZ;z+=grid)out.push({x,z,heading:null,source:'grid'});
 return out;
}
/** Validates anchor candidates a few milliseconds at a time; `onDone(list)` when finished. Returns a cancel function. */
export function validateAnchors(placement,candidates,{budget=RECOVERY.anchorBudgetMs,onDone=()=>{},onProgress=()=>{},idle=true}={}){
 const valid=[];let i=0,cancelled=false,handle=null;const options={dynamicMargin:1.5,maxEdge:1,ice:false};
 const one=c=>{const s=placement.surface(c.x,c.z);if(!s?.ground||s.wet)return;const headings=c.heading==null?[0,Math.PI/2,Math.PI,-Math.PI/2]:[c.heading,c.heading+Math.PI/2,c.heading-Math.PI/2,c.heading+Math.PI];for(const h of headings){const r=placement.check(c.x,c.z,wrap(h),options);if(r.ok){valid.push({x:r.x,z:r.z,y:r.y,heading:r.heading,source:c.source,name:c.name??null});return;}}};
 const slice=deadline=>{while(i<candidates.length&&!cancelled){one(candidates[i++]);if(performance.now()>deadline())break;}onProgress(i/candidates.length,valid);if(cancelled)return;if(i<candidates.length)schedule();else onDone(valid);};
 const schedule=()=>{if(idle&&typeof requestIdleCallback==='function')handle=requestIdleCallback(d=>{const end=performance.now()+Math.min(budget,Math.max(1,d.timeRemaining()));slice(()=>end);},{timeout:200});else handle=setTimeout(()=>{const end=performance.now()+budget;slice(()=>end);},0);};
 schedule();
 return {cancel(){cancelled=true;if(handle!==null){if(typeof cancelIdleCallback==='function')cancelIdleCallback(handle);clearTimeout(handle);}},finish(){const end=Infinity;slice(()=>end);return valid;},get done(){return i>=candidates.length;},valid};
}

export class Recovery{
 constructor(driving,{root=null,navigation={},bounds=null}={}){
  Object.assign(this,{driving,root,navigation,bounds});this.placement=driving.placement;this.crumbs=[];this.incidents=[];this.anchors=[];this.clock=0;this.nextCrumb=0;this.graceUntil=0;this.lastSpeed=0;this.job=null;
 }
 get vehicle(){return this.driving.vehicle;}
 /** Starts deriving and validating the anchors in idle time. */
 prepare(){this.job?.cancel();this.anchors=[];const candidates=anchorCandidates({root:this.root,navigation:this.navigation,bounds:this.bounds});this.anchorCandidates=candidates.length;this.job=validateAnchors(this.placement,candidates,{onDone:list=>{this.anchors=list;this.job=null;}});}
 /** The anchors validated so far (finishing the job synchronously when asked to). */
 anchorList(complete=false){if(complete&&this.job&&!this.job.done){this.anchors=this.job.finish();this.job=null;}return this.job?this.job.valid:this.anchors;}
 /** A placement happened (spawn, travel, recovery): the next moments are not incidents. */
 placed(pose,reason){this.graceUntil=this.clock+RECOVERY.grace;this.nextCrumb=this.clock+RECOVERY.every;this.lastSpeed=0;if(reason==='travel'||reason==='spawn')this.crumbs.length=0;}
 /** One fixed step: leave a crumb when due, and say whether the car is in trouble. */
 step(dt){
  this.clock+=dt;const d=this.driving,v=this.vehicle,b=v.chassis.physical.body,p=v.position,vel=b.linvel();
  if(!finite(p)||!Number.isFinite(vel.x+vel.y+vel.z)||Math.hypot(vel.x,vel.y,vel.z)>220)return 'invalid';
  if(d.modes.isPlane||d.modes.transition>0)return null;
  // A sample that does not make a crumb is tried again sooner, so the trail stays dense wherever the ground allows.
  if(this.clock>=this.nextCrumb)this.nextCrumb=this.clock+(this.crumb()?RECOVERY.every:RECOVERY.every/3);
  if(this.clock<this.graceUntil)return null;
  const level=this.placement.water(p.x,p.z);
  if(p.y<level-RECOVERY.sink)return 'sea';
  if(p.y<level-1&&!this.placement.surface(p.x,p.z,p.y+.5,80))return 'void';
  if(!this.placement.inBounds(p.x,p.z,90))return 'outside';
  return null;
 }
 crumb(){
  // A sudden loss of speed since the last sample is an impact: not a moment to remember. Accelerating is fine.
  const d=this.driving,v=this.vehicle,p=v.position,speed=v.xzSpeed*(d.ticker.scale??2),impact=this.lastSpeed-speed>RECOVERY.impact;this.lastSpeed=speed;
  if(d.player.state!=='default'||d.modes.drop||v.wheels.inContactCount<4||v.upward.y<.94||d.water.wetness>.05||impact)return false;
  if(!v.wheels.items.every(w=>isGround(w.groundCollider)&&w.groundCollider.userData?.surface_type!=='ice'))return false;
  const travel=new THREE.Vector3(v.velocity.x,0,v.velocity.z),heading=travel.lengthSq()>1e-6?headingOf(travel.normalize()):headingOf(new THREE.Vector3(v.forward.x,0,v.forward.z).normalize());
  const last=this.crumbs.at(-1);if(last&&Math.hypot(last.x-p.x,last.z-p.z)<RECOVERY.spacing){last.time=this.clock;return true;}
  const c=this.placement.check(p.x,p.z,heading,{dynamicMargin:1.2,maxEdge:2,ice:false});if(!c.ok)return false;
  this.crumbs.push({x:p.x,z:p.z,y:c.y,heading,time:this.clock});if(this.crumbs.length>RECOVERY.keep)this.crumbs.shift();return true;
 }
 /** Does the straight line a→b leave land for open water (after first reaching land)? */
 crossesWater(a,b){const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3);let land=false;for(let i=0;i<=n;i++){const t=i/n,s=this.placement.surface(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);const dry=s&&!s.wet;if(dry)land=true;else if(land)return true;}return false;}
 /** Chooses the recovery pose for an incident at `at` (default: where the car is). */
 choose(reason,at=this.vehicle.position.clone()){
  const now=this.clock,land=[...this.crumbs].reverse().find(c=>now-c.time<30),home=this.driving.home?.position;
  // A NaN state has no position worth trusting: the incident is wherever the car last stood on land.
  if(!at||!finite(at))at=new THREE.Vector3(land?.x??home?.x??0,0,land?.z??home?.z??0);
  const recent=this.incidents.filter(i=>now-i.time<RECOVERY.repeat.seconds&&Math.hypot(i.x-at.x,i.z-at.z)<RECOVERY.repeat.metres);
  const backoff=RECOVERY.backoff*2**recent.length,excluded=recent.map(i=>i.pick).filter(Boolean);
  const away=p=>!excluded.some(e=>Math.hypot(e.x-p.x,e.z-p.z)<RECOVERY.exclude);
  const reference=land??{x:at.x,z:at.z};
  const options={dynamicMargin:1.2,maxEdge:2,ice:false};let pose=null,source=null;
  // 1. Crumbs: newest first, a few metres back from the incident, still valid now.
  for(let i=this.crumbs.length-1;i>=0&&!pose;i--){const c=this.crumbs[i];if(now-c.time<RECOVERY.minAge||Math.hypot(c.x-at.x,c.z-at.z)<backoff||!away(c))continue;pose=this.orient(c,at,options);if(pose)source='trail';}
  // 2. Anchors: nearest to the last place on land, the same landmass first.
  if(!pose){const ranked=this.anchorList(true).filter(a=>away(a)&&Math.hypot(a.x-at.x,a.z-at.z)>=Math.min(backoff,RECOVERY.backoff)).map(a=>({a,d:Math.hypot(a.x-reference.x,a.z-reference.z)})).filter(e=>e.d<=RECOVERY.reach).sort((p,q)=>p.d-q.d).slice(0,24);
   for(const e of ranked)e.score=e.d+(this.crossesWater(reference,e.a)?60:0);ranked.sort((p,q)=>p.score-q.score);
   for(const {a} of ranked){pose=this.orient(a,at,options);if(pose){source='anchor:'+a.source;break;}}}
  // 3. Anything valid near the incident; 4. the session's spawn.
  if(!pose){const n=this.placement.near(reference.x,reference.z,{radius:RECOVERY.nearRadius,step:2,prefer:this.prefer(null,at,reference),accept:c=>away(c)&&Math.hypot(c.x-at.x,c.z-at.z)>=Math.min(backoff,RECOVERY.backoff),...options});if(n){pose=n;source='near';}}
  if(!pose&&this.driving.home){pose=this.driving.home;source='spawn';}
  this.incidents.push({x:at.x,z:at.z,time:now,reason,pick:pose?{x:pose.position.x,z:pose.position.z}:null});if(this.incidents.length>12)this.incidents.shift();
  if(pose){pose.source=source;pose.reason=reason;}return pose;
 }
 /** Preferred headings: along the trail, away from the incident, and the chase camera's. */
 prefer(trail,at,from){const out=[];if(trail!=null)out.push({heading:trail,weight:.6});if(at&&from){const away=new THREE.Vector3(from.x-at.x,0,from.z-at.z);if(away.lengthSq()>1)out.push({heading:headingOf(away.normalize()),weight:.45});}const cam=this.placement.cameraHeading();if(cam!=null)out.push({heading:cam,weight:.25});return out;}
 /** A validated, upright pose at a spot: its own heading when that way is open, else the most open one. */
 orient(spot,at,options){
  const p=this.placement,s=p.surface(spot.x,spot.z);if(!s?.ground||s.wet)return null;
  if(spot.heading!=null){const c=p.check(spot.x,spot.z,spot.heading,options);if(c.ok&&p.run(spot.x,c.y,spot.z,spot.heading)>=15)return c;}
  const best=p.heading(spot.x,s.y,spot.z,{prefer:this.prefer(spot.heading,at,spot)});if(!best)return null;
  const c=p.check(spot.x,spot.z,best.heading,options);if(c.ok)return c;
  for(const k of [1,-1,2])if(spot.heading!=null){const h=wrap(spot.heading+k*Math.PI/2),r=p.check(spot.x,spot.z,h,options);if(r.ok)return r;}
  return null;
 }
 dispose(){this.job?.cancel();this.job=null;}
}
