import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {terrainDebugData,fixed6} from '../../public/archipelago/preview/map-terrain-shore.js';
import {terrainDebugData as oracleData} from './fixtures/terrain-shore-oracle.js';

/* The shoreline of the terrain (map-terrain-shore.js) is derived from every terrain triangle: 136 000 of them in the world. It used to keep a JS array per
   point, polygon, bound, height and edge, about 90 MB promoted to the old space in the middle of the start of /world, and now keeps them in typed arrays.
   Every number it derives has to be the one it derived before, to the last bit, so the previous implementation is kept in fixtures/ as the oracle and both
   run on terrain made to hit the awkward cases: triangles cut by the sea, exactly at the sea, overlapping sources, holes, T-junctions, rotated and scaled
   meshes, indexed and not. */

function random(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

/** A heightfield of nx by nz cells, two triangles each, with some cells left out (holes) and some corners flattened to exactly the sea. */
function grid(rand,{nx,nz,step,sea,hole=.04,flat=.1,indexed=true,amp=2,y0=0}){
 const positions=[];
 for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
  const y=rand()<flat?sea:sea+(rand()-.5)*amp+y0;
  positions.push(i*step,Math.fround(y),j*step);
 }
 const at=(i,j)=>j*(nx+1)+i,indices=[];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  if(rand()<hole)continue;
  if((i+j)%2)indices.push(at(i,j),at(i,j+1),at(i+1,j),at(i+1,j),at(i,j+1),at(i+1,j+1));
  else indices.push(at(i,j),at(i,j+1),at(i+1,j+1),at(i,j),at(i+1,j+1),at(i+1,j));
 }
 const geometry=new THREE.BufferGeometry();
 if(indexed){geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);}
 else{const flatPositions=[];for(const k of indices)flatPositions.push(positions[k*3],positions[k*3+1],positions[k*3+2]);geometry.setAttribute('position',new THREE.Float32BufferAttribute(flatPositions,3));}
 return geometry;
}

function scene(seed,{sea=-.35,sources=[{}]}={}){
 const rand=random(seed),root=new THREE.Group();root.userData={seaLevel:sea};
 sources.forEach((spec,n)=>{
  const mesh=new THREE.Mesh(grid(rand,{nx:14,nz:12,step:2,sea,...spec}),new THREE.MeshBasicMaterial());
  mesh.userData={terrain:true};mesh.name='source '+n;
  if(spec.at)mesh.position.set(...spec.at);
  if(spec.turn)mesh.rotation.y=spec.turn;
  if(spec.size)mesh.scale.set(...spec.size);
  root.add(mesh);
 });
 return root;
}

/** Same structure, same numbers (Object.is: a -0 or a NaN is a difference too). */
function same(a,b,path='data'){
 if(typeof a==='number'||typeof b==='number'){assert.ok(Object.is(a,b),`${path}: ${a} vs ${b}`);return;}
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){assert.equal(a,b,path);return;}
 assert.equal(Array.isArray(a),Array.isArray(b),path+' (array)');
 const ka=Object.keys(a),kb=Object.keys(b);assert.deepEqual(ka,kb,path+' (keys)');
 for(const k of ka)same(a[k],b[k],path+'.'+k);
}

const compare=(root)=>{
 const lean=terrainDebugData(root),old=oracleData(root);
 same(lean,old);
 return lean;
};

test('a single heightfield: the same shoreline, contours, holes, heights and counts as the object version',()=>{
 const data=compare(scene(1));
 assert.ok(data.counts.triangles>200&&data.boundary.length>10,'the scene has a coast to compare');
});

test('many seeds, with the sea cutting the triangles at different levels and some exactly on the sea',()=>{
 for(let seed=2;seed<26;seed++){
  const sea=[-.35,0,.7,-1.2][seed%4],root=scene(seed,{sea,sources:[{amp:1+seed%3}]});
  compare(root);
 }
});

test('overlapping terrain sources, rotated, scaled and not indexed, are cut at each other\'s edges the same way',()=>{
 for(let seed=30;seed<46;seed++){
  const root=scene(seed,{sources:[{},{at:[7,0,5],turn:.3+seed*.01,size:[1.1,1,.9]},{at:[-6,.4,11],indexed:false,hole:.1},{at:[14,-.3,-4],turn:-.7,size:[.6,1.5,.6],nx:8}]});
  compare(root);
 }
});

test('the second call is the cache, and an edit to a mesh gives the new data',()=>{
 const root=scene(77,{sources:[{},{at:[5,0,5]}]}),first=terrainDebugData(root);
 assert.equal(terrainDebugData(root),first,'unchanged terrain returns the cached data');
 const mesh=root.children[0],position=mesh.geometry.attributes.position;
 position.setY(20,5);position.needsUpdate=true;
 const second=terrainDebugData(root);
 assert.notEqual(second,first);
 same(second,oracleData(root));
});

test('no terrain, a mesh of one degenerate triangle, and terrain wholly under or over the sea',()=>{
 const empty=new THREE.Group();empty.userData={seaLevel:0};
 same(terrainDebugData(empty),oracleData(empty));
 const flat=new THREE.Group();flat.userData={seaLevel:0};
 const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
 const degenerate=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());degenerate.userData={terrain:true};flat.add(degenerate);
 same(terrainDebugData(flat),oracleData(flat));
 for(const sea of [-50,50])compare(scene(5,{sea}));
});

test('a tile (landTile) counts as terrain, a deleted or hidden one does not',()=>{
 const root=scene(9,{sources:[{},{at:[3,0,3]},{at:[-9,0,2]}]});
 root.children[0].userData={landTile:'a'};
 root.children[1].userData={terrain:true,deleted:true};
 root.children[2].visible=false;
 const data=compare(root);
 assert.ok(data.counts.triangles>0);
});

test('a terrain of ~80 000 triangles, which grows the table of lines twice, is the same',()=>{
 const root=new THREE.Group();root.userData={seaLevel:-.35};
 const rand=random(5),mesh=new THREE.Mesh(grid(rand,{nx:200,nz:200,step:2,sea:-.35,amp:3,hole:.01}),new THREE.MeshBasicMaterial());mesh.userData={terrain:true};root.add(mesh);
 const data=compare(root);
 assert.ok(data.counts.triangles>75000);
});

test('lines too far from the origin for six decimals to be an integer (and a mesh far away) group by their text and come out the same',()=>{
 for(const [seed,at] of [[11,[3e6,0,5e6]],[12,[-8e8,1,2e9]],[13,[1e4,0,-1e4]]]){
  const root=scene(seed,{sources:[{at},{at:[at[0]+5,0,at[2]+3],turn:.2}]});
  compare(root);
 }
});

test('the key of a number is the same for two numbers exactly when their toFixed(6) texts are the same',()=>{
 const rand=random(3);let checked=0;
 const pair=(x,y)=>{const a=fixed6(x),b=fixed6(y);if(Number.isNaN(a)||Number.isNaN(b))return;checked++;assert.equal(a===b,x.toFixed(6)===y.toFixed(6),`${x} ${y}`);};
 for(let i=0;i<60000;i++){
  const x=(rand()*2-1)*[1,1,1e-3,1e3][i&3],n=Math.floor(rand()*2e9)-1e9,tie=(n+.5)/1e6;
  pair(x,x);pair(x,x+(rand()-.5)*2e-6);pair(x,-x);
  pair(tie,tie*(1+2.2e-16));pair(tie,tie*(1-2.2e-16));pair(tie,(n+1)/1e6);pair(tie,n/1e6);
  pair(0,-1e-9);pair(-1e-9,-4e-7);pair(4.9999999e-7,5.0000001e-7);pair(-0,0);
 }
 assert.ok(checked>500000);
 for(const big of [Infinity,-Infinity,NaN,2.2e3,1e9,-3e12])assert.ok(Number.isNaN(fixed6(big)),'too big or not finite: the caller uses the text '+big);
});
