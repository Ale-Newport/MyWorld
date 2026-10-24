import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {finishOcean,simplifyOcean} from '../../public/archipelago/preview/ocean.js';

/** The sea as main.js builds it: finishOcean on a root with a sea mesh, then (after the coastal tint) simplifyOcean. */
function sea(heightAt=(x,z)=>-7+6.5*Math.exp(-((x+30)**2+(z-20)**2)/4000)){
 const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial());mesh.userData.sea=true;root.add(mesh);
 finishOcean(root,heightAt);return {root,mesh};
}
/** What refreshCoastalWater does to the grid: colours from a terrain that is not the one finishOcean saw (a wider, shallower shelf in the south). */
function retint(mesh,shelf){
 const p=mesh.geometry.attributes.position,c=mesh.geometry.attributes.color,deep=new THREE.Color('#237f9d'),shallow=new THREE.Color('#70c9bc');
 for(let i=0;i<p.count;i++){const depth=Math.max(0,.35-shelf(p.getX(i),p.getZ(i))),k=THREE.MathUtils.smoothstep(depth,.4,3),color=shallow.clone().lerp(deep,k);c.setXYZ(i,color.r,color.g,color.b);}
}
const shelf=(x,z)=>-.35-Math.max(0,Math.min(7,(z-60)*.08+(x<-80?(x+80)*.05:0)))+(Math.hypot(x+30,z-20)<40?3:0);
/** Colour of a geometry at a point of the grid, interpolated over the triangle that holds it. */
function colourAt(g,x,z){
 const p=g.attributes.position,c=g.attributes.color,ix=g.index.array;
 for(let t=0;t<ix.length;t+=3){
  const a=ix[t],b=ix[t+1],d=ix[t+2],ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),dx=p.getX(d),dz=p.getZ(d);
  const det=(bz-dz)*(ax-dx)+(dx-bx)*(az-dz);if(Math.abs(det)<1e-9)continue;
  const l1=((bz-dz)*(x-dx)+(dx-bx)*(z-dz))/det,l2=((dz-az)*(x-dx)+(ax-dx)*(z-dz))/det,l3=1-l1-l2,e=-1e-9;
  if(l1<e||l2<e||l3<e)continue;
  return [0,1,2].map(k=>c.getX(a)*0+[c.getX,c.getY,c.getZ][k].call(c,a)*l1+[c.getX,c.getY,c.getZ][k].call(c,b)*l2+[c.getX,c.getY,c.getZ][k].call(c,d)*l3);
 }
 return null;
}

test('the open sea becomes a few big blocks and the coast keeps its 2 m grid',()=>{
 const {root,mesh}=sea();retint(mesh,shelf);const before=mesh.geometry.index.count/3;
 const done=simplifyOcean(root);assert.equal(done,mesh);
 const after=mesh.geometry.index.count/3;
 assert.ok(before>95000,'full grid is '+before);assert.ok(after<before*.6&&after>2000,'simplified to '+after);
 assert.ok(mesh.geometry.attributes.position.count<before/2*.7,'unused vertices are dropped');
 assert.equal(simplifyOcean(root),null,'a second call finds nothing to do');
});

test('every point of the grid keeps its colour: the merge never changes the sea',()=>{
 const {root,mesh}=sea();retint(mesh,shelf);const full=mesh.geometry.clone();
 simplifyOcean(root);
 let worst=0,checked=0;
 for(let i=0;i<260;i++){
  const x=Math.round(-215+((i*97)%431)),z=Math.round(-215+((i*53+i*i)%431)),a=colourAt(full,x+.37,z-.61),b=colourAt(mesh.geometry,x+.37,z-.61);
  if(!a||!b){assert.ok(!a&&!b,'covered by both or neither');continue;}
  checked++;for(let k=0;k<3;k++)worst=Math.max(worst,Math.abs(a[k]-b[k]));
 }
 assert.ok(checked>200);assert.ok(worst<4e-4,'worst colour error '+worst);
});

test('the surface is watertight and faces one way: no T-junction cracks between a big block and finer ones',()=>{
 const {root,mesh}=sea();retint(mesh,shelf);simplifyOcean(root);
 const g=mesh.geometry,p=g.attributes.position,ix=g.index.array,edges=new Map();
 let up=0,down=0;
 for(let t=0;t<ix.length;t+=3){
  const v=[ix[t],ix[t+1],ix[t+2]];
  const cross=(p.getX(v[1])-p.getX(v[0]))*(p.getZ(v[2])-p.getZ(v[0]))-(p.getX(v[2])-p.getX(v[0]))*(p.getZ(v[1])-p.getZ(v[0]));
  if(cross>1e-9)up++;else if(cross<-1e-9)down++;
  for(let k=0;k<3;k++){const a=v[k],b=v[(k+1)%3],key=a+':'+b;edges.set(key,(edges.get(key)??0)+1);}
 }
 assert.equal(up*down,0,'orientation up '+up+' down '+down);
 let open=0;for(const [key] of edges){const [a,b]=key.split(':');if(!edges.has(b+':'+a)){open++;const ax=p.getX(+a),az=p.getZ(+a),bx=p.getX(+b),bz=p.getZ(+b);assert.ok(Math.max(Math.abs(ax),Math.abs(az))>=1319&&Math.max(Math.abs(bx),Math.abs(bz))>=1319,'an open edge inside the sea: '+[ax,az,bx,bz]);}}
 assert.ok(open>0&&open<=4*220+8,'only the outer rim of the skirt is open: '+open);
 for(const n of edges.values())assert.equal(n,1,'an edge is used by one triangle per direction');
});

test('the sea normals are all flat',()=>{
 const {root,mesh}=sea();retint(mesh,shelf);simplifyOcean(root);const n=mesh.geometry.attributes.normal;
 const sign=Math.sign(n.getY(0));for(let i=0;i<n.count;i++){assert.ok(Math.abs(n.getY(i))>.999&&Math.sign(n.getY(i))===sign);}
});

test('the studio and a mesh that is not the grid are left alone',()=>{
 const root=new THREE.Group();assert.equal(simplifyOcean(root),null);
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial());mesh.userData.sea=true;root.add(mesh);assert.equal(simplifyOcean(root),null);
});
