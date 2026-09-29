import * as THREE from 'three';
export function makeCar(){
 const group=new THREE.Group();group.name='Alejandro / AN roadster';
 const cream=new THREE.MeshStandardMaterial({color:0xeee4d3,roughness:.55}),black=new THREE.MeshStandardMaterial({color:0x182b31,roughness:.7}),red=new THREE.MeshStandardMaterial({color:0xdd5538,roughness:.6}),glass=new THREE.MeshStandardMaterial({color:0x5d8993,metalness:.3,roughness:.2});
 function box(size,pos,mat){const o=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);o.position.set(...pos);o.castShadow=true;group.add(o);return o;}
 box([2.56,.66,1.6],[0,-.08,0],cream);box([2.6,.18,1.68],[0,-.39,0],black);box([1.05,.32,1.32],[-.15,.41,0],glass);box([1.12,.07,1.36],[-.15,.62,0],cream);box([2.3,.035,.16],[0,.26,0],red);box([.05,.13,1.18],[1.30,.01,0],cream);box([.05,.12,1.12],[-1.30,.01,0],red);
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;let c=canvas.getContext('2d');c.fillStyle='#efe8d5';c.fillRect(0,0,128,64);c.fillStyle='#1c3235';c.font='bold 40px sans-serif';c.textAlign='center';c.fillText('AN',64,47);const plateMat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas)});
 for(const sign of [-1,1]){const p=new THREE.Mesh(new THREE.PlaneGeometry(.48,.24),plateMat);p.position.set(0,.01,sign*.811);p.rotation.y=sign<0?Math.PI:0;group.add(p);}
 const wheels=[];
 for(let i=0;i<4;i++){const pivot=new THREE.Group();const tire=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,.32,16),black);tire.rotation.x=Math.PI/2;pivot.add(tire);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.335,10),cream);hub.rotation.x=Math.PI/2;pivot.add(hub);group.add(pivot);wheels.push(pivot);}
 return {group,update(vehicle,alpha){const p=vehicle.chassis.physical;group.position.lerpVectors(p.previous.position,p.current.position,alpha);group.quaternion.slerpQuaternions(p.previous.quaternion,p.current.quaternion,alpha);wheels.forEach((o,i)=>{const w=vehicle.wheels.items[i];o.position.copy(w.basePosition);o.position.y-=Math.max(.3,w.suspensionLength);o.rotation.y=i<2?vehicle.input.steering*vehicle.steeringAmplitude:0;});}};
}
