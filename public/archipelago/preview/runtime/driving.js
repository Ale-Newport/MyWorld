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
const vec=p=>new THREE.Vector3(p[0],p[2],-p[1]);
/** World2 car tuning plus isolated parking, water and vehicle-mode extensions. */
export class Driving {
 constructor(physics,scene,camera,navigation,keys,canvas=document.querySelector('#world')){
  Object.assign(this,{physics,camera,nav:navigation,keys});this.cameraMode=2;this.wet=0;this.bin=new Bin();
  this.ticker={events:new Events(),elapsed:0,elapsedScaled:0,deltaScaled:1/30,scale:2,delta:1/60,alpha:1};physics.ticker=this.ticker;
  this.inputs=new Inputs(canvas);this.inputs.add(ACTION_DEFINITIONS.map(a=>({...a,keys:a.keys.filter(k=>k!=='Keyboard.Space')})));this.inputs.add([{name:'boardPrevious',label:'Previous project',categories:['minigame'],keys:['Keyboard.ArrowLeft','Keyboard.KeyA','Gamepad.left']},{name:'boardNext',label:'Next project',categories:['minigame'],keys:['Keyboard.ArrowRight','Keyboard.KeyD','Gamepad.right']}]);this.inputs.setFilters(['driving','camera']);this.bin.add(()=>this.inputs.destroy());
  this.tweens=new Tweens(this.ticker,this.bin);
  this.viewport={width:canvas.clientWidth,height:canvas.clientHeight,ratio:canvas.clientWidth/canvas.clientHeight,events:new Events()};
  this.view=new View(this.ticker,this.viewport,this.inputs,physics,this.bin,false);camera.copy(this.view.camera);this.view.camera=camera;
  this.vehicle=new PhysicsVehicle(physics,this.ticker,this.bin,vec(navigation.spawn));tuneVehicle(this.vehicle);
  this.vehicle.parking.enabled=true;
  this.roads=navigation.roads.flatMap(r=>r.samples.slice(0,-1).map((p,i)=>({p:vec(p),next:vec(r.samples[i+1]),width:r.width,name:r.name})));
  const spawn=()=>navigation.directSpawn?{...navigation.directSpawn,position:new THREE.Vector3(...navigation.directSpawn.position)}:this.spawnAt(vec(navigation.spawn));const respawns={getDefault:spawn,getClosest:p=>this.spawnAt(p),getByName:()=>null};
  this.player=new Player(this.inputs,this.vehicle,this.view,respawns,this.ticker,this.tweens,null,this.bin);
  this.vehicleInput=new VehicleInput(this.inputs,()=>this.modes.toggle());this.bin.add(()=>this.vehicleInput.dispose());
  this.modes=new VehicleModes(this.vehicle,this.player,this.view,physics,this.ticker,this.vehicleInput,{seaLevel:navigation.seaLevel??physics.waterElevation,bounds:navigation.bounds??{minX:-160,maxX:160,minZ:-150,maxZ:150}});this.bin.add(()=>this.modes.dispose());
  const originalCameraUpdate=this.view.update.bind(this.view);this.view.update=()=>{if(this.modes.isPlane||this.modes.drop)this.modes.updateCamera(this.ticker.delta);else{camera.fov=THREE.MathUtils.damp(camera.fov,25,5,this.ticker.delta);camera.updateProjectionMatrix();originalCameraUpdate();}};
  this.visual=new VisualVehicle(this.vehicle,this.player,this.inputs,physics,this.ticker,new Materials(this.bin),this.bin,true);this.visual.camera=camera;scene.add(this.visual.group);
  if(navigation.playerCarTemplate)this.visual.applyTemplate(navigation.playerCarTemplate);if(navigation.vehicleColor)this.setColor(navigation.vehicleColor);
  this.plane=new PlaneVisual(this.vehicle,physics,scene,navigation.planeTemplate);this.bin.add(()=>this.plane.dispose());
  this.loop=new LoopAssist(this.vehicle,navigation.loop?.points??[]);this.ticker.events.on('fixed',()=>{if(!this.modes.isPlane&&this.loop.points.length)this.loop.beforeStep();},1.5);this.ticker.events.on('fixed',()=>physics.step(),3);
  this.modes.events.on('change',()=>{this.loop.reset();this.visual.group.visible=!this.modes.isPlane;});
  this.save={data:{settings:{muted:true,volume:.5}},schedule(){}};this.audio=new Audio(this.ticker,this.player,this.vehicle,this.save,this.bin);this.audio.resume();
  this.player.events.on('respawn',()=>{if(this.modes.isPlane)this.modes.setMode(false);this.inputs.releaseAll();this.vehicleInput.reset();this.player.suspensions.fill('low');this.loop.reset();this.wet=0;this.restoreCarCamera();});
  this.vehicle.events.on('land',air=>{if(air>.35)this.view.kick(Math.min(1,air*.9));});this.vehicle.events.on('collision',force=>{if(force>24)this.view.kick(Math.min(1,force/140));});
  this.lastSafe=spawn();
  this.water=new VehicleWater(physics,this.vehicle,{seaLevel:navigation.seaLevel??physics.waterElevation,onRecover:()=>{this.vehicle.moveTo(this.lastSafe.position,this.lastSafe.rotation);this.player.position.copy(this.lastSafe.position);this.loop.reset();this.restoreCarCamera();}});
  this.wake=new THREE.Mesh(new THREE.RingGeometry(.9,1.13,32),new THREE.MeshBasicMaterial({color:'#d9f8ec',transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));this.wake.name='Vehicle water wake';this.wake.rotation.x=-Math.PI/2;scene.add(this.wake);this.bin.add(()=>{this.wake.removeFromParent();this.wake.geometry.dispose();this.wake.material.dispose();});
 }
 nearest(position=this.vehicle.position){let best=null,d=Infinity;for(const road of this.roads){const n=road.p.distanceToSquared(position);if(n<d){d=n;best=road;}}if(!best){const p=this.nav.directSpawn?new THREE.Vector3(...this.nav.directSpawn.position):vec(this.nav.spawn);best={p,next:p.clone().add(new THREE.Vector3(1,0,0)),width:8,name:"Terreno"};d=p.distanceToSquared(position);}return {...best,distance:Math.sqrt(d)};}
 spawnAt(position){const r=this.nearest(position),p=r.p.clone();p.y+=1.18;const t=r.next.clone().sub(r.p),road={name:r.name,position:p,rotation:Math.atan2(-t.z,t.x)};const options=[road,...(this.nav.prefabSpawns??[]).map(s=>({...s,position:new THREE.Vector3(...s.position)}))];if(this.nav.directSpawn)options.push({...this.nav.directSpawn,position:new THREE.Vector3(...this.nav.directSpawn.position)});return options.sort((a,b)=>a.position.distanceToSquared(position)-b.position.distanceToSquared(position))[0];}
 get mode(){return this.modes.mode;}
 get status(){return {mode:this.mode,state:this.modes.state,parked:this.vehicle.parking.active,wetness:this.water.wetness,deepWater:this.water.deepTime>0,altitude:Math.max(0,this.vehicle.position.y-(this.nav.seaLevel??this.physics.waterElevation)),controls:this.modes.isPlane?'W/S speed · A/D turn · Q/E or ↑/↓ pitch · drag mouse to steer · SPACE SPACE → Car':'WASD · SPACE handbrake · SPACE SPACE → Plane · Shift boost · R respawn'};}
 setColor(color){this.visual.setColor(color);}
 restoreCarCamera(){this.modes.drop=false;this.view.focusPoint.trackedPosition.copy(this.vehicle.position);this.view.focusPoint.position.copy(this.vehicle.position);this.view.snapToTarget();}
 respawn(){if(this.modes.isPlane)this.modes.setMode(false);this.player.respawn();}
 fixed(){this.ticker.elapsed+=1/60;this.ticker.elapsedScaled+=1/30;this.ticker.events.trigger('fixed');const v=this.vehicle,n=this.nearest();if(n.distance<n.width/2&&v.upward.y>.9&&v.wheels.inContactCount>=3)this.lastSafe=this.spawnAt(v.position);
  this.water.update(1/60,this.modes.isPlane);this.wet=this.water.deepTime;
 }
 render(dt,alpha){this.ticker.delta=dt;this.ticker.alpha=alpha;const canvas=this.inputs.pointer.element??document.querySelector('#world');const w=canvas.clientWidth,h=canvas.clientHeight;if(w!==this.viewport.width||h!==this.viewport.height){Object.assign(this.viewport,{width:w,height:h,ratio:w/h});this.viewport.events.trigger('change');}this.ticker.events.trigger('tick');this.plane.update(dt,alpha,this.modes.isPlane);const water=this.water.wetness;this.wake.visible=!this.modes.isPlane&&water>.04&&this.vehicle.xzSpeed>.25;this.wake.material.opacity=Math.min(.45,water*.55);this.wake.position.set(this.vehicle.position.x,(this.nav.seaLevel??this.physics.waterElevation)+.025,this.vehicle.position.z);this.wake.scale.set(1.6+Math.sin(this.ticker.elapsed*7)*.1,1+this.vehicle.xzSpeed*.03,1);}
 dispose(){this.visual.group.removeFromParent();this.bin.dispose();this.ticker.events.clear();}
}
export function surfaceGrip(c){return c?.userData?.surface_type==='ice'?.025:c?.userData?.ground_surface&&c?.userData?.surface_type!=='terrain'?4:1.9;}
export function tuneVehicle(v){v.idleBrake=.14;v.boostMultiplier=.6;v.topSpeedBoost=22;v.chassis.physical.linearDamping=.18;v.chassis.physical.body.setLinearDamping(.18);const c=v.chassis.physical.body.collider(0);c.setMassProperties(c.mass(),{x:0,y:-.8,z:0},{x:1,y:1,z:1},{x:0,y:0,z:0,w:1});v.surfaceFriction=surfaceGrip;}
