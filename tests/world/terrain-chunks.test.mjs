import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cellSize,partitionTriangles,boundsOf,chunkable,chunkMesh,disposeChunk} from '../../public/archipelago/preview/runtime/terrain-chunks.js';

/** A rolling 400 x 300 m terrain of about 40,000 triangles with vertex colours. */
function terrain(nx=140,nz=140){
 const g=new THREE.PlaneGeometry(400,300,nx,nz).rotateX(-Math.PI/2),p=g.attributes.position;
 for(let i=0;i<p.count;i++)p.setY(i,Math.sin(p.getX(i)*.05)*Math.cos(p.getZ(i)*.07)*3);
 g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(p.count*3).fill(.5),3));g.computeVertexNormals();return g;
}
const key=(a,i)=>[a[i*3],a[i*3+1],a[i*3+2]].sort((x,y)=>x-y).join(':');

test('the cell grows with the footprint and shrinks with the triangles, within limits',()=>{
 assert.ok(cellSize(400,300,40000)>60&&cellSize(400,300,40000)<110,'about 16 cells of 86 m');
 assert.ok(cellSize(400,300,400000)<cellSize(400,300,40000));assert.equal(cellSize(1,1,10),8);assert.equal(cellSize(1e5,1e5,10),128);
});

test('every triangle is in exactly one piece, and a piece is a few thousand of them',()=>{
 const g=terrain(),total=g.index.count/3,{groups,cell}=partitionTriangles(g);
 assert.equal(groups.reduce((n,x)=>n+x.triangles,0),total);
 const seen=new Set();for(const {index} of groups)for(let t=0;t<index.length/3;t++){const k=key(index,t);assert.ok(!seen.has(k),'a triangle twice');seen.add(k);}
 const original=new Set();for(let t=0;t<total;t++)original.add(key(g.index.array,t));
 assert.equal(seen.size,original.size);for(const k of original)assert.ok(seen.has(k));
 assert.ok(groups.length>=10&&groups.length<=40,'pieces: '+groups.length+' of cell '+cell.toFixed(0));
 assert.ok(Math.max(...groups.map(x=>x.triangles))<9000,'no piece is the whole');
 assert.equal(groups[0].index.constructor,g.index.array.constructor);
});

test('a piece\'s bounds hold exactly the vertices its triangles use',()=>{
 const g=terrain(60,60),{groups}=partitionTriangles(g,{target:600});
 for(const {index} of groups){
  const {sphere,box}=boundsOf(g.attributes.position,index),v=new THREE.Vector3();
  for(let i=0;i<index.length;i++){v.fromBufferAttribute(g.attributes.position,index[i]);assert.ok(box.containsPoint(v));assert.ok(sphere.center.distanceTo(v)<=sphere.radius+1e-6);}
 }
 g.computeBoundingSphere();assert.ok(groups.every(({index})=>boundsOf(g.attributes.position,index).sphere.radius<g.boundingSphere.radius/2),'each is much smaller than the whole');
});

test('the pieces share the mesh\'s attribute buffers, carry its material and matrix, and the source draws nothing until restored',()=>{
 const source=new THREE.Mesh(terrain(),new THREE.MeshStandardMaterial({vertexColors:true}));source.name='Coast';source.receiveShadow=true;source.userData.terrain=true;
 source.position.set(5,0,-3);source.updateMatrixWorld(true);
 assert.equal(chunkable(source),true);
 const {meshes,restore}=chunkMesh(source);
 assert.ok(meshes.length>=10);
 for(const m of meshes){
  assert.equal(m.geometry.attributes.position,source.geometry.attributes.position,'one vertex buffer');assert.equal(m.geometry.attributes.color,source.geometry.attributes.color);
  assert.equal(m.material,source.material);assert.equal(m.receiveShadow,true);assert.equal(m.castShadow,false);assert.equal(m.userData.terrainChunk,true);assert.equal(m.userData.terrain,undefined,'not a terrain node for any query');
  assert.deepEqual(m.matrixWorld.elements,source.matrixWorld.elements);assert.ok(Math.abs(m.position.x-5)<1e-9);
  assert.ok(m.frustumCulled);assert.ok(m.geometry.boundingSphere.radius<80);
 }
 assert.deepEqual(source.geometry.drawRange,{start:0,count:0});assert.equal(source.visible,true,'still there for every query');assert.equal(source.userData.terrain,true);
 // the camera sees a few of them
 const camera=new THREE.PerspectiveCamera(25,1.6,.5,200);camera.position.set(25,25,25);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const seen=meshes.filter(m=>frustum.intersectsObject(m));assert.ok(seen.length>0&&seen.length<meshes.length/2,'in view: '+seen.length+' of '+meshes.length);
 const drawn=seen.reduce((n,m)=>n+m.userData.triangles,0);assert.ok(drawn<source.geometry.index.count/3/2,'half of the triangles at most: '+drawn);
 // a ray cast at the source still finds the ground (Mesh.raycast would read the draw range of zero), and leaves the range as it was
 const ray=new THREE.Raycaster(new THREE.Vector3(20,50,10),new THREE.Vector3(0,-1,0)),hits=ray.intersectObject(source);
 assert.equal(hits.length,1,'the ground is hit');assert.ok(Math.abs(hits[0].point.y-Math.sin((20-5)*.05)*Math.cos((10+3)*.07)*3)<.2,'at its height: '+hits[0].point.y);
 assert.deepEqual(source.geometry.drawRange,{start:0,count:0},'still drawing nothing');
 restore();assert.equal(source.geometry.drawRange.count,Infinity);assert.ok(!Object.hasOwn(source,'raycast'),'the ordinary raycast is back');
 assert.equal(ray.intersectObject(source).length,1);
 // freeing a piece frees its index only
 const piece=meshes[0],attributes=piece.geometry.attributes;disposeChunk(piece);assert.equal(piece.geometry.attributes,attributes);
});

test('what is not worth splitting is left alone',()=>{
 const small=new THREE.Mesh(new THREE.PlaneGeometry(400,300,20,20).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial());small.updateMatrixWorld(true);assert.equal(chunkable(small),false,'few triangles');
 const tiny=new THREE.Mesh(new THREE.PlaneGeometry(10,10,200,200),new THREE.MeshBasicMaterial());tiny.updateMatrixWorld(true);assert.equal(chunkable(tiny),false,'little ground');
 const unindexed=new THREE.Mesh(terrain().toNonIndexed(),new THREE.MeshBasicMaterial());unindexed.updateMatrixWorld(true);assert.equal(chunkable(unindexed),false);
 const many=new THREE.Mesh(terrain(),[new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial()]);many.updateMatrixWorld(true);assert.equal(chunkable(many),false);
 const inst=new THREE.InstancedMesh(terrain(),new THREE.MeshBasicMaterial(),2);inst.updateMatrixWorld(true);assert.equal(chunkable(inst),false);
});
