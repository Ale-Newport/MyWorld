import * as THREE from 'three';
export const SLABS_SOURCE=Object.freeze({material:'terrain',node:'Mix.005',positionMultiply:.20000000298023224,roughness:.5,metalness:0,normalMap:null,sourceSHA256:'ae96f33015f45b7f1414f3c338c006e13263ac9b43ccf6efe58ec46734558126',albedoSHA256:'7667c54ca3dbb39be5884c19096c324e0c3eeedb2d032992005313916908e996',linearColors:[[.39157015085220337,.18447518348693848,.1221388429403305],[1,.6239606738090515,.25818297266960144]]});
export const materialChoices=['Slabs','Stone','Dirt','Wood','Sand','Concrete'];
const specs={Slabs:{color:0xffffff,roughness:.5,texture:'slabs-albedo.png'},Stone:{color:0xc6c8be,roughness:.9,texture:'slabs.png'},Dirt:{color:0x92714e,roughness:1},Wood:{color:0xa78a62,roughness:.82,wood:true},Sand:{color:0xdac796,roughness:1},Concrete:{color:0xbbbab0,roughness:.94},Grass:{color:0x86ad5f,roughness:1},Rock:{color:0x929994,roughness:.98},Snow:{color:0xe9f1ec,roughness:.9}};
const materials=new Map(),pending=[];
function texture(file){
 const path='assets/surfaces/world2/'+file;let map;
 if(typeof document!=='undefined'&&typeof document.createElementNS==='function'){
  let resolve,reject;pending.push(new Promise((yes,no)=>{resolve=yes;reject=no}));
  map=new THREE.TextureLoader().load(new URL('../'+path,import.meta.url).href,resolve,undefined,reject);
 }else map=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 map.name=file;map.userData.sourceResource=path;map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;return map;
}
function woodGrain(){const w=64,h=64,data=new Uint8Array(w*h*4);for(let z=0;z<h;z++)for(let x=0;x<w;x++){const seam=x%16===0,grain=Math.sin(z*.28+Math.sin(x*.9)*1.3)*.03+Math.sin(z*.91+x*2.1)*.018,value=seam?.41:.88+grain,i=(z*w+x)*4;data[i]=data[i+1]=data[i+2]=Math.round(value*255);data[i+3]=255;}const map=new THREE.DataTexture(data,w,h);map.name='Wood board grain';map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.magFilter=THREE.LinearFilter;map.needsUpdate=true;return map;}
export function surfaceMaterial(id='Slabs'){
 const name=Object.keys(specs).find(key=>key.toLowerCase()===String(id).toLowerCase());if(!name)throw Error('Unknown surface material: '+id);
 if(!materials.has(name)){const spec=specs[name],material=new THREE.MeshStandardMaterial({color:spec.color,roughness:spec.roughness,metalness:0,side:THREE.DoubleSide,map:spec.texture?texture(spec.texture):spec.wood?woodGrain():null});material.name='Ground_'+name;material.userData={surfaceMaterial:name,worldTiling:true,tileMetres:1/SLABS_SOURCE.positionMultiply,...(name==='Slabs'?{sourceShader:'Portfolio /world2 terrain / Mix.005',sourceTexture:'assets/surfaces/world2/slabs.png',sourceSHA256:SLABS_SOURCE.sourceSHA256}:{} )};materials.set(name,material);}return materials.get(name);
}
/** Blender world XY becomes Three world X,-Z. UV density includes the exact
 * source multiplier; texture repeat remains 1 so resize never stretches tiles. */
export function surfaceUV(x,z,id='Slabs'){return [x*SLABS_SOURCE.positionMultiply,-z*SLABS_SOURCE.positionMultiply];}
export async function surfaceMaterialsReady(){await Promise.all(pending);}
