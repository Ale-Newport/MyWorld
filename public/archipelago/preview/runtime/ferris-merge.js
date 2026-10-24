import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/* The Ferris wheel's cabins, one mesh each.
 *
 * The wheel is 89 meshes and 174,000 triangles, and 84 of the meshes are its 12 cabins: seven primitives per cabin, all of one material, all
 * hanging from the same pivot. A cabin's seven meshes become one (their geometries merged, in the cabin's own space) that stays where they were, a child
 * of the same cabin node: the animation clip keeps driving the pivots and the cabin moves as it always did, and nothing is recomposed or uploaded per frame.
 * The originals stay in the scene, hidden (so every node name and animation binding is what it was) and are never uploaded to the GPU.
 * Twelve draw calls for the cabins instead of eighty-four; not one triangle fewer, no change to the model. */
const CABIN=/^FerrisWheel_Cabin_\d+$/;
const visible=n=>{for(let p=n;p;p=p.parent)if(!p.visible)return false;return true;};

export function mergeFerrisCabins(scene){
 const merged=[];
 scene.traverse(n=>{
  if(!CABIN.test(n.name)||!visible(n))return;
  const meshes=n.children.filter(c=>c.isMesh&&!Array.isArray(c.material)),first=meshes[0];
  if(meshes.length<2||meshes.length!==n.children.length||meshes.some(m=>m.material!==first.material||m.castShadow!==first.castShadow||m.receiveShadow!==first.receiveShadow||m.children.length||!m.geometry.attributes.position))return;
  n.updateMatrixWorld(true);
  const keys=Object.keys(first.geometry.attributes);
  const geometries=meshes.map(m=>{const g=m.geometry.clone();for(const k of Object.keys(g.attributes))if(!keys.includes(k))g.deleteAttribute(k);if(!m.matrix.equals(IDENTITY))g.applyMatrix4(m.matrix);return g;});
  const geometry=geometries.every(g=>keys.every(k=>g.attributes[k]))?mergeGeometries(geometries,false):null;
  geometries.forEach(g=>g.dispose());
  if(!geometry)return;
  const mesh=new THREE.Mesh(geometry,first.material);mesh.name=n.name+'_merged';mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.matrixAutoUpdate=false;
  n.add(mesh);for(const m of meshes)m.visible=false;
  merged.push({cabin:n,mesh,meshes});
 });
 return {
  cabins:merged.length,meshesReplaced:merged.reduce((s,c)=>s+c.meshes.length,0),
  dispose(){for(const c of merged){c.mesh.removeFromParent();c.mesh.geometry.dispose();for(const m of c.meshes)m.visible=true;}merged.length=0;},
 };
}
const IDENTITY=new THREE.Matrix4();
