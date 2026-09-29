import * as THREE from 'three';

// Portfolio/src/world2/World2Grass.ts: identical root/tip colours and wind
// frequencies. Baked vertex colours also preserve the look in GLB exports.
export const GRASS_ROOT='#6f8a1f',GRASS_TIP='#c6d64a';
const time={value:0},installed=new WeakSet();
export function tickMeadowGrass(seconds){time.value=seconds;}
export function restoreMeadowGrass(root){root.traverse(n=>{if(!n.isMesh||!n.userData.meadowGrass)return;for(const material of Array.isArray(n.material)?n.material:[n.material]){
 if(installed.has(material))continue;installed.add(material);
 material.onBeforeCompile=shader=>{shader.uniforms.uGrassTime=time;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float bladeHeight; uniform float uGrassTime;').replace('#include <begin_vertex>',`#include <begin_vertex>
 vec4 grassWorld=modelMatrix*vec4(transformed,1.0);
 float sway=sin(grassWorld.x*.6+uGrassTime*1.1)+sin(grassWorld.z*.45-uGrassTime*.7)*.6;
 float bend=bladeHeight*bladeHeight*.11;
 transformed.x+=sway*bend; transformed.z+=sway*bend*.6;`);};
 material.customProgramCacheKey=()=> 'world2-meadow-wind-v1';material.needsUpdate=true;
 }});}
/** Deterministic fine soil detail, independent of Canvas and external downloads. */
export function groundGrain(){const size=128,data=new Uint8Array(size*size*4);let seed=71437;for(let i=0;i<size*size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=218+(seed>>>27);data.set([v,v,v,255],i*4);}const map=new THREE.DataTexture(data,size,size);map.name='Fine grass and beach grain';map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;return map;}
export function createMeadow(points){const positions=[],colors=[],blades=[],root=new THREE.Color(GRASS_ROOT),tip=new THREE.Color(GRASS_TIP);for(const [x,y,z,seed]of points){const angle=seed*31.37,w=.045+seed*.045,h=.19+seed*.23,dx=Math.cos(angle)*w,dz=Math.sin(angle)*w,tint=.88+seed*.24;positions.push(x-dx,y,z-dz,x+dx,y,z+dz,x+w*.45,y+h,z);colors.push(...root.clone().multiplyScalar(tint).toArray(),...root.clone().multiplyScalar(tint).toArray(),...tip.clone().multiplyScalar(tint).toArray());blades.push(0,0,1);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('bladeHeight',new THREE.Float32BufferAttribute(blades,1));geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.95}));mesh.name='World2 meadow';mesh.receiveShadow=true;mesh.userData={meadowGrass:true,collision:false,category:'Nature',layer:'Nature',editable_root:true,source:'Portfolio /world2 · World2Grass.ts'};restoreMeadowGrass(mesh);return mesh;}
