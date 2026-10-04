import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
let pending;
/** Blender calls the propeller "Cube.004"; GLTFLoader strips the dot from node
 * names and keeps the original in userData.name, so match all three spellings. */
const PROPELLER=/^Cube\.?004$/;
export function findPropeller(model){let found=null;model.traverse(n=>{if(!found&&(n.userData.vehiclePart==='propeller'||PROPELLER.test(n.name)||PROPELLER.test(n.userData.name??'')))found=n;});return found;}
export function preparePlaneModel(scene){
  const root=new THREE.Group();root.name='Corsair Plane';root.userData={assetId:'vehicle-corsair',category:'Vehicles',playerVehicle:'plane',source:'User supplied Corsair GLB',collision:true,physics_mode:'STATIC'};
  const model=scene;model.name='Airframe';model.rotation.y=-Math.PI/2;model.scale.setScalar(.42);model.position.y=-.5;
  const prop=findPropeller(model);if(prop)prop.userData.vehiclePart='propeller';
  model.traverse(node=>{if(node.name==='Cube.007'||node.name==='Cube007')node.name='Fuselage and wings';if(node.isMesh){node.castShadow=true;node.receiveShadow=true;node.userData={...node.userData,collision:false,editable:true};}});
  model.getObjectByName('Fuselage and wings')?.traverse(node=>{if(node.isMesh)node.userData.collision=true;});
  root.add(model);return root;
}
export function loadPlaneModel(){
 if(!pending)pending=new GLTFLoader().loadAsync(new URL('../../assets/vehicles/plane/corsair.glb',import.meta.url).href).then(gltf=>preparePlaneModel(gltf.scene));return pending;
}
/** The blur a spinning three-blade propeller leaves on the eye: a faint grey disc
 * of blade, the yellow tips smeared into a ring, three soft streaks. */
function blurTexture(){
 const size=256,c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d'),r=size/2;
 g.translate(r,r);
 const disc=g.createRadialGradient(0,0,r*.12,0,0,r);disc.addColorStop(0,'rgba(48,52,50,0)');disc.addColorStop(.18,'rgba(48,52,50,.32)');disc.addColorStop(.8,'rgba(48,52,50,.2)');disc.addColorStop(.84,'rgba(222,166,41,.55)');disc.addColorStop(.97,'rgba(222,166,41,.42)');disc.addColorStop(1,'rgba(222,166,41,0)');
 g.fillStyle=disc;g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.fill();
 for(let i=0;i<3;i++){g.save();g.rotate(i*Math.PI*2/3);const streak=g.createLinearGradient(0,-r*.2,0,r*.2);streak.addColorStop(0,'rgba(30,32,31,0)');streak.addColorStop(.5,'rgba(30,32,31,.16)');streak.addColorStop(1,'rgba(30,32,31,0)');g.fillStyle=streak;g.beginPath();g.moveTo(0,0);g.arc(0,0,r*.96,-.26,.26);g.closePath();g.fill();g.restore();}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
/** Re-hangs the propeller on a pivot at its hub and works out, once, which local
 * axis is the airframe's flight axis. Only the propeller's own meshes turn. */
function rigPropeller(model){
 const prop=findPropeller(model);if(!prop)return null;
 model.updateMatrixWorld(true);const toModel=new THREE.Matrix4().copy(model.matrixWorld).invert(),sum=new THREE.Vector3(),v=new THREE.Vector3(),points=[];
 // Identical blades spaced evenly average out to the shaft: the hub is the mean vertex.
 prop.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position,m=new THREE.Matrix4().multiplyMatrices(toModel,n.matrixWorld);for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(m);sum.add(v);points.push(v.clone());}});
 if(!points.length)return null;const hub=sum.divideScalar(points.length),axisModel=new THREE.Vector3(1,0,0);
 let radius=0;for(const p of points){const d=p.clone().sub(hub);d.addScaledVector(axisModel,-d.dot(axisModel));radius=Math.max(radius,d.length());}
 const parent=prop.parent,pivot=new THREE.Group();pivot.name='Propeller pivot';pivot.userData.vehiclePart='propeller-pivot';
 parent.add(pivot);pivot.position.copy(parent.worldToLocal(hub.clone().applyMatrix4(model.matrixWorld)));pivot.updateMatrixWorld(true);pivot.attach(prop);
 // The flight axis expressed in the pivot's own frame (the airframe group is rotated and scaled).
 const toPivot=new THREE.Matrix4().copy(pivot.matrixWorld).invert().multiply(model.matrixWorld),axis=axisModel.clone().transformDirection(toPivot).normalize();
 const blades=[];prop.traverse(n=>{if(n.isMesh){n.material=n.material.clone();blades.push(n);}});
 const scale=new THREE.Vector3();pivot.getWorldScale(scale);const modelScale=new THREE.Vector3();model.getWorldScale(modelScale);
 const disc=new THREE.Mesh(new THREE.CircleGeometry(radius*modelScale.x/scale.x,48),new THREE.MeshBasicMaterial({map:blurTexture(),transparent:true,depthWrite:false,side:THREE.DoubleSide,opacity:0}));
 disc.name='Propeller blur';disc.userData.vehiclePart='propeller-blur';disc.renderOrder=2;disc.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),axis);disc.visible=false;parent.add(disc);
 // The pivot carries no rotation of its own, so its frame and the parent's agree: sit the disc just ahead of the blades.
 disc.position.copy(pivot.position).addScaledVector(axis,.02/scale.x);
 return {pivot,axis,blades,disc,radius};
}
/* Revolutions per second at full power. A real Corsair's prop turns ~2 400 rpm. */
const MAX_REV=38;
export class PlaneVisual {
 constructor(vehicle,physics,scene,template=null){
  this.vehicle=vehicle;this.physics=physics;this.group=new THREE.Group();this.group.name='Active plane visual';this.group.visible=false;scene.add(this.group);this.disposed=false;this.position=new THREE.Vector3();this.quaternion=new THREE.Quaternion();
  this.spin=0;this.angle=0;this.blurAngle=0;this.q=new THREE.Quaternion();
  this.ready=(template?Promise.resolve(template):loadPlaneModel()).then(source=>{if(this.disposed)return;this.model=source.clone(true);this.group.add(this.model);this.rig=rigPropeller(this.model);this.propeller=this.rig?.pivot??null;return this;});
 }
 /** power: 0 engine off … 1 flat out. Revs follow it with spool-up inertia. */
 update(dt,alpha,active,power=active?.7:0){
  this.group.visible=active;if(!active){this.spin=0;return;}
  this.physics.sample(this.vehicle.chassis.physical,alpha,this.position,this.quaternion);this.group.position.copy(this.position);this.group.quaternion.copy(this.quaternion);
  const rig=this.rig;if(!rig)return;
  this.spin=THREE.MathUtils.damp(this.spin,power*MAX_REV,power>this.spin/MAX_REV?2.2:1.2,dt);
  this.revolutions=(this.revolutions??0)+this.spin*dt;this.angle=(this.angle+this.spin*Math.PI*2*dt)%(Math.PI*2);rig.pivot.quaternion.setFromAxisAngle(rig.axis,this.angle);
  // Three blades repeat every 120°, so past ~6 rev/s a 60 Hz frame can no longer
  // show which way they turn. The blades hand over to the blur well before that.
  const blur=THREE.MathUtils.smoothstep(this.spin,2.5,6.5);
  for(const blade of rig.blades){const o=1-blur;blade.visible=o>.02;blade.material.opacity=o;blade.material.transparent=o<1;}
  rig.disc.visible=blur>.02;rig.disc.material.opacity=blur;
  this.blurAngle=(this.blurAngle+dt*2.4)%(Math.PI*2);rig.disc.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),rig.axis).multiply(this.q.setFromAxisAngle(new THREE.Vector3(0,0,1),-this.blurAngle));
 }
 dispose(){this.disposed=true;this.group.removeFromParent();this.rig?.disc.geometry.dispose();this.rig?.disc.material.map?.dispose();this.rig?.disc.material.dispose();this.rig?.blades.forEach(b=>b.material.dispose());}
}
