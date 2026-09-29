import * as THREE from 'three';
/** A prefab keeps World2's authored coordinate system. Only this boundary
 * converts its bodies to the shared world; the original controllers stay local. */
export class LocalPhysics {
 constructor(physics,matrix,nodes){this.base=physics;this.matrix=matrix.clone();this.inverse=matrix.clone().invert();this.nodes=nodes;this.cache=new Map();this.matrix.decompose(new THREE.Vector3(),this.rotation=new THREE.Quaternion(),this.size=new THREE.Vector3());this.scale=this.size.x;this.inverseRotation=this.rotation.clone().invert();this.categories=physics.categories;this.rapier=physics.rapier;this.world=physics.world;}
 point(v){return new THREE.Vector3(v.x,v.y,v.z).applyMatrix4(this.matrix);}
 local(v){return new THREE.Vector3(v.x,v.y,v.z).applyMatrix4(this.inverse);}
 vector(v){return new THREE.Vector3(v.x,v.y,v.z).applyQuaternion(this.rotation).multiplyScalar(this.scale);}
 localVector(v){return new THREE.Vector3(v.x,v.y,v.z).applyQuaternion(this.inverseRotation).divideScalar(this.scale);}
 quaternion(q){return this.rotation.clone().multiply(new THREE.Quaternion(q.x,q.y,q.z,q.w));}
 localQuaternion(q){return this.inverseRotation.clone().multiply(new THREE.Quaternion(q.x,q.y,q.z,q.w));}
 get physicals(){return this.base.physicals.map(p=>this.wrap(p));}
 set waterElevation(v){} set waterAt(v){}
 add(d){
  const scale=this.scale,colliders=d.colliders.map(c=>{
   const out={...c,parameters:[...c.parameters]};
   if(['trimesh','hull','convexHull'].includes(c.shape))out.parameters[0]=Float32Array.from(c.parameters[0],x=>x*scale);
   else if(c.shape==='heightfield')out.parameters[3]={x:c.parameters[3].x*scale,y:c.parameters[3].y*scale,z:c.parameters[3].z*scale};
   else out.parameters=out.parameters.map(x=>typeof x==='number'?x*scale:x);
   if(c.position)out.position=new THREE.Vector3().copy(c.position).multiplyScalar(scale);
   if(c.centerOfMass)out.centerOfMass=new THREE.Vector3().copy(c.centerOfMass).multiplyScalar(scale);
   return out;
  });
  const category=this.nodes.get(d.owner)?.userData.w2Category;
  const p=this.base.add({...d,position:this.point(d.position??{x:0,y:0,z:0}),rotation:this.quaternion(d.rotation??{x:0,y:0,z:0,w:1}),colliders,metadata:{ground_surface:d.type==='fixed',surface_type:category==='roads'?'road':'terrain',world2:true},onCollision:d.onCollision?(force,at)=>d.onCollision(force,this.local(at)):undefined});
  return this.wrap(p);
 }
 wrap(p){
  if(this.cache.has(p))return this.cache.get(p);const local=this;
  const body=new Proxy(p.body,{get(target,key){
   if(key==='translation')return ()=>local.local(target.translation());
   if(key==='rotation')return ()=>local.localQuaternion(target.rotation());
   if(['linvel','angvel'].includes(key))return ()=>key==='linvel'?local.localVector(target[key]()):new THREE.Vector3().copy(target[key]()).applyQuaternion(local.inverseRotation);
   if(['setTranslation','setNextKinematicTranslation'].includes(key))return (v,...args)=>target[key](local.point(v),...args);
   if(['setRotation','setNextKinematicRotation'].includes(key))return (v,...args)=>target[key](local.quaternion(v),...args);
   if(['setLinvel','applyImpulse','addForce'].includes(key))return (v,...args)=>target[key](local.vector(v),...args);
   if(['setAngvel','applyTorqueImpulse','addTorque'].includes(key))return (v,...args)=>target[key](new THREE.Vector3().copy(v).applyQuaternion(local.rotation),...args);
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const wrapped=new Proxy(p,{get(target,key){
   if(key==='raw')return p;if(key==='body')return body;
   if(key==='current'||key==='previous')return {position:local.local(target[key].position),quaternion:local.localQuaternion(target[key].quaternion)};
   if(key==='initialState')return {...target.initialState,position:local.local(target.initialState.position),rotation:local.localQuaternion(target.initialState.rotation)};
   return target[key];
  },set(target,key,value){target[key]=value;return true;}});this.cache.set(p,wrapped);return wrapped;
 }
 reset(p){this.base.reset(p.raw??p);}
 remove(p){this.base.remove(p.raw??p);this.cache.delete(p.raw??p);}
 groundAt(x,z,y=60,distance=200){const at=this.point({x,y,z});const ground=this.base.groundAt(at.x,at.z,at.y,distance*this.scale);return ground===null?null:this.local({x:at.x,y:ground,z:at.z}).y;}
}
