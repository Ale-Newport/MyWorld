import * as THREE from 'three';
import {PhysicsVehicle} from './PhysicsVehicle.js';
import {Events} from './Events.js';
import {VisualVehicle} from './VisualVehicle.js';
import {Materials} from './materials.js';
import {LoopAssist} from './loop.js';
import {Player} from '../portfolio/world/player/Player.js';
import {Inputs,ACTION_DEFINITIONS} from '../portfolio/world/input/Inputs.js';
import {View} from '../portfolio/world/view/View.js';
import {Tweens} from '../portfolio/world/core/Tween.js';
import {Bin} from '../portfolio/world/core/Disposal.js';
import {Audio} from '../portfolio/world/systems/Audio.js';
import {VehicleInput} from './vehicle-input.js';
import {VehicleModes,VehicleWater} from './vehicle-mode.js';
import {PlaneVisual} from './plane-visual.js';
import {CarJump} from './jump.js';
import {Placement,PLACEMENT,START_VIEW,centralPlaza,plazaSpawn,arrivalFor,framed,headingOf} from './placement.js';
import {Recovery} from './recovery.js';
const vec=p=>new THREE.Vector3(p[0],p[2],-p[1]);
/** World2 car tuning plus isolated parking, water, vehicle-mode, placement and recovery extensions.
 * Every way the car is put somewhere — the first spawn, travel from the M map, R, and recovery from the
 * sea, the void or a wreck — is validated by runtime/placement.js and carried out by place(), here. */
export class Driving {
 constructor(physics,scene,camera,navigation,keys,canvas=document.querySelector('#world'),{root=null}={}){
  Object.assign(this,{physics,camera,nav:navigation,keys,root});this.cameraMode=2;this.wet=0;this.bin=new Bin();this.events=new Events();this.hopHeld=false;
  this.ticker={events:new Events(),elapsed:0,elapsedScaled:0,deltaScaled:1/30,scale:2,delta:1/60,alpha:1};physics.ticker=this.ticker;
  this.inputs=new Inputs(canvas);this.inputs.add(ACTION_DEFINITIONS.filter(a=>a.name!=='jump').map(a=>({...a,keys:a.keys.filter(k=>k!=='Keyboard.Space')})));this.inputs.add([{name:'hop',label:'Jump',categories:['driving'],keys:['Keyboard.Numpad5','Gamepad.triangle','Touch.jump']}]);this.inputs.add([{name:'boardPrevious',label:'Previous project',categories:['minigame'],keys:['Keyboard.ArrowLeft','Keyboard.KeyA','Gamepad.left']},{name:'boardNext',label:'Next project',categories:['minigame'],keys:['Keyboard.ArrowRight','Keyboard.KeyD','Gamepad.right']}]);this.inputs.setFilters(['driving','camera']);this.bin.add(()=>this.inputs.destroy());
  this.tweens=new Tweens(this.ticker,this.bin);
  this.viewport={width:canvas.clientWidth,height:canvas.clientHeight,ratio:canvas.clientWidth/canvas.clientHeight,events:new Events()};
  this.view=new View(this.ticker,this.viewport,this.inputs,physics,this.bin,false);camera.copy(this.view.camera);this.view.camera=camera;
  this.vehicle=new PhysicsVehicle(physics,this.ticker,this.bin,vec(navigation.spawn));tuneVehicle(this.vehicle);
  this.vehicle.parking.enabled=true;
  this.roads=navigation.roads.flatMap(r=>r.samples.slice(0,-1).map((p,i)=>({p:vec(p),next:vec(r.samples[i+1]),width:r.width,name:r.name})));
  // Provisional until spawnInitial(): main.js calls it once every World2 prop exists, so they can be avoided.
  const provisional=()=>navigation.directSpawn?{...navigation.directSpawn,position:new THREE.Vector3(...navigation.directSpawn.position)}:{name:'Spawn',position:vec(navigation.spawn),rotation:0};
  this.player=new Player(this.inputs,this.vehicle,this.view,{getDefault:provisional,getClosest:provisional,getByName:()=>null},this.ticker,this.tweens,null,this.bin);
  this.placement=new Placement({physics,root,bounds:navigation.bounds,seaLevel:navigation.seaLevel??physics.waterElevation,exclude:this.vehicle.chassis.physical.body,cameraDirection:()=>this.cameraDirection(),cameraOffset:()=>new THREE.Vector3().setFromSphericalCoords(1,this.view.spherical.phi,this.view.spherical.theta)});
  this.recovery=new Recovery(this,{root,navigation,bounds:navigation.bounds});this.bin.add(()=>this.recovery.dispose());
  // R, a failed unstuck and any hazard respawn: races keep their gate respawn (onRespawnRequest), the rest recover nearby.
  // Only R itself ('manual', the key is down) may set the car back where it stands; a hazard's respawn moves it away.
  this.player.respawn=(name=null)=>{const stuck=this.unstuck;this.unstuck=false;if(name===null&&this.player.onRespawnRequest?.())return;this.recover(stuck?'stuck':this.inputs.isActive('respawn')?'manual':'respawn');};
  const unstuckFailed=()=>{this.unstuck=true;};this.player.events.on('unstuckFailed',unstuckFailed);
  this.player.rightItself=()=>this.rightInPlace();
  this.vehicleInput=new VehicleInput(this.inputs,()=>this.modes.toggle(),undefined,()=>this.hop());this.bin.add(()=>this.vehicleInput.dispose());
  // SPACE (and △ / numpad 5 / touch) is one hop per press; held, it keeps the wheels raised. See runtime/jump.js.
  this.jump=new CarJump(this.vehicle,this.player,this.ticker,{canJump:()=>!this.modes.isPlane&&!this.modes.transition&&!this.modes.drop&&this.player.state==='default',holding:()=>this.vehicleInput.held||this.hopHeld});this.bin.add(()=>this.jump.dispose());
  const hop=a=>{if(a.active)this.hopHeld=this.hop();else this.hopHeld=false;};this.inputs.events.on('hop',hop);this.bin.add(()=>this.inputs.events.off('hop',hop));
  this.modes=new VehicleModes(this.vehicle,this.player,this.view,physics,this.ticker,this.vehicleInput,{seaLevel:navigation.seaLevel??physics.waterElevation,bounds:navigation.bounds??{minX:-160,maxX:160,minZ:-150,maxZ:150}});this.bin.add(()=>this.modes.dispose());
  const originalCameraUpdate=this.view.update.bind(this.view);this.view.update=()=>{if(this.modes.isPlane||this.modes.drop)this.modes.updateCamera(this.ticker.delta);else{camera.fov=THREE.MathUtils.damp(camera.fov,25,5,this.ticker.delta);camera.updateProjectionMatrix();originalCameraUpdate();}};
  this.visual=new VisualVehicle(this.vehicle,this.player,this.inputs,physics,this.ticker,new Materials(this.bin),this.bin,true);this.visual.camera=camera;scene.add(this.visual.group);
  if(navigation.playerCarTemplate)this.visual.applyTemplate(navigation.playerCarTemplate);if(navigation.vehicleColor)this.setColor(navigation.vehicleColor);
  this.plane=new PlaneVisual(this.vehicle,physics,scene,navigation.planeTemplate);this.bin.add(()=>this.plane.dispose());
  this.loop=new LoopAssist(this.vehicle,navigation.loop?.points??[]);this.ticker.events.on('fixed',()=>{if(!this.modes.isPlane&&this.loop.points.length)this.loop.beforeStep();},1.5);this.ticker.events.on('fixed',()=>physics.step(),3);
  this.modes.events.on('change',()=>{this.loop.reset();this.jump.reset();this.hopHeld=false;this.visual.group.visible=!this.modes.isPlane;});
  this.save={data:{settings:{muted:true,volume:.5}},schedule(){}};this.audio=new Audio(this.ticker,this.player,this.vehicle,this.save,this.bin);this.audio.resume();
  this.vehicle.events.on('land',air=>{if(air>.35)this.view.kick(Math.min(1,air*.9));});this.vehicle.events.on('collision',force=>{if(force>24)this.view.kick(Math.min(1,force/140));});
  this.water=new VehicleWater(physics,this.vehicle,{seaLevel:navigation.seaLevel??physics.waterElevation,onRecover:()=>this.recover('water')});
  this.wake=new THREE.Mesh(new THREE.RingGeometry(.9,1.13,32),new THREE.MeshBasicMaterial({color:'#d9f8ec',transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));this.wake.name='Vehicle water wake';this.wake.rotation.x=-Math.PI/2;scene.add(this.wake);this.bin.add(()=>{this.wake.removeFromParent();this.wake.geometry.dispose();this.wake.material.dispose();});
 }
 nearest(position=this.vehicle.position){let best=null,d=Infinity;for(const road of this.roads){const n=road.p.distanceToSquared(position);if(n<d){d=n;best=road;}}if(!best){const p=this.home?.position??vec(this.nav.spawn);best={p,next:p.clone().add(new THREE.Vector3(1,0,0)),width:8,name:"Open ground"};d=p.distanceToSquared(position);}return {...best,distance:Math.sqrt(d)};}
 /** A press the car can act on: ignored in the air, in the plane, during a transition or an activity that holds the car. */
 hop(){if(this.modes.isPlane||this.modes.transition||this.player.state!=='default')return false;return this.jump.request();}
 /** Lets go of a held SPACE (or △): the wheels come down, nothing jumps. */
 releaseHold(){this.vehicleInput.reset();this.hopHeld=false;this.jump.release();}
 get mode(){return this.modes.mode;}
 get status(){return {mode:this.mode,state:this.modes.state,parked:this.vehicle.parking.active,wetness:this.water.wetness,deepWater:this.water.deepTime>0,altitude:Math.max(0,this.vehicle.position.y-(this.nav.seaLevel??this.physics.waterElevation)),controls:this.modes.isPlane?'W/S speed · A/D turn · Q/E or ↑/↓ pitch · drag mouse to steer · SPACE SPACE → Car':'WASD · SPACE jump, hold to raise the wheels · B brake · SPACE SPACE → Plane · Shift boost · R back on your wheels'};}
 setColor(color){this.visual.setColor(color);}
 /** The chase camera straight behind the car at its normal distance. View.snapToTarget() restarts the obstruction
  * easing from 1 m, which would pull the camera in onto the car and ease it back out; seeding it open instead
  * lets the probe place it where it belongs on the very first frame. */
 restoreCarCamera(){this.modes.drop=false;this.view.focusPoint.trackedPosition.copy(this.vehicle.position);this.view.focusPoint.position.copy(this.vehicle.position);this.view.snapToTarget();this.view.smoothedObstruction=Infinity;this.view.update();}
 respawn(){this.player.respawn();}
 /** The chase camera's horizontal view direction: /world keeps it at a fixed angle (View.spherical), south-east of the car. */
 cameraDirection(){const t=this.view.spherical.theta;return new THREE.Vector3(-Math.sin(t),0,-Math.cos(t));}
 /** Would `point` be on screen with the car at `from`, for the chase camera at its current angle (reference zoom and 16:9)? */
 seen(from,point){const s=this.view.spherical;return framed(from,point,{...START_VIEW,theta:s.theta,phi:s.phi});}
 /** The session's first pose: the studio's selection (DRIVE with something selected), then a spawn the
  * world document pins (worldVariant.spawnPinned), then the best place in the Central Plaza. Each is
  * validated now, with every prop in the world, and nudged at most 8 m when something stands on it. */
 spawnPose(){
  const p=this.placement,n=this.nav,settle=(at,rotation,source,name)=>{const c=p.check(at.x,at.z,rotation,{dynamicMargin:2});if(c.ok)return Object.assign(c,{source,name});const near=p.near(at.x,at.z,{radius:8,step:1,prefer:[{heading:rotation,weight:.8}],dynamicMargin:2});return near?Object.assign(near,{source,name}):null;};
  if(n.directSpawn){const at=new THREE.Vector3(...n.directSpawn.position),rotation=n.directSpawn.rotation??0;return settle(at,rotation,'selection',n.directSpawn.name)??{position:at,rotation,source:'selection',name:n.directSpawn.name};}
  if(n.spawnPinned&&Array.isArray(n.spawn)){const pose=settle(vec(n.spawn),Number(n.spawnHeading)||0,'pinned','Drive spawn');if(pose)return pose;console.warn('[world] The pinned drive spawn is no longer a valid place; starting in the Central Plaza instead.');}
  const plaza=centralPlaza(this.root);if(plaza){const pose=plazaSpawn(p,plaza,{seen:(from,point)=>this.seen(from,point)});if(pose)return pose;}
  const fallback=vec(n.spawn);return p.near(fallback.x,fallback.z,{radius:30,step:2})??{position:fallback,rotation:0,source:'navigation',name:'Spawn'};
 }
 spawnInitial(){this.physics.refreshQueries();const pose=this.spawnPose();this.home=pose;this.vehicle.chassis.physical.initialState.position={x:pose.position.x,y:pose.position.y,z:pose.position.z};this.place(pose,{reason:'spawn'});this.recovery.prepare();return pose;}
 /** A safe arrival for travel from the M map (runtime/placement.js). */
 arrival(target){return arrivalFor(this.placement,target,{root:this.root,spawns:this.nav.prefabSpawns??[],seen:(from,point)=>this.seen(from,point)});}
 /** The one way the car is put somewhere: spawn, map travel, R and every recovery. Leaves the plane through
  * the mode system, drops held inputs and raised wheels, teleports with the velocities zeroed and the
  * interpolation window collapsed (moveTo: no streak), seats the wheels at rest on the validated ground,
  * snaps the wheel visuals and the camera, and — except for the spawn and righting in place — tells the
  * activities, as a respawn always has (a run in progress ends). */
 place(pose,{reason='respawn'}={}){
  if(!pose?.position||!Number.isFinite(pose.position.x+pose.position.y+pose.position.z))return null;
  const v=this.vehicle,b=v.chassis.physical.body,at=pose.position,heading=pose.rotation??pose.heading??0;
  if(this.modes.isPlane){this.modes.setMode(false);this.camera.fov=25;this.camera.updateProjectionMatrix();}
  this.modes.transition=0;this.modes.state=this.modes.mode;this.modes.drop=false;b.enableCcd(this.modes.originalCCD);
  this.releaseHold();this.inputs.releaseAll();this.jump.reset();this.player.suspensions.fill('low');
  const wasStuck=v.stuck.active,wasUpsideDown=v.upsideDown.active;
  v.moveTo(at,heading);
  v.upward.set(0,1,0).applyQuaternion(v.quaternion);v.forward.set(1,0,0).applyQuaternion(v.quaternion);v.sideward.set(0,0,1).applyQuaternion(v.quaternion);v.airborneSince=this.ticker.elapsed;
  for(const w of v.wheels.items){w.inContact=true;w.suspensionState='low';w.suspensionLength=PLACEMENT.restSuspension;w.groundCollider=pose.collider??null;w.contactNormal={x:0,y:1,z:0};w.lastTouchTime=this.ticker.elapsed;}v.wheels.inContactCount=4;v.wheels.justTouchedCount=0;
  if(wasUpsideDown){v.upsideDown.active=false;v.upsideDown.ratio=0;v.events.trigger('rightSideUp');}if(wasStuck)v.events.trigger('unstuck');
  this.player.unstuckDelay?.kill();this.player.unstuckDelay=null;this.player.unstuckHop?.kill();this.player.unstuckHop=null;
  this.player.position.copy(at);if(reason!=='right')this.player.state='default';this.loop.reset();this.water.deepTime=0;this.wet=0;
  this.visual.snap();this.restoreCarCamera();this.recovery.placed(pose,reason);
  if(reason!=='spawn'&&reason!=='right')this.player.events.trigger('respawn',[pose]);
  this.events.trigger('placed',[pose,reason]);return pose;
 }
 flatHeading(){const f=this.vehicle.forward,d=new THREE.Vector3(f.x,0,f.z);return d.lengthSq()>1e-6?headingOf(d.normalize()):0;}
 /** Back on the wheels near the incident (runtime/recovery.js). R ('manual') first tries the very spot the car is on. */
 recover(reason='respawn'){
  if(this.recovering)return false;this.recovering=true;
  try{
   const v=this.vehicle,p=v.position,finite=Number.isFinite(p.x+p.y+p.z);
   // A race in progress keeps its own respawn: back through the last gate (player.respawn already asked for R and hazards).
   if(!['manual','respawn','stuck'].includes(reason)&&this.player.onRespawnRequest?.()){this.recovery.placed(null,'race');return true;}
   let pose=null;
   if(reason==='manual'&&finite){const c=this.placement.check(p.x,p.z,this.flatHeading(),{dynamicMargin:1});if(c.ok&&p.y<c.y+PLACEMENT.rest+4)pose=Object.assign(c,{source:'in place'});}
   pose??=this.recovery.choose(reason,finite?p.clone():null);if(!pose)return false;
   this.place(pose,{reason:'recover'});this.events.trigger('recovered',[reason,pose]);return true;
  }finally{this.recovering=false;}
 }
 /** The upside-down loop's last resort (Player): set back on the wheels where it lies, if that is a valid place; else recover nearby. */
 rightInPlace(){const p=this.vehicle.position,c=this.placement.check(p.x,p.z,this.flatHeading(),{dynamicMargin:.8});if(c.ok&&p.y<c.y+PLACEMENT.rest+3){this.place(c,{reason:'right'});this.player.events.trigger('hydraulics',[4,'mid']);return;}this.recover('overturned');}
 fixed(){this.ticker.elapsed+=1/60;this.ticker.elapsedScaled+=1/30;this.ticker.events.trigger('fixed');
  const incident=this.recovery.step(1/60);if(incident){this.recover(incident);return;}
  this.water.update(1/60,this.modes.isPlane);this.wet=this.water.deepTime;
 }
 render(dt,alpha){this.ticker.delta=dt;this.ticker.alpha=alpha;const canvas=this.inputs.pointer.element??document.querySelector('#world');const w=canvas.clientWidth,h=canvas.clientHeight;if(w!==this.viewport.width||h!==this.viewport.height){Object.assign(this.viewport,{width:w,height:h,ratio:w/h});this.viewport.events.trigger('change');}this.ticker.events.trigger('tick');this.plane.update(dt,alpha,this.modes.isPlane,this.modes.enginePower);const water=this.water.wetness;this.wake.visible=!this.modes.isPlane&&water>.04&&this.vehicle.xzSpeed>.25;this.wake.material.opacity=Math.min(.45,water*.55);this.wake.position.set(this.vehicle.position.x,(this.nav.seaLevel??this.physics.waterElevation)+.025,this.vehicle.position.z);this.wake.scale.set(1.6+Math.sin(this.ticker.elapsed*7)*.1,1+this.vehicle.xzSpeed*.03,1);}
 dispose(){this.visual.group.removeFromParent();this.bin.dispose();this.ticker.events.clear();this.events.clear();}
}
export function surfaceGrip(c){return c?.userData?.surface_type==='ice'?.025:c?.userData?.ground_surface&&c?.userData?.surface_type!=='terrain'?4:1.9;}
export function tuneVehicle(v){v.idleBrake=.14;v.boostMultiplier=.6;v.topSpeedBoost=22;v.chassis.physical.linearDamping=.18;v.chassis.physical.body.setLinearDamping(.18);const c=v.chassis.physical.body.collider(0);c.setMassProperties(c.mass(),{x:0,y:-.8,z:0},{x:1,y:1,z:1},{x:0,y:0,z:0,w:1});v.surfaceFriction=surfaceGrip;}
