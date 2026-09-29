import * as THREE from 'three';
/** Tangent adhesion for the authored loop ribbon. The car retains its real
 * chassis, suspension and colliders; assistance only changes orientation and
 * velocity, never position. Both connected road ends are valid entrances. */
export class LoopAssist {
 constructor(vehicle,points){
  this.vehicle=vehicle;this.points=points.map(([x,n,y])=>new THREE.Vector3(x,y,-n));
  this.active=false;this.index=0;this.direction=1;this.completed=0;this.contactSamples=[];this.enabled=true;
  // The two ends are separated along the ribbon's width axis. Deriving it
  // from the transformed path also supports rotated/scaled editor instances.
  this.ribbonSide=this.points.length>1?this.points[0].clone().sub(this.points.at(-1)).normalize():new THREE.Vector3(0,0,1);
  this.cooldown=0;this.stalled=0;this.previousIndex=0;
 }
 reset(){this.active=false;this.index=0;this.direction=1;this.contactSamples=[];this.stalled=0;this.cooldown=0;}
 frame(index,direction=this.direction){
  const tangent=this.points[Math.min(this.points.length-1,index+1)].clone().sub(this.points[Math.max(0,index-1)]).normalize().multiplyScalar(direction);
  const up=this.ribbonSide.clone().multiplyScalar(direction).cross(tangent).normalize();
  const side=tangent.clone().cross(up).normalize();return {tangent,up,side};
 }
 beforeStep(){
  if(!this.enabled||this.points.length<3)return;
  const v=this.vehicle,b=v.chassis.physical.body,p=new THREE.Vector3().copy(b.translation()),vel=new THREE.Vector3().copy(b.linvel()),dt=v.ticker.deltaScaled;
  this.cooldown=Math.max(0,this.cooldown-dt);
  if(!this.active){
   if(this.cooldown>0||v.input.braking>.1)return;
   for(const direction of [1,-1]){
    const index=direction===1?0:this.points.length-1,{tangent,up,side}=this.frame(index,direction),offset=p.clone().sub(this.points[index]);
    // Normal W driving reaches the entry at 6–9 m/s. The previous >12 m/s
    // +world-X check excluded it and all reverse-direction approaches.
    const speed=vel.dot(tangent),along=offset.dot(tangent),height=offset.dot(up);
    if(speed<3||along< -3||along>2||height<.3||height>2.1||Math.abs(offset.dot(side))>1.6||vel.clone().normalize().dot(tangent)<.7||v.wheels.inContactCount<2||v.forward.dot(tangent)<.7)continue;
    this.active=true;this.direction=direction;this.index=index;this.previousIndex=index;this.stalled=0;this.contactSamples=[];break;
   }
   if(!this.active)return;
  }
  let nearest=this.index,dist=Infinity;
  for(let j=-3;j<18;j++){
   const i=this.index+j*this.direction;if(i<0||i>=this.points.length)continue;
   const d=p.distanceToSquared(this.points[i]);if(d<dist){dist=d;nearest=i;}
  }
  this.index=this.direction===1?Math.max(this.index,nearest):Math.min(this.index,nearest);
  if(this.direction===1?this.index>=this.points.length-3:this.index<=2){this.active=false;this.completed++;this.cooldown=.6;return;}
  this.stalled=this.index===this.previousIndex?this.stalled+dt:0;this.previousIndex=this.index;
  // A displaced car or a real obstruction must release assistance rather
  // than repeatedly force velocity against a wall or pull it through one.
  if(dist>16||this.stalled>1.2||v.input.braking>.1){this.active=false;this.cooldown=1;return;}
  const {tangent,up,side}=this.frame(nearest),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent,up,side));
  const target=this.points[nearest].clone().addScaledVector(up,1.03),correction=target.sub(p);correction.addScaledVector(tangent,-correction.dot(tangent));
  const along=vel.dot(tangent),wanted=Math.max(17,Math.min(26,along)),speed=THREE.MathUtils.clamp(wanted,along-30*dt,along+30*dt);
  const next=tangent.multiplyScalar(speed).addScaledVector(correction,9);
  b.setRotation(q,true);b.setAngvel({x:0,y:0,z:0},true);b.setLinvel(next,true);
  this.contactSamples.push(v.wheels.inContactCount);
 }
}
