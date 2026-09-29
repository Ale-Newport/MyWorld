import * as THREE from 'three';
import {Events} from './Events.js';
const up=new THREE.Vector3(0,1,0),clamp=THREE.MathUtils.clamp;
export const VehicleMode=Object.freeze({CAR:'CAR',PLANE:'PLANE',TRANSITION_TO_CAR:'TRANSITION_TO_CAR',TRANSITION_TO_PLANE:'TRANSITION_TO_PLANE'});

/** Two modes share one Rapier chassis. Only the selected controller runs. */
export class VehicleModes {
 constructor(vehicle,player,view,physics,ticker,input,{seaLevel=physics.waterElevation,ceiling=85,bounds=null}={}){
  Object.assign(this,{vehicle,player,view,physics,ticker,input,seaLevel,ceiling,bounds});this.events=new Events();this.state=VehicleMode.CAR;this.isPlane=false;this.transition=0;this.flightSpeed=10;this.heading=0;this.pitch=0;this.roll=0;this.turn=0;this.drop=false;this.impactGrace=0;this.cameraTarget=new THREE.Vector3();this.groups=vehicle.chassis.physical.colliders.map(c=>c.collisionGroups());
  this.originalCCD=vehicle.chassis.physical.body.isCcdEnabled();this.pre=()=>this.beforePhysics();ticker.events.on('fixed',this.pre,1.4);
  this.impact=force=>{vehicle.releaseParking();if(this.isPlane&&force>.015&&this.impactGrace<=0){this.impactGrace=.75;this.flightSpeed=Math.max(7,this.flightSpeed*.65);this.heading+=.65;this.pitch=.35;}};vehicle.events.on('collision',this.impact);
 }
 get mode(){return this.isPlane?VehicleMode.PLANE:VehicleMode.CAR;}
 toggle(){if(this.transition>0||this.player.state==='locked')return false;this.setMode(!this.isPlane);return true;}
 setMode(plane){
  if(plane===this.isPlane)return;
  const v=this.vehicle,b=v.chassis.physical.body,position=new THREE.Vector3().copy(b.translation()),velocity=new THREE.Vector3().copy(b.linvel());
  const heading=Math.atan2(-v.forward.z,v.forward.x);this.isPlane=plane;this.state=plane?VehicleMode.TRANSITION_TO_PLANE:VehicleMode.TRANSITION_TO_CAR;this.transition=.18;
  this.input.reset();v.releaseParking();v.input.accelerating=0;v.input.braking=0;v.input.boosting=0;this.player.suspensions.fill('low');v.activeController=!plane;b.enableCcd(true);
  if(plane){
   this.heading=heading;this.pitch=.14;this.roll=0;this.turn=0;this.drop=false;this.impactGrace=0;this.takeoffTime=2.3;
   this.flightSpeed=clamp(Math.hypot(velocity.x,velocity.z),10,24);position.y+=1.8;
   v.moveTo(position,heading);b.setGravityScale(0,true);b.setLinvel({x:Math.cos(heading)*this.flightSpeed,y:3,z:-Math.sin(heading)*this.flightSpeed},true);
   // Compact fuselage collision, no huge wing/branch collision boxes.
   v.chassis.physical.colliders.forEach((c,i)=>c.setCollisionGroups(i===2?0:(this.physics.groups.all<<16)|this.physics.groups.terrain));
   this.player.setState('flying');this.player.unstuckDelay?.kill();this.player.unstuckHop?.kill();this.view.endCinematic();this.input.inputs.setFilters?.(['camera']);
  }else{
   this.drop=true;v.moveTo(position,this.heading);b.setGravityScale(1,true);
   b.setLinvel({x:velocity.x,y:clamp(velocity.y,-18,5),z:velocity.z},true);b.setAngvel({x:0,y:0,z:0},true);
   v.chassis.physical.colliders.forEach((c,i)=>c.setCollisionGroups(this.groups[i]));this.player.setState('default');this.input.inputs.setFilters?.(['driving','camera']);
  }
  this.player.position.copy(position);this.view.focusPoint.trackedPosition.copy(position);this.cameraTarget.copy(position).addScaledVector(v.forward,10);this.events.trigger('change',[this.mode]);
 }
 beforePhysics(){
  const v=this.vehicle,b=v.chassis.physical.body,dt=this.ticker.deltaScaled;
  if(this.transition>0){this.transition=Math.max(0,this.transition-dt);if(!this.transition)this.state=this.mode;}
  const braking=this.input.update();
  if(!this.isPlane){
   this.steeringReturn=v.input.steering!==0?v.input.steering:THREE.MathUtils.damp(this.steeringReturn??0,0,12,dt);
   if(v.input.steering===0){v.input.steering=Math.abs(this.steeringReturn)<.0001?0:this.steeringReturn;this.player.steering=v.input.steering;}
   if(braking&&this.player.state==='default'){v.input.braking=1;v.input.accelerating=0;this.player.braking=1;this.player.accelerating=0;}
   // A long real fall is preserved, while a terminal velocity prevents tunnelling.
   const vel=b.linvel();if(vel.y< -18)b.setLinvel({x:vel.x,y:-18,z:vel.z},true);
   if(this.drop&&v.wheels.inContactCount>=2&&Math.abs(vel.y)<2){this.drop=false;b.enableCcd(this.originalCCD);this.view.focusPoint.position.y=v.position.y;this.view.snapToTarget();}
   return;
  }
  const intent=this.input.flight(),position=b.translation();
  this.flightSpeed=clamp(this.flightSpeed+intent.throttle*5*dt,8,24);
  this.turn=THREE.MathUtils.damp(this.turn,intent.turn,4,dt);
  let wantedPitch=intent.pitch*.48;
  if(this.takeoffTime>0){this.takeoffTime=Math.max(0,this.takeoffTime-dt);if(intent.pitch>=0)wantedPitch=Math.max(wantedPitch,.36);}
  // Last 20 metres progressively remove climb; above ceiling gently descend.
  if(wantedPitch>0)wantedPitch*=clamp((this.ceiling-position.y)/20,0,1);
  if(position.y>this.ceiling)wantedPitch=Math.min(wantedPitch,-Math.min(.22,(position.y-this.ceiling)*.035));
  if(this.impactGrace>0){this.impactGrace=Math.max(0,this.impactGrace-dt);wantedPitch=Math.max(wantedPitch,.3);}
  this.pitch=THREE.MathUtils.damp(this.pitch,wantedPitch,2.8,dt);
  this.heading-=this.turn*.64*dt;
  // Soft return pressure beyond the world, never teleport or an invisible wall.
  if(this.bounds){const cx=(this.bounds.minX+this.bounds.maxX)/2,cz=(this.bounds.minZ+this.bounds.maxZ)/2,rx=(this.bounds.maxX-this.bounds.minX)/2+80,rz=(this.bounds.maxZ-this.bounds.minZ)/2+80;const distance=Math.hypot((position.x-cx)/rx,(position.z-cz)/rz);if(distance>1){const target=Math.atan2(-(cz-position.z),cx-position.x),angle=Math.atan2(Math.sin(target-this.heading),Math.cos(target-this.heading));this.heading+=clamp(angle,-.35,.35)*Math.min(1,distance-1)*dt;}}
  this.roll=THREE.MathUtils.damp(this.roll,-this.turn*.48,4,dt);
  const direction=new THREE.Vector3(Math.cos(this.heading)*Math.cos(this.pitch),Math.sin(this.pitch),-Math.sin(this.heading)*Math.cos(this.pitch));
  const right=new THREE.Vector3().crossVectors(direction,up).normalize(),normal=new THREE.Vector3().crossVectors(right,direction).normalize();
  const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(direction,normal,right));q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),this.roll));
  b.setRotation(q,true);b.setAngvel({x:0,y:0,z:0},true);b.setLinvel(direction.multiplyScalar(this.flightSpeed),true);
 }
 updateCamera(dt){
  const p=this.vehicle.position,f=this.vehicle.forward.clone();f.y=0;f.normalize();
  const target=p.clone().addScaledVector(f,10),desired=p.clone().addScaledVector(f,-17).add(new THREE.Vector3(0,8,0));
  const camera=this.view.camera;camera.position.lerp(desired,1-Math.exp(-dt*4));this.cameraTarget.lerp(target,1-Math.exp(-dt*6));camera.lookAt(this.cameraTarget);camera.fov=THREE.MathUtils.damp(camera.fov,this.isPlane?52:42,4,dt);camera.updateProjectionMatrix();camera.updateMatrixWorld();
 }
 dispose(){this.ticker.events.off('fixed',this.pre);this.vehicle.events.off('collision',this.impact);this.events.clear();}
}

/** Smooth World2 damping remains in Physics; only sustained *deep* water
 * invokes recovery, so submerged beach tyre contact can drive back out. */
export class VehicleWater {
 constructor(physics,vehicle,{seaLevel=physics.waterElevation,onRecover=()=>{}}={}){Object.assign(this,{physics,vehicle,seaLevel,onRecover});this.deepTime=0;this.wetness=0;this.depth=0;}
 update(dt,plane=false){
  const p=this.vehicle.position,level=this.physics.waterAt?.(p.x,p.z)??this.seaLevel;
  this.depth=level-p.y;this.wetness=clamp((this.depth+1.1)/1.7,0,1);
  if(plane){this.deepTime=0;return;}
  const ground=this.physics.groundAt(p.x,p.z,p.y+3,100),floorDepth=ground===null?Infinity:level-ground;
  const deep=this.depth>1.35||(floorDepth>2&&this.depth>.55);
  this.deepTime=deep?this.deepTime+dt:Math.max(0,this.deepTime-dt*2);
  if(this.deepTime>2.2||p.y<level-14){this.deepTime=0;this.onRecover();}
 }
}
