import * as THREE from 'three';
import {root,cylinder,torus,cable,sphere,mat} from './kit.js';

/** A hollow, tiered plaza fountain. Water and ornament never block the car. */
export function fountain(){
 const g=root('Circular Fountain','Water',{tags:['fountain','plaza','water','animated']});
 g.userData.fountainDesign=2;
 const stone=new THREE.MeshStandardMaterial({color:0xdcd6c5,roughness:.72});
 const ivory=new THREE.MeshStandardMaterial({color:0xf1e8d6,roughness:.58});
 const bronze=new THREE.MeshStandardMaterial({color:0x987544,metalness:.68,roughness:.3});
 const water=new THREE.MeshStandardMaterial({color:0x39bac9,roughness:.14,metalness:.1,transparent:true,opacity:.8});
 const spray=new THREE.MeshStandardMaterial({color:0xa1eff2,roughness:.1,transparent:true,opacity:.77,emissive:0x409299,emissiveIntensity:.12});
 const lathe=(name,profile,material,solid=true)=>{
  const mesh=new THREE.Mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),64),material);
  mesh.name=name;mesh.castShadow=solid;mesh.receiveShadow=true;mesh.userData.collision=solid;g.add(mesh);return mesh;
 };
 cylinder(g,'Circular limestone foundation',[0,.1,0],3.8,.2,stone,3.8,64);
 cylinder(g,'Raised bevelled plinth',[0,.25,0],3.57,.18,ivory,3.45,64);
 cylinder(g,'Basin floor',[0,.36,0],3.22,.12,stone,3.22,64);
 lathe('Carved basin wall',[[3.04,.35],[3.38,.35],[3.43,.5],[3.43,.76],[3.34,.89],[3.05,.89],[2.97,.77],[2.97,.51],[3.04,.35]],ivory);
 torus(g,'Bronze outer inlay',[0,.5,0],3.435,.025,bronze);
 torus(g,'Rounded basin coping',[0,.85,0],3.19,.17,ivory);
 // Alternating tesserae are a single editable mesh for each colour.
 for(const [kind,color]of [['Turquoise',0x238a99],['Ivory',0xd9e2da]]){
  const positions=[],indices=[];
  for(let i=0;i<48;i++){
   if(i%2!==(kind==='Turquoise'?0:1))continue;
   const a=i*Math.PI/24+.008,b=(i+1)*Math.PI/24-.008,offset=positions.length/3;
   for(const [r,angle]of [[2.74,a],[2.94,a],[2.94,b],[2.74,b]])positions.push(Math.cos(angle)*r,.43,Math.sin(angle)*r);
   indices.push(offset,offset+2,offset+1,offset,offset+3,offset+2);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mosaic=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.38}));mosaic.name=kind+' mosaic ring';mosaic.userData.collision=false;g.add(mosaic);
 }
 cylinder(g,'Turquoise basin water',[0,.57,0],2.99,.022,water,2.99,64,false);
 lathe('Sculpted central pedestal',[[0,.39],[.76,.39],[.76,.52],[.59,.64],[.47,.75],[.31,1.05],[.3,1.55],[.5,1.72],[0,1.72]],stone);
 torus(g,'Pedestal bronze collar',[0,.7,0],.46,.045,bronze);
 lathe('Scalloped upper bowl',[[0,1.67],[.46,1.67],[.88,1.77],[1.32,1.95],[1.52,2.13],[1.54,2.24],[1.47,2.29],[1.39,2.16],[.76,1.91],[.2,1.83],[0,1.83]],ivory);
 torus(g,'Upper bowl bronze lip',[0,2.24,0],1.505,.038,bronze);
 cylinder(g,'Upper pool',[0,2.19,0],1.40,.018,water,1.40,64,false);
 lathe('Crown pedestal',[[0,1.83],[.25,1.83],[.28,2.27],[.18,2.45],[.15,2.70],[0,2.75]],stone);
 sphere(g,'Bronze crown',[0,2.78,0],.19,bronze);
 const crown=cable(g,'Crown water plume',[[0,2.84,0],[0,3.36,0],[.08,3.51,0],[.2,3.3,0],[.32,2.21,0]],.034,spray);
 crown.userData.animation={kind:'pulse',axis:'y',speed:2.1,amplitude:.013};
 for(let i=0;i<8;i++){
  const a=i*Math.PI/4,c=Math.cos(a),s=Math.sin(a);
  sphere(g,'Bronze spillway '+(i+1),[c*1.49,2.19,s*1.49],[.085,.055,.085],bronze);
  const jet=cable(g,'Cascading stream '+(i+1),[[c*1.49,2.20,s*1.49],[c*1.75,2.05,s*1.75],[c*2.03,1.47,s*2.03],[c*2.16,.58,s*2.16]],.036,spray);
  jet.userData.animation={kind:'pulse',axis:'y',speed:1.65+i*.08,amplitude:.008};
  for(const r of [.13,.24]){
   const ripple=torus(g,'Splash ripple '+(i+1)+' '+r,[c*2.16,.593,s*2.16],r,.012,spray);
   ripple.userData.animation={kind:'pulse',axis:'x',speed:1.7+i*.08,amplitude:.07};
  }
  if(i%2===0){
   const light=new THREE.PointLight(0x69d6de,1.1,3.5,2);light.name='Underwater light '+(i/2+1);light.position.set(c*2.6,.65,s*2.6);light.visible=false;light.userData={collision:false,nightReady:true,nighttime:true};g.add(light);
   const lens=sphere(g,'Underwater lamp lens '+(i/2+1),[c*2.6,.45,s*2.6],[.13,.025,.13],mat('glass'));lens.userData.collision=false;
  }
 }
 return g;
}
