import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {Physics as PortfolioPhysics} from '../portfolio/world/physics/Physics.js';
import {Events} from './Events.js';
export {RAPIER};
/** An explicit No Collision preset disables its subtree. Plain grouping roots
 * with collision:false (trees/lakes) can still contain physical child parts. */
export function collisionDisabled(node){return node.userData.physicsPreset==='No Collision'||node.userData.collisionSubtree===false||(node.userData.assetPhysicsEdited&&node.userData.collision===false);}
export function hasDisabledCollisionAncestor(node,stopAt=null){for(let p=node;p&&p!==stopAt;p=p.parent)if(collisionDisabled(p)||p.userData.editorOnly||p.userData.deleted)return true;return false;}
export function collisionMeshes(root){const meshes=[];const visit=node=>{if(node.userData.editorOnly||node.userData.deleted||collisionDisabled(node))return;if(node!==root&&node.userData.assetPhysicsEdited&&node.userData.collision)return;if(node.isMesh&&(node===root||node.userData.collision!==false)&&node.geometry?.attributes.position?.count>=3&&(!node.geometry.index||node.geometry.index.count>=3))meshes.push(node);for(const child of node.children)visit(child);};visit(root);return meshes;}
/** Original World2 body factory, contact events and solver; mesh authoring adapter below. */
export class Physics extends PortfolioPhysics {
 constructor(){const ticker={events:new Events(),deltaScaled:1/30};super(RAPIER,ticker,{add(){}});this.dynamic=[];this.colliders=new Map();this.waterElevation=-1.2;}
 add(description){
  const desc={...description,colliders:description.colliders.map(c=>({...c,shape:c.shape==='convexHull'?'hull':c.shape,quaternion:c.quaternion??c.rotation}))};
  if(desc.type==='kinematic')desc.type='kinematicPositionBased';
  desc.category??=desc.type==='fixed'?'floor':'object';
  const p=super.add(desc);p.node=desc.node;p.home={position:p.current.position.clone(),quaternion:p.current.quaternion.clone()};
  if(desc.centerOfMass)for(const c of p.colliders)c.setMassProperties(c.mass(),desc.centerOfMass,{x:.24,y:.24,z:.24},{x:0,y:0,z:0,w:1});
  if(desc.gravityScale!==undefined)p.body.setGravityScale(desc.gravityScale,true);
  if(p.static)p.body.setAdditionalMass(5000,true);
  for(const c of p.colliders){c.userData=desc.metadata??{};this.colliders.set(c.handle,c.userData);}
  if(desc.type==='dynamic')this.dynamic.push(p);return p;
 }
 remove(p){this.dynamic=this.dynamic.filter(x=>x!==p);super.remove(p);}
  mesh(node){
    const d=node.userData;if(!d.collision)return;
    const dyn=d.physics_mode==='DYNAMIC';node.updateWorldMatrix(true,true);
    const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();node.matrixWorld.decompose(p,q,s);
    const inverse=new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1)).invert();
    const meshes=collisionMeshes(node);if(!meshes.length)return;
    let colliders=[],all=[];
    for(const mesh of meshes){
      const transform=dyn?inverse.clone().multiply(mesh.matrixWorld):mesh.matrixWorld;
      const geometry=mesh.geometry.clone().applyMatrix4(transform);
      const vertices=Float32Array.from(geometry.attributes.position.array);
      if(dyn)for(const n of vertices)all.push(n);
      else colliders.push({shape:'trimesh',parameters:[vertices,geometry.index?Uint32Array.from(geometry.index.array):Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i)],mass:0});
      geometry.dispose();
    }
    if(dyn&&all.length<9||!dyn&&!colliders.length)return;
    if(dyn)colliders=[{shape:'convexHull',parameters:[Float32Array.from(all)],mass:d.mass??1}];
    else{p.set(0,0,0);q.identity();}
    let centerOfMass;
    if(d.center_of_mass&&all.length){
      let bottom=Infinity;for(let i=1;i<all.length;i+=3)bottom=Math.min(bottom,all[i]);
      const feet=new THREE.Box3();for(let i=0;i<all.length;i+=3)if(all[i+1]<bottom+.008)feet.expandByPoint(new THREE.Vector3(all[i],all[i+1],all[i+2]));
      centerOfMass=feet.getCenter(new THREE.Vector3());centerOfMass.y=0;
    }
    const physical=this.add({type:dyn?'dynamic':'fixed',position:p,rotation:q,colliders,friction:d.friction??.7,restitution:d.restitution??.07,linearDamping:d.linear_damping??.06,angularDamping:d.angular_damping??.1,gravityScale:d.gravity_scale??1,centerOfMass,node:dyn?node:null,metadata:d});
    if(dyn){
      physical.authoring={parent:node.parent,index:node.parent?.children.indexOf(node),position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone()};
      physical.worldScale=s.clone();
      if(d.lock_translation)physical.body.setEnabledTranslations(...d.lock_translation.map(v=>!v),true);
      if(d.lock_rotation)physical.body.setEnabledRotations(...d.lock_rotation.map(v=>!v),true);
    }
    return physical;
  }

 destroy(){for(const physical of this.dynamic){const a=physical.authoring,n=physical.node;if(!a||!n)continue;if(a.parent){a.parent.add(n);const children=a.parent.children,now=children.indexOf(n);children.splice(now,1);children.splice(Math.min(a.index,children.length),0,n);}else n.removeFromParent();n.position.copy(a.position);n.quaternion.copy(a.quaternion);n.scale.copy(a.scale);n.updateMatrixWorld(true);}this.dynamic.length=0;this.colliders.clear();super.destroy();}
 render(alpha){const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),matrix=new THREE.Matrix4(),inverse=new THREE.Matrix4();for(const p of this.dynamic)if(p.node){const node=p.node;position.lerpVectors(p.previous.position,p.current.position,alpha);quaternion.slerpQuaternions(p.previous.quaternion,p.current.quaternion,alpha);matrix.compose(position,quaternion,p.worldScale??node.scale);if(node.parent){node.parent.updateWorldMatrix(true,false);matrix.premultiply(inverse.copy(node.parent.matrixWorld).invert());}matrix.decompose(node.position,node.quaternion,node.scale);node.updateMatrixWorld(true);}}
 resetProps(){for(const p of this.dynamic)if(p.node)this.reset(p);}
}
