import {test} from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import {createTerrainQuery,getTerrainQuery,invalidateTerrainQuery} from '../../public/archipelago/preview/terrain-query.js';

/* The terrain query keeps its triangles in one Float64Array (ten numbers each) instead of a ten-element array per triangle: a few hundred
   thousand small objects that the collector carried for as long as the query lived, and the biggest single share of the heap the start of /world
   peaked at on a throttled phone. It must answer exactly what it answered before, so the previous implementation is kept here as the oracle. */
function oracle(root,{cellSize=4}={}){
 const EPS=1e-7,bins=new Map(),triangles=[],meshes=[];
 const terrainNode=o=>o.isMesh&&(o.userData.terrain||o.userData.landTile||o.userData.mapTerrainGenerated)&&!o.userData.waterObject&&!o.userData.sea;
 const active=o=>{if(!terrainNode(o))return false;for(let p=o;p;p=p.parent)if(!p.visible||p.userData.deleted||p.userData.editorOnly)return false;return !!o.geometry?.attributes.position;};
 root.updateWorldMatrix(true,true);root.traverse(o=>{if(active(o))meshes.push(o);});
 const vector=new THREE.Vector3();
 for(const mesh of meshes){
  const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index?.array,count=index?.length??position.count,world=mesh.matrixWorld;
  for(let i=0;i<count;i+=3){
   const points=[0,1,2].map(k=>vector.fromBufferAttribute(position,index?index[i+k]:i+k).applyMatrix4(world).toArray());
   const [a,b,c]=points,dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dx2*dz1;
   if(Math.abs(det)<1e-12)continue;
   const triangle=[a[0],a[1],a[2],dx1,b[1]-a[1],dz1,dx2,c[1]-a[1],dz2,1/det],id=triangles.length;triangles.push(triangle);
   const minX=Math.min(a[0],b[0],c[0]),maxX=Math.max(a[0],b[0],c[0]),minZ=Math.min(a[2],b[2],c[2]),maxZ=Math.max(a[2],b[2],c[2]);
   for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++){
    const key=x+':'+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(id);
   }
  }
 }
 return {
  stats:{triangles:triangles.length,bins:bins.size},
  heightAt(x,z,{minHeight=-Infinity,maxHeight=Infinity,fallback=null}={}){
   if(!Number.isFinite(x)||!Number.isFinite(z))return fallback;
   let best=-Infinity;
   for(const id of bins.get(Math.floor(x/cellSize)+':'+Math.floor(z/cellSize))??[]){
    const t=triangles[id],px=x-t[0],pz=z-t[2],u=(t[8]*px-t[6]*pz)*t[9],v=(t[3]*pz-t[5]*px)*t[9];
    if(u<-EPS||v<-EPS||u+v>1+EPS)continue;
    const y=t[1]+u*t[4]+v*t[7];if(y>minHeight&&y<=maxHeight&&y>best)best=y;
   }
   return best===-Infinity?fallback:best;
  },
 };
}
const random=seed=>()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};

/** An uneven grid under a moved, turned and scaled parent, a second mesh without an index, one hidden terrain, one that is water, and a flat sliver. */
function world(){
 const rnd=random(7),root=new THREE.Group(),land=new THREE.Group();land.position.set(13.5,-0.4,-27.25);land.rotation.y=0.61;land.scale.set(1.3,1,0.9);root.add(land);
 const n=40,step=3.1,positions=[],index=[];
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)positions.push((i-n/2)*step,Math.sin(i*.37)*2+Math.cos(j*.23)*1.5+rnd()*.6,(j-n/2)*step);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+1,c=a+n+1,d=c+1;if((i+j)%2)index.push(a,c,b,b,c,d);else index.push(a,c,d,a,d,b);}
 const grid=new THREE.BufferGeometry();grid.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));grid.setIndex(index);
 const terrain=new THREE.Mesh(grid,new THREE.MeshBasicMaterial());terrain.userData.terrain=true;land.add(terrain);
 const loose=new THREE.BufferGeometry();loose.setAttribute('position',new THREE.Float32BufferAttribute([0,3,0,12,4,0,0,5,12,12,2,0,12,3,12,0,6,12,-30,1,-30,-18,2,-30,-30,1,-18],3));
 const patch=new THREE.Mesh(loose,new THREE.MeshBasicMaterial());patch.userData.landTile=true;patch.position.set(-20,0.5,8);root.add(patch);
 const hidden=new THREE.Mesh(grid.clone(),new THREE.MeshBasicMaterial());hidden.userData.terrain=true;hidden.visible=false;hidden.position.y=40;root.add(hidden);
 const sea=new THREE.Mesh(grid.clone(),new THREE.MeshBasicMaterial());sea.userData.terrain=true;sea.userData.sea=true;sea.position.y=-30;root.add(sea);
 const sliver=new THREE.BufferGeometry();sliver.setAttribute('position',new THREE.Float32BufferAttribute([0,9,0,5,9,0,10,9,0],3));
 const flat=new THREE.Mesh(sliver,new THREE.MeshBasicMaterial());flat.userData.terrain=true;root.add(flat);
 return {root,terrain};
}

test('the Float64Array query answers exactly what the array-per-triangle query answered, with and without options',()=>{
 const {root}=world(),old=oracle(root),query=createTerrainQuery(root);
 assert.equal(query.stats.triangles,old.stats.triangles,'the same triangles are kept (hidden, water and zero-area ones left out)');
 assert.equal(query.stats.bins,old.stats.bins);
 assert.ok(query.stats.triangles>3000);
 const options=[undefined,{fallback:-99},{minHeight:-.5,maxHeight:3},{minHeight:-2,maxHeight:1.5,fallback:0}],rnd=random(99);
 let hits=0,misses=0,n=0;
 for(let k=0;k<20000;k++){
  const x=(rnd()-.5)*220,z=(rnd()-.5)*220,o=options[n++%options.length],a=old.heightAt(x,z,o),b=query.heightAt(x,z,o);
  assert.ok(Object.is(a,b),`height at ${x},${z}: ${a} vs ${b}`);
  if(a===null||a===(o?.fallback))misses++;else hits++;
 }
 assert.ok(hits>3000&&misses>3000,`the sample covers land and sea (${hits} hits, ${misses} misses)`);
 for(const [x,z] of [[NaN,0],[0,Infinity],[1e9,1e9],[-1e9,3]])assert.ok(Object.is(old.heightAt(x,z),query.heightAt(x,z)),'out of range and non-finite queries are the same');
 assert.equal(query.stats.queries,20004,'the statistics still count queries');
});

test('the triangles are not hundreds of thousands of small arrays: the new query keeps a fraction of the heap the old one kept',()=>{
 v8.setFlagsFromString('--expose-gc');const gc=vm.runInNewContext('gc');
 const {root}=world(),retained=build=>{gc();gc();const before=process.memoryUsage().heapUsed,kept=build();gc();gc();const bytes=process.memoryUsage().heapUsed-before;assert.ok(kept);return bytes;};
 retained(()=>oracle(root));retained(()=>createTerrainQuery(root));
 // Heap deltas move with whatever else the process (and a busy machine) allocates in between: judge the best of three attempts,
 // a real regression (an array per triangle again) fails every one of them.
 let old=0,now=Infinity;
 for(let attempt=0;attempt<3;attempt++){
  old=Math.min(...[1,2,3,4,5].map(()=>retained(()=>oracle(root))));now=Math.min(...[1,2,3,4,5].map(()=>retained(()=>createTerrainQuery(root))));
  if(old>400e3&&now<old*.45)break;
 }
 assert.ok(old>400e3,`the old layout keeps a measurable amount (${old} bytes)`);
 assert.ok(now<old*.45,`the new one keeps ${now} bytes of JS heap against ${old}`);
});

test('the cached query still notices a change of the terrain',()=>{
 const {root,terrain}=world();
 const first=getTerrainQuery(root);assert.equal(getTerrainQuery(root),first,'unchanged terrain keeps the query');
 const position=terrain.geometry.attributes.position;position.setY(0,position.getY(0)+5);position.needsUpdate=true;
 const second=getTerrainQuery(root);assert.notEqual(second,first,'a changed position buffer builds a new query');
 root.children[0].position.x+=1;assert.notEqual(getTerrainQuery(root),second,'and so does a moved parent');
 invalidateTerrainQuery(root);assert.ok(getTerrainQuery(root).isCurrent());
});
