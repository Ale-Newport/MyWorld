import * as THREE from 'three';
/* PUSHABLE PROPS
   The penguins and cones on a frozen lake are separate rigid bodies the car
   shoves across the ice. Masses are on the car's scale: its chassis is 2.5
   units for a roughly 1 000 kg roadster, so a unit is ~400 kg — a plastic
   skating-aid penguin (~10 kg) is .025 and a traffic cone (~4 kg) is .01.
   That keeps the car a hundred times heavier than what it hits, so a prop is
   pushed rather than the car stopped or thrown, and stays a mass ratio the
   solver handles without jitter.

   Each prop is two primitives, never a triangle mesh: a body shape fitted to
   the model, and a small dense ballast low down that puts the centre of mass
   near the ice. Penguins are two spheres, a big round base and a smaller
   head, so there is no flat flank to rest on: knocked over, the low centre of
   mass rolls them upright again like the toys they are. Cones keep their heavy
   base and topple only when hit hard enough.

   Friction combines with MIN, so a prop takes the surface's friction wherever
   that is lower than its own: .025 on the ice, its own .3 on grass, roads and
   the lake shore. The ice alone is slippery; nothing else in the world changes.

   Authored transforms are the reset positions. Where the car pushes a prop is
   simulation state: the physics layer puts every node back on stop, and none
   of it ever reaches a saved world. */
export const PUSHABLE_VERSION=1;
export const PUSHABLE_PRESETS=Object.freeze({
 'v4:plastic-penguin':{collider_shape:'SELF_RIGHTING',mass:.025,ballast:.75,friction:.3,restitution:.12,linear_damping:.3,angular_damping:.9},
 'v4:traffic-cone':{collider_shape:'CONE',mass:.01,ballast:.6,friction:.35,restitution:.08,linear_damping:.32,angular_damping:.6},
});
export const COLLIDER_SHAPES=['SELF_RIGHTING','CAPSULE','CONE','CYLINDER','BOX','SPHERE'];
const visible=n=>{for(let p=n;p;p=p.parent)if(!p.visible||p.userData.deleted)return false;return true;};
/** The experience group (or plain parent) an ice surface belongs to. */
function iceAreas(root){const areas=new Set();root.traverse(n=>{if(n.userData.surface_type!=='ice'||!visible(n))return;let p=n.parent;while(p&&p!==root&&!p.userData.worldExperience)p=p.parent;areas.add(p&&p!==root?p:n.parent);});return [...areas];}
/** Marks the penguins and cones sharing an area with an ice surface as pushable,
 * once. Returns the nodes it changed so the editor can mark the world dirty. */
export function upgradePushableProps(root){
 const changed=[];
 for(const area of iceAreas(root))area.traverse(n=>{const preset=PUSHABLE_PRESETS[n.userData.assetDefinitionId];if(!preset||!n.userData.editable_root||(n.userData.pushableVersion??0)>=PUSHABLE_VERSION)return;Object.assign(n.userData,{...preset,physics_mode:'DYNAMIC',collision:true,pushable:true,pushableVersion:PUSHABLE_VERSION,ccd:true,friction_rule:'min',assetPhysicsEdited:true});changed.push(n);});
 return changed;
}
/** Local bounds of every visible mesh under node, in node space without its scale. */
function localBounds(node){
 node.updateWorldMatrix(true,true);const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();node.matrixWorld.decompose(p,q,s);
 const inverse=new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1)).invert(),box=new THREE.Box3(),v=new THREE.Vector3();
 node.traverse(n=>{if(!n.isMesh||!n.visible)return;const a=n.geometry.attributes.position,m=new THREE.Matrix4().multiplyMatrices(inverse,n.matrixWorld);for(let i=0;i<a.count;i++)box.expandByPoint(v.fromBufferAttribute(a,i).applyMatrix4(m));});
 return box;
}
/** Two primitives fitted to the model: the body, and a ballast that carries most
 * of the mass near the base. Returned in the runtime Physics description format. */
export function pushableColliders(node){
 const d=node.userData,box=localBounds(node);if(box.isEmpty())return null;
 const size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3()),r=Math.max(.05,Math.min(size.x,size.z)/2),h=Math.max(.1,size.y),mass=d.mass??.02,ballast=THREE.MathUtils.clamp(d.ballast??.5,0,.9);
 const at=(x,y,z)=>({x,y,z}),base=box.min.y,body=mass*(1-ballast),weight=mass*ballast,colliders=[];
 switch(d.collider_shape){
  case 'CONE':colliders.push({shape:'cone',parameters:[h*.46,r*.62],position:at(c.x,base+h*.54,c.z),mass:body});colliders.push({shape:'cuboid',parameters:[r,Math.min(.04,h*.05),r],position:at(c.x,base+Math.min(.04,h*.05),c.z),mass:weight});break;
  case 'SELF_RIGHTING':{
   // The centre of mass must sit BELOW the base sphere's centre or the toy is in neutral
   // balance and stays wherever it falls: the ballast goes low and the head stays light.
   const rb=Math.min(r*1.05,h*.34),rt=rb*.62;colliders.push({shape:'ball',parameters:[rb],position:at(c.x,base+rb,c.z),mass:body*.8});colliders.push({shape:'ball',parameters:[rt],position:at(c.x,base+h-rt,c.z),mass:body*.2});colliders.push({shape:'ball',parameters:[rb*.3],position:at(c.x,base+rb*.3,c.z),mass:weight});break;}
  case 'CAPSULE':{const radius=Math.min(r,h/2*.95),half=Math.max(.01,h/2-radius);colliders.push({shape:'capsule',parameters:[half,radius],position:at(c.x,base+h/2,c.z),mass:body});colliders.push({shape:'ball',parameters:[radius*.55],position:at(c.x,base+radius*.6,c.z),mass:weight});break;}
  case 'CYLINDER':colliders.push({shape:'cylinder',parameters:[h/2,r],position:at(c.x,base+h/2,c.z),mass:body});colliders.push({shape:'cylinder',parameters:[h*.08,r*.95],position:at(c.x,base+h*.08,c.z),mass:weight});break;
  case 'SPHERE':colliders.push({shape:'ball',parameters:[Math.max(size.x,size.y,size.z)/2],position:at(c.x,c.y,c.z),mass});break;
  default:colliders.push({shape:'cuboid',parameters:[size.x/2,size.y/2,size.z/2],position:at(c.x,c.y,c.z),mass:body});colliders.push({shape:'cuboid',parameters:[size.x*.45,h*.06,size.z*.45],position:at(c.x,base+h*.06,c.z),mass:weight});
 }
 return colliders.filter(c=>c.mass>0||c.shape==='ball');
}
/** Every pushable body back on its authored spot, at rest. */
export function resetPushables(physics,filter=()=>true){let n=0;for(const p of physics.dynamic)if(p.node?.userData.pushable&&filter(p.node)){physics.reset(p);n++;}physics.render?.(1);return n;}
