import * as THREE from 'three';
/* SAFE PLACEMENT — where the car may be put down.

   The initial spawn, travel from the M map, R, and every recovery from the
   sea, the void or a wreck ask this module the same question, and none of
   them invents a position: Placement validates a pose against the live
   physics world, and Driving.place() is the only code that then moves the
   car there (velocities, wheels, inputs, camera; see runtime/driving.js).

   A pose (x, z, heading) is valid when, for the car's whole footprint:
   - support  the first FIXED collider below each of nine footprint samples
              is drivable ground (ground_surface/terrain: terrain, roads,
              paths, bridges; ice only when asked) — never a roof, a bench
              seat, the fountain, the loop, or a landmark's floor;
   - level    the surface normal, and the slope across the tyres, are within
              PLACEMENT.slope° (10°) of level, and the samples agree within
              PLACEMENT.step — the car drives up steeper ground, but parked
              on it the tyres cannot hold it (parking needs < 3°) and it
              creeps away from where it was put;
   - dry      every sample stands PLACEMENT.dry above the water there
              (physics.waterAt: lakes and the sea);
   - clear    a box around the body (PLACEMENT.margin, PLACEMENT.headroom
              tall) meets no fixed collider but its own support — ground
              pieces above wheel height (rails, kerbs, ramps) count — and a
              wider box (PLACEMENT.dynamicMargin) meets no body that moves
              (crates, letters, benches, penguins);
   - open     no tall decoration without a collider (trees, palms) covers
              the footprint: physics cannot see those, the player can, so
              they are read from the scene (softObstacles);
   - inside   the authored world bounds.
   Rejections carry a reason (water, void, outside, steep, blocked, props,
   edge) that the map turns into words. The car rests with its chassis
   origin PLACEMENT.rest above the support (measured 1.096 m on 'low'
   suspensions) and is put down PLACEMENT.lift above that: it settles in
   place, without a drop, a bounce or a launch.

   Headings: moveTo() turns the car's nose (local +X) about +Y, so a world
   direction d is the rotation atan2(-d.z, d.x). heading() measures the free
   run in sixteen directions (a box swept along the ground, then the ground
   itself sampled for water, void and walls) and weighs it against a
   preferred direction — usually the chase camera's, which /world keeps at a
   fixed angle south-east of the car, so a car facing away from it reads as
   "the camera is behind me".

   Everything here only reads; nothing steps the simulation. */

export const PLACEMENT=Object.freeze({rest:1.096,restSuspension:.7,lift:.01,slope:10,step:.45,dry:.08,half:{x:1.35,z:.9},margin:.45,dynamicMargin:2.5,headroom:3.1,shore:4.5,run:28,softMargin:.35});
/** Footprint samples in the car's frame: centre, the four tyre patches, the four bumper corners. */
const FOOT=[[0,0],[.9,.75],[.9,-.75],[-.9,.75],[-.9,-.75],[1.55,1.05],[1.55,-1.05],[-1.55,1.05],[-1.55,-1.05]];
export const headingVector=r=>new THREE.Vector3(Math.cos(r),0,-Math.sin(r));
export const headingOf=d=>Math.atan2(-d.z,d.x);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const visibleNode=o=>{for(let p=o;p;p=p.parent)if(!p.visible||p.userData.deleted)return false;return true;};
/** Drivable ground: a fixed collider authored as a surface (terrain, road, path, bridge deck, ice). */
export function isGround(collider){const d=collider?.userData;if(!d||!(d.ground_surface||d.terrain))return false;if(d.surface_type==='loop'||d.surface_type==='water'||d.waterObject)return false;return !!collider.parent()?.isFixed();}
export const REASONS={water:'water',void:'no ground',outside:'outside the island',steep:'too steep',blocked:'something is in the way',props:'too close to things that move',edge:'too close to the edge',ice:'ice',invalid:'not a place'};

/* ---- decoration the physics world cannot see ------------------------------ */
const groundLike=d=>d.terrain||d.landTile||d.mapTerrainGenerated||d.sea||d.waterObject||d.waterSurface||d.ground_surface||d.mapSurface||d.experienceSurface||d.road_points||d.roadPart||d.road||d.editorOnly||d.unselectable||d.runtime_collider||d.activityOverlay||d.w2Role==='collider'||d.w2Category==='terrain'||d.w2Category==='water';
/** True when the mesh is part of something setupPhysics turned into colliders. */
function physical(mesh){for(let p=mesh;p;p=p.parent){const d=p.userData;if(d.physicsPreset==='No Collision'||d.collisionSubtree===false)return false;if(d.collision===false&&(p===mesh||d.assetPhysicsEdited))return false;if(d.collision)return true;}return false;}
/** Tall, collider-less, visible decoration (trees, palms…), one box per authored object, shrunk to its trunk-ish core. */
export function softObstacles(root,{minHeight=1,shrink=.3,maxSize=24}={}){
 const boxes=new Map(),box=new THREE.Box3();if(!root)return {list:[],near:()=>[]};root.updateMatrixWorld(true);
 const owner=o=>{let n=o;for(let p=o;p&&p!==root;p=p.parent){if(p.userData.world2Asset)return null;if(p.parent?.userData.worldExperience||p.parent===root||p.userData.editable_root&&!p.userData.worldExperience){n=p;break;}}return n;};
 root.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||!o.geometry?.attributes.position)return;for(let p=o;p&&p!==root;p=p.parent)if(groundLike(p.userData))return;if(!visibleNode(o)||physical(o))return;const key=owner(o);if(!key)return;if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);const b=boxes.get(key);if(b)b.union(box);else boxes.set(key,box.clone());});
 const list=[];for(const [node,b] of boxes){const sx=b.max.x-b.min.x,sz=b.max.z-b.min.z;if(b.max.y-b.min.y<minHeight||sx>maxSize||sz>maxSize)continue;const cx=(b.min.x+b.max.x)/2,cz=(b.min.z+b.max.z)/2,hx=sx/2*(1-shrink),hz=sz/2*(1-shrink);list.push({name:node.name,minX:cx-hx,maxX:cx+hx,minZ:cz-hz,maxZ:cz+hz,minY:b.min.y,maxY:b.max.y});}
 const cell=8,grid=new Map();list.forEach((b,i)=>{for(let x=Math.floor(b.minX/cell);x<=Math.floor(b.maxX/cell);x++)for(let z=Math.floor(b.minZ/cell);z<=Math.floor(b.maxZ/cell);z++){const k=x+':'+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}});
 const near=(x,z,r)=>{const out=new Set();for(let gx=Math.floor((x-r)/cell);gx<=Math.floor((x+r)/cell);gx++)for(let gz=Math.floor((z-r)/cell);gz<=Math.floor((z+r)/cell);gz++)for(const i of grid.get(gx+':'+gz)??[])out.add(list[i]);return [...out];};
 return {list,near};
}
const circleHitsBox=(x,z,r,b)=>{const dx=Math.max(b.minX-x,0,x-b.maxX),dz=Math.max(b.minZ-z,0,z-b.maxZ);return dx*dx+dz*dz<r*r;};

/* ---- the validator ---------------------------------------------------------------- */
export class Placement{
 /** physics: runtime/physics.js world; exclude: the car's own rigid body; soft: softObstacles(root). */
 constructor({physics,root=null,bounds=null,seaLevel=physics.waterElevation??-.35,exclude=null,soft=null,cameraDirection=null,cameraOffset=null}){
  Object.assign(this,{physics,root,bounds,seaLevel,exclude,cameraDirection,cameraOffset});this.R=physics.rapier;this.world=physics.world;this.soft=soft??softObstacles(root);
  const F=this.R.QueryFilterFlags;this.flags={fixed:F.EXCLUDE_DYNAMIC|F.EXCLUDE_KINEMATIC|F.EXCLUDE_SENSORS,moving:F.EXCLUDE_FIXED|F.EXCLUDE_SENSORS,solid:F.EXCLUDE_SENSORS};
  this.q=new THREE.Quaternion();this.v=new THREE.Vector3();
 }
 water(x,z){return this.physics.waterAt?.(x,z)??this.seaLevel;}
 inBounds(x,z,pad=0){const b=this.bounds;return !b||(x>=b.minX-pad&&x<=b.maxX+pad&&z>=b.minZ-pad&&z<=b.maxZ+pad);}
 /** The first fixed collider below (x, z), from `from` downwards: what a car dropped there would land on. */
 surface(x,z,from=60,depth=from+80){
  const ray=new this.R.Ray({x,y:from,z},{x:0,y:-1,z:0});let hit=this.world.castRayAndGetNormal(ray,depth,true,this.flags.fixed,undefined,null,this.exclude);
  // Rapier 0.17 can miss a vertical ray exactly on a heightfield seam (see Physics.groundAt).
  if(!hit){ray.origin.z+=.001;hit=this.world.castRayAndGetNormal(ray,depth,true,this.flags.fixed,undefined,null,this.exclude);}
  if(!hit)return null;const y=from-hit.timeOfImpact,water=this.water(x,z),d=hit.collider.userData??{};
  return {y,normal:hit.normal,collider:hit.collider,ground:isGround(hit.collider),surface:d.surface_type??(d.terrain?'terrain':null),water,wet:y<water+PLACEMENT.dry};
 }
 /** Footprint sample positions for a pose. */
 footprint(x,z,heading,scale=1){const c=Math.cos(heading),s=Math.sin(heading);return FOOT.map(([fx,fz])=>[x+(fx*c+fz*s)*scale,z+(-fx*s+fz*c)*scale]);}
 rotation(heading){return this.q.setFromAxisAngle(new THREE.Vector3(0,1,0),heading);}
 /** Does a body-shaped box at this pose touch anything? `which`: 'static' | 'rails' | 'moving'. */
 touches(x,y,z,heading,which,margin=PLACEMENT.margin){
  const h=PLACEMENT.half,low=which==='rails'?.7:which==='moving'?0:.25,top=PLACEMENT.headroom,half=(top-low)/2;
  const shape=new this.R.Cuboid(h.x+margin,half,h.z+margin),rot=this.rotation(heading),pos={x,y:y+low+half,z};
  const flags=which==='moving'?this.flags.moving:this.flags.fixed,predicate=which==='static'?c=>!isGround(c):which==='rails'?c=>isGround(c):undefined;
  const hit=this.world.intersectionWithShape(pos,{x:rot.x,y:rot.y,z:rot.z,w:rot.w},shape,flags,undefined,null,this.exclude,predicate);
  return hit?{collider:hit,name:hit.parent()?.userData?.physical?.node?.name??hit.userData?.name??null}:null;
 }
 /** Collider-less decoration over the footprint, by name. */
 softAt(x,z,y,radius=Math.hypot(PLACEMENT.half.x,PLACEMENT.half.z)+PLACEMENT.softMargin){for(const b of this.soft.near(x,z,radius))if(b.maxY>y+.6&&b.minY<y+3&&circleHitsBox(x,z,radius,b))return b;return null;}
 /** How many points of a ring around (x, z) are water or void: 0 is open ground, 8 a spit of land. */
 edge(x,z,radius=PLACEMENT.shore,count=8){let wet=0;for(let i=0;i<count;i++){const a=i/count*Math.PI*2,s=this.surface(x+Math.cos(a)*radius,z+Math.sin(a)*radius);if(!s||s.wet)wet++;}return wet;}
 /** Validates one pose. Options: dynamicMargin, maxEdge (ring points allowed wet), ice (allow), soft (check decoration). */
 check(x,z,heading,{margin=PLACEMENT.margin,dynamicMargin=PLACEMENT.dynamicMargin,maxEdge=Infinity,ice=true,soft=true,pad=0}={}){
  const fail=(reason,extra={})=>({ok:false,reason,x,z,heading,...extra});
  if(![x,z,heading].every(Number.isFinite))return fail('invalid');
  if(!this.inBounds(x,z,pad))return fail('outside');
  const s=this.surface(x,z);if(!s)return fail('void');
  if(s.wet)return fail('water',{y:s.y});
  if(!s.ground)return fail('blocked',{y:s.y,name:s.collider.parent()?.userData?.physical?.node?.name??null});
  if(!ice&&s.surface==='ice')return fail('ice',{y:s.y});
  // |n.y|: a trimesh hit may report the face's back-facing normal.
  if(Math.abs(s.normal.y)<Math.cos(PLACEMENT.slope*Math.PI/180))return fail('steep',{y:s.y});
  const points=this.footprint(x,z,heading),heights=[];
  for(const [px,pz] of points.slice(1)){const p=this.surface(px,pz,s.y+4,8);if(!p)return fail('edge',{y:s.y});if(p.wet)return fail('water',{y:s.y});if(!p.ground)return fail('blocked',{y:s.y});if(Math.abs(p.y-s.y)>PLACEMENT.step)return fail('steep',{y:s.y});if(!ice&&p.surface==='ice')return fail('ice',{y:s.y});heights.push(p.y);}
  // Front-back and left-right height differences across the tyres: the slope the car will actually sit on.
  const pitch=Math.abs((heights[0]+heights[1])-(heights[2]+heights[3]))/2/1.8,roll=Math.abs((heights[0]+heights[2])-(heights[1]+heights[3]))/2/1.5;
  if(Math.max(pitch,roll)>Math.tan(PLACEMENT.slope*Math.PI/180))return fail('steep',{y:s.y});
  // Seated on the mean of its four tyre patches: on a gentle slope every tyre touches at once (the highest
  // would leave the downhill ones hanging, and the car would tip onto them after it was put down).
  const y=(heights[0]+heights[1]+heights[2]+heights[3])/4;
  let hit=this.touches(x,y,z,heading,'static',margin)??this.touches(x,y,z,heading,'rails',margin);if(hit)return fail('blocked',{y,name:hit.name});
  if(dynamicMargin>=0){hit=this.touches(x,y,z,heading,'moving',dynamicMargin);if(hit)return fail('props',{y,name:hit.name});}
  if(soft){const b=this.softAt(x,z,y);if(b)return fail('blocked',{y,name:b.name});}
  // Not at the very edge: nothing wet within 2.5 m, and at most `maxEdge` of eight points wet at PLACEMENT.shore.
  const edge=maxEdge<Infinity?(this.edge(x,z,2.5)?9:this.edge(x,z)):0;if(edge>maxEdge)return fail('edge',{y,edge});
  const slope=Math.max(Math.acos(Math.min(1,Math.abs(s.normal.y))),Math.atan(Math.max(pitch,roll)))*180/Math.PI;
  return {ok:true,x,z,heading,y,edge,slope,surface:s.surface,collider:s.collider,normal:s.normal,position:new THREE.Vector3(x,y+PLACEMENT.rest+PLACEMENT.lift,z),rotation:heading};
 }
 /** Free run (m) from a pose along a heading: a body box swept over the ground, then the ground itself followed. */
 run(x,y,z,heading,max=PLACEMENT.run){
  const d=headingVector(heading),h=PLACEMENT.half,shape=new this.R.Cuboid(h.x*.9,.55,h.z+.15),rot=this.rotation(heading);
  const hit=this.world.castShape({x,y:y+.25+.85,z},{x:rot.x,y:rot.y,z:rot.z,w:rot.w},{x:d.x,y:0,z:d.z},shape,0,max,true,this.flags.solid,undefined,null,this.exclude,c=>!isGround(c));
  let free=hit?Math.max(0,hit.time_of_impact??hit.toi??0):max,last=y;
  for(let t=2;t<=free;t+=2){const px=x+d.x*t,pz=z+d.z*t,s=this.surface(px,pz,last+4,10);if(!s||s.wet||!s.ground||Math.abs(s.y-last)>1.1){free=t-2;break;}const b=this.softAt(px,pz,s.y,1.3);if(b){free=t-2;break;}last=s.y;}
  return Math.max(0,free);
 }
 /** The most open heading at (x, z), weighed against preferred directions: [{heading, weight}]. */
 heading(x,y,z,{prefer=[],samples=16,max=PLACEMENT.run}={}){
  let best=null;for(let i=0;i<samples;i++){const h=wrap(i/samples*Math.PI*2),free=this.run(x,y,z,h,max);let score=free/max;for(const p of prefer)score+=p.weight*Math.cos(wrap(h-p.heading));if(!best||score>best.score)best={heading:h,run:free,score};}
  return best;
 }
 /** Rotation of the chase camera's view direction (the car facing away from the camera). */
 cameraHeading(){const d=this.cameraDirection?.();return d?headingOf(d):null;}
 /** Would the chase camera see a car standing on (x, y, z) from its full distance? View.probeObstruction's own test:
  * a ray from 2.4 m above the car towards the camera, solid world only, hits closer than 7 m ignored. */
 cameraClear(x,y,z,radius=START_VIEW.radius){const o=this.cameraOffset?.();if(!o)return true;const hit=this.world.castRay(new this.R.Ray({x,y:y+PLACEMENT.rest+2.4,z},{x:o.x,y:o.y,z:o.z}),radius,true,undefined,this.physics.queryTerrainOnly);return !hit||hit.timeOfImpact<7||hit.timeOfImpact>radius-1.3;}
 /** The nearest valid pose within `radius` of (x, z), searched ring by ring outwards. Spots are tried at the given
  * `headings`, else at the preferred ones and the four cardinal ones (cheap); the spot found then gets its most
  * open heading (one sweep, not one per spot tried). */
 near(x,z,{radius=12,step=1.5,prefer=[],headings=null,accept=null,...options}={}){
  const tried=new Set(),trial=headings??[...prefer.map(p=>p.heading),0,Math.PI/2,Math.PI,-Math.PI/2];
  for(let r=0;r<=radius+1e-6;r+=step){
   const count=r===0?1:Math.max(6,Math.round(2*Math.PI*r/step));
   for(let i=0;i<count;i++){const a=i/count*Math.PI*2,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,key=Math.round(px*2)+':'+Math.round(pz*2);if(tried.has(key))continue;tried.add(key);
    const s=this.surface(px,pz);if(!s||s.wet||!s.ground)continue;
    for(const h of trial){const c=this.check(px,pz,wrap(h),options);if(!c.ok||accept&&!accept(c))continue;c.distance=r;if(headings)return c;
     const open=this.heading(px,c.y,pz,{prefer,samples:12,max:16}),again=open?this.check(px,pz,open.heading,options):null;
     return again?.ok&&(!accept||accept(again))?Object.assign(again,{distance:r}):c;}
   }
  }
  return null;
 }
}

/* ---- places in the scene ------------------------------------------------------------ */
const isExperience=n=>!!n?.userData.worldExperience;
/** The Central Plaza experience group: by id, then by its world zone, then by name. */
export function centralPlaza(root){
 let byId=null,byZone=null,byName=null;root?.traverse(n=>{if(!isExperience(n)||!visibleNode(n))return;if(n.userData.aw_id==='experience:central-plaza')byId??=n;if(n.userData.worldZone===1)byZone??=n;if(/central\s*plaza/i.test(n.name))byName??=n;});
 return byId??byZone??byName;
}
/** Where a group really is: its meshes (not helpers, points or colliders, which can lie tens of metres away;
 * a World2 prefab the driving session hid behind its live copy, or a mesh it draws instanced, still counts),
 * its flat floor when it has one (paving, rings), and its authored origin when that lies inside. */
export function areaOf(group){
 group.updateWorldMatrix(true,true);const all=new THREE.Box3(),floor=new THREE.Box3(),b=new THREE.Box3();
 group.traverse(n=>{if(!n.isMesh||n.isInstancedMesh||!n.geometry?.attributes.position)return;for(let p=n;p&&p!==group.parent;p=p.parent){const d=p.userData;if(d.deleted||d.editorOnly||d.runtime_collider||d.w2Role==='collider'||d.w2Category==='terrain'||d.w2Category==='water'||d.activityOverlay||!p.visible&&!d.world2Asset&&!d.batched)return;}if(!n.geometry.boundingBox)n.geometry.computeBoundingBox();b.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);all.union(b);const s=b.getSize(new THREE.Vector3());if(s.y<.6&&s.x*s.z>60&&(n.userData.collision===false||n.userData.mapSurface||/plaza|paving|ring|court|square/i.test(n.name)))floor.union(b);});
 const origin=group.getWorldPosition(new THREE.Vector3()),box=floor.isEmpty()?all:floor;
 if(box.isEmpty())return {x:origin.x,z:origin.z,y:origin.y,radius:6,box:null,floor:false};
 const c=box.getCenter(new THREE.Vector3()),inside=origin.x>=box.min.x&&origin.x<=box.max.x&&origin.z>=box.min.z&&origin.z<=box.max.z,centre=inside&&!floor.isEmpty()?c:inside?origin:c;
 return {x:centre.x,z:centre.z,y:origin.y,radius:Math.min(box.max.x-box.min.x,box.max.z-box.min.z)/2,box,all,floor:!floor.isEmpty()};
}
/** The world-space entrances an experience group declares (local points + outward directions). */
export function entrancesOf(group){
 group.updateWorldMatrix(true,false);return (group.userData.entrancePoints??[]).map(e=>{const p=new THREE.Vector3(...(e.position??[0,0,0])).applyMatrix4(group.matrixWorld),d=new THREE.Vector3(...(e.direction??[0,0,1])).transformDirection(group.matrixWorld);d.y=0;if(d.lengthSq()<1e-8)d.set(0,0,1);d.normalize();return {name:e.name,x:p.x,z:p.z,direction:d};}).filter(e=>Number.isFinite(e.x)&&Number.isFinite(e.z));
}

/** The chase camera as a session starts (View.spherical): framing is judged from it at a reference 16:9,
 * so the same world gives the same spawn whatever the window. */
export const START_VIEW=Object.freeze({theta:Math.PI*.25,phi:Math.PI*.27,radius:21.4,fov:25,aspect:16/9});
const frameCamera=new THREE.PerspectiveCamera(25,16/9,.1,800);
/** Would `point` be in the middle three quarters of the frame with the car at `from`? */
export function framed(from,point,view=START_VIEW){const cam=frameCamera;cam.fov=view.fov??25;cam.aspect=view.aspect??16/9;cam.updateProjectionMatrix();cam.position.copy(from).add(new THREE.Vector3().setFromSphericalCoords(view.radius,view.phi,view.theta));cam.lookAt(from);cam.updateMatrixWorld();const p=point.clone().project(cam);return Math.abs(p.x)<.75&&Math.abs(p.y)<.75&&p.z<1;}
const landmarkNode=group=>{let mark=null;group.traverse(n=>{if(!mark&&n!==group&&n.userData.landmark&&!n.userData.deleted)mark=n;});return mark;};
/** The group's landmark (the plaza's fountain): a member flagged landmark, else the area's centre. */
export function landmarkOf(group){const mark=landmarkNode(group);if(!mark){const a=areaOf(group);return new THREE.Vector3(a.x,a.y,a.z);}return mark.getWorldPosition(new THREE.Vector3());}
/** The landmark's own footprint (the fountain, the frozen lake, the castle), or null: arrivals stay out of it. */
export function landmarkBox(group){const mark=landmarkNode(group);return mark?areaOf(mark).all??null:null;}
/** The first pose of a session in the Central Plaza: every spot of its floor, at headings within 67° of the
 * chase camera's, kept only if valid with props a generous 4 m away and open ground all around, then
 * scored — open run ahead, the camera behind, the plaza's landmark in the first frame (`seen`), nearer the
 * plaza's middle ring than its rim. Deterministic: the same world gives the same spawn. */
export function plazaSpawn(placement,group,{camera=placement.cameraHeading()??3*Math.PI/4,step=2,seen=null}={}){
 const area=areaOf(group),limit=Math.max(6,area.radius*.88),ideal=area.radius*.45,options={margin:1.2,dynamicMargin:4,maxEdge:0,ice:false},mark=landmarkOf(group);let best=null;
 for(let r=3;r<=limit;r+=step){const count=Math.max(8,Math.round(2*Math.PI*r/step));
  for(let i=0;i<count;i++){const a=i/count*Math.PI*2,x=area.x+Math.cos(a)*r,z=area.z+Math.sin(a)*r,s=placement.surface(x,z);if(!s?.ground||s.wet)continue;
   const framed=(seen?seen(new THREE.Vector3(x,s.y+PLACEMENT.rest,z),mark)?1:0:0)-(placement.cameraClear(x,s.y,z)?0:1);
   for(const k of [0,-1,1,-2,2,-3,3]){const h=wrap(camera+k*Math.PI/8),c=placement.check(x,z,h,options);if(!c.ok)continue;const run=placement.run(x,c.y,z,h);
    const score=run/PLACEMENT.run+.8*Math.cos(h-camera)+.45*framed+.35*(1-Math.min(1,Math.abs(r-ideal)/area.radius));if(!best||score>best.score)best={...c,run,score,framed:!!framed,source:'plaza',name:group.name};}
  }
 }
 return best;
}

/* ---- travel from the M map -------------------------------------------------------- */
/** A safe arrival for the M map. For an experience group: at its entrances (stepped out by its recommended
 * clearance), at the World2 spawns authored inside it, then on rings around its real extent — never inside
 * its landmark, which validation refuses anyway (roofs, walls and floors are not ground). For a marker point:
 * the nearest valid spot within 18 m. For a clicked point: exactly there, nudged at most 4 m when something
 * stands on it; water, void, slopes and the world's edge are refused with their reason. Headings favour
 * facing the place with the chase camera behind; among valid spots the nearest to the place wins. */
export function arrivalFor(placement,target,{spawns=[],seen=null,maxDistance=42}={}){
 const camera=placement.cameraHeading(),prefer=(x,z,cx,cz)=>{const out=[];if(camera!=null)out.push({heading:camera,weight:.5});const d=new THREE.Vector3(cx-x,0,cz-z);if(d.lengthSq()>4)out.push({heading:headingOf(d.normalize()),weight:.45});return out;};
 const finish=(c,extra)=>{const free=placement.heading(c.x,c.y,c.z,{prefer:prefer(c.x,c.z,extra.cx??c.x,extra.cz??c.z),samples:16,max:20}),again=free?placement.check(c.x,c.z,free.heading,extra.options):null;const pose=again?.ok?again:c;return Object.assign(pose,{ok:true,name:extra.name??null,source:extra.source??c.source??'travel'});};
 if(target.kind==='point'){
  const {x,z}=target,options={dynamicMargin:2,maxEdge:Infinity};if(![x,z].every(Number.isFinite))return {ok:false,reason:'invalid'};
  if(!placement.inBounds(x,z))return {ok:false,reason:'outside',x,z};
  const s=placement.surface(x,z);if(!s)return {ok:false,reason:'void',x,z};if(s.wet)return {ok:false,reason:'water',x,z};
  if(s.ground&&s.normal.y<Math.cos(PLACEMENT.slope*Math.PI/180))return {ok:false,reason:'steep',x,z};
  const first=s.ground?placement.check(x,z,camera??0,options):{ok:false,reason:'blocked'};if(first.ok)return finish(first,{options,source:'point'});
  const near=placement.near(x,z,{radius:4,step:1,prefer:prefer(x,z,x,z),...options});if(near)return finish(near,{options,source:'point'});
  return {ok:false,reason:['steep','edge','water'].includes(first.reason)?first.reason:'blocked',x,z};
 }
 const group=target.group??null,options={margin:group?.8:PLACEMENT.margin,dynamicMargin:2.5,maxEdge:4};
 if(!group){const {x,z}=target;if(![x,z].every(Number.isFinite))return {ok:false,reason:'invalid'};const near=placement.near(x,z,{radius:18,step:2,prefer:prefer(x,z,x,z),...options});return near?finish(near,{options,cx:x,cz:z,name:target.name,source:'marker'}):{ok:false,reason:'blocked',x,z};}
 const area=areaOf(group),cx=target.x??area.x,cz=target.z??area.z,clear=group.userData.recommendedClearance??3,mark=landmarkBox(group),candidates=[];
 // Never inside the landmark: the car's centre stays its half-diagonal plus the group's clearance outside it.
 const pad=clear+Math.hypot(PLACEMENT.half.x,PLACEMENT.half.z),outside=(x,z)=>!mark||x<mark.min.x-pad||x>mark.max.x+pad||z<mark.min.z-pad||z>mark.max.z+pad;
 for(const e of entrancesOf(group))for(const out of [clear+3,clear+6,clear+10])candidates.push({x:e.x+e.direction.x*out,z:e.z+e.direction.z*out,bonus:6,source:'entrance'});
 for(const s of spawns){if(!Array.isArray(s.position))continue;const [x,,z]=s.position;if(Math.hypot(x-cx,z-cz)<=area.radius+12)candidates.push({x,z,heading:s.rotation,bonus:4,source:'prefab'});}
 const rings=[area.radius*.55,area.radius+clear+2,area.radius+clear+6,area.radius+clear+11];if(mark){const half=Math.hypot(mark.max.x-mark.min.x,mark.max.z-mark.min.z)/2;rings.push(half+pad,half+pad+4);}
 for(const r of rings)for(let i=0;i<16;i++){const a=i/16*Math.PI*2;candidates.push({x:cx+Math.cos(a)*r,z:cz+Math.sin(a)*r,bonus:0,source:'ring'});}
 let best=null;
 for(const c of candidates){const distance=Math.hypot(c.x-cx,c.z-cz);if(distance>maxDistance||!outside(c.x,c.z))continue;const face=headingOf(new THREE.Vector3(cx-c.x,0,cz-c.z).normalize()),headings=[...(c.heading!=null?[c.heading]:[]),face,...(camera!=null?[camera]:[]),face+Math.PI/2,face-Math.PI/2];
  for(const h of headings){const r=placement.check(c.x,c.z,wrap(h),options);if(!r.ok)continue;let score=-distance+c.bonus+(seen?.(r.position,new THREE.Vector3(cx,r.y,cz))?5:0)-(placement.cameraClear(r.x,r.y,r.z)?0:8)-1.5*r.slope;if(camera!=null)score+=2*Math.cos(r.heading-camera);if(!best||score>best.score)best={...r,score,source:c.source};break;}}
 if(!best){const near=placement.near(cx,cz,{radius:maxDistance*.75,step:2.5,prefer:prefer(cx,cz,cx,cz),accept:c=>outside(c.x,c.z),...options});if(near)best=near;}
 return best?finish(best,{options,cx,cz,name:group.name,source:best.source}):{ok:false,reason:'blocked',x:cx,z:cz};
}
