import * as THREE from 'three';
import {VisualVehicle} from './VisualVehicle.js';
import {Materials} from './materials.js';
import {Events} from './Events.js';
import {loadPlaneModel} from './plane-visual.js';
export function playerCarTemplate(){
 const events=new Events(),bin={add(){},object3D(){}},vehicle={events,wheels:{items:[{x:.9,z:.75},{x:.9,z:-.75},{x:-.9,z:.75},{x:-.9,z:-.75}].map(p=>({basePosition:new THREE.Vector3(p.x,0,p.z)}))}};
 const visual=new VisualVehicle(vehicle,{events}, {isActive:()=>false}, {},{events},new Materials(bin),bin,true);
 const root=new THREE.Group();root.name='Player Car';root.userData={category:'Vehicles',assetId:'vehicle-player-car',playerVehicle:'car',collision:true,physics_mode:'STATIC',vehicleColor:'#e86738'};
 const car=visual.chassis;car.position.y=1.1;car.userData.vehicleTemplateRestPosition=[0,1.1,0];for(const wheel of visual.wheels)wheel.container.position.y=-.7;
 car.traverse(n=>{if(n.isMesh){n.userData={...n.userData,collision:n.name==='Painted body'||n.name==='Painted roof'||n.name==='Window frame'||/^Tyre \d+$/.test(n.name),editable:true};}});root.add(car);return root;
}
export async function vehicleLibraryEntries(){
 const car=playerCarTemplate(),plane=(await loadPlaneModel()).clone(true);
 return [{id:'vehicle-player-car',name:'Player Car',label:'Player Car',category:'Vehicles',node:car,source:'HelloWorld / Portfolio-derived visual chassis',tags:['vehicle','car','player','paint']},{id:'vehicle-corsair',name:'Corsair Plane',label:'Corsair Plane',category:'Vehicles',node:plane,source:'User-supplied Corsair GLB',tags:['vehicle','plane','flight','player']}];
}
