import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
let pending;
export function preparePlaneModel(scene){
  const root=new THREE.Group();root.name='Corsair Plane';root.userData={assetId:'vehicle-corsair',category:'Vehicles',playerVehicle:'plane',source:'User supplied Corsair GLB',collision:true,physics_mode:'STATIC'};
  const model=scene;model.name='Airframe';model.rotation.y=-Math.PI/2;model.scale.setScalar(.42);model.position.y=-.5;
  const prop=model.getObjectByName('Cube.004');if(prop){prop.name='Propeller';prop.userData.vehiclePart='propeller';const box=new THREE.Box3().setFromObject(prop),centre=box.getCenter(new THREE.Vector3());prop.worldToLocal(centre);for(const child of prop.children)child.position.sub(centre);if(prop.isMesh)prop.geometry.translate(-centre.x,-centre.y,-centre.z);prop.position.add(centre);}
  model.traverse(node=>{if(node.name==='Cube.007')node.name='Fuselage and wings';if(node.isMesh){node.castShadow=true;node.receiveShadow=true;node.userData={...node.userData,collision:false,editable:true};}});
  model.getObjectByName('Fuselage and wings')?.traverse(node=>{if(node.isMesh)node.userData.collision=true;});
  root.add(model);return root;
}
export function loadPlaneModel(){
 if(!pending)pending=new GLTFLoader().loadAsync(new URL('../../assets/vehicles/plane/corsair.glb',import.meta.url).href).then(gltf=>preparePlaneModel(gltf.scene));return pending;
}
export class PlaneVisual {
 constructor(vehicle,physics,scene,template=null){
  this.vehicle=vehicle;this.physics=physics;this.group=new THREE.Group();this.group.name='Active plane visual';this.group.visible=false;scene.add(this.group);this.disposed=false;this.position=new THREE.Vector3();this.quaternion=new THREE.Quaternion();
  this.ready=(template?Promise.resolve(template):loadPlaneModel()).then(source=>{if(this.disposed)return;this.model=source.clone(true);this.group.add(this.model);this.propeller=this.model.getObjectByName('Propeller');this.model.traverse(n=>{if(n.userData.vehiclePart==='propeller')this.propeller=n;});return this;});
 }
 update(dt,alpha,active){this.group.visible=active;if(!active)return;this.physics.sample(this.vehicle.chassis.physical,alpha,this.position,this.quaternion);this.group.position.copy(this.position);this.group.quaternion.copy(this.quaternion);if(this.propeller)this.propeller.rotation.z+=dt*70;}
 dispose(){this.disposed=true;this.group.removeFromParent();}
}
