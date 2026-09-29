import * as THREE from 'three';

function terrainSource(geometry){
 const saved=geometry?.userData.terrainCutSource,position=geometry?.attributes.position;
 if(!position)return null;
 if(saved&&Number.isInteger(saved.count)&&saved.count<=position.count&&Array.isArray(saved.indices))return {count:saved.count,indices:[...saved.indices]};
 return {count:position.count,indices:geometry.index?Array.from(geometry.index.array):Array.from({length:position.count},(_,i)=>i)};
}
/** Terrain brushes edit the stable grid; shoreline intersection vertices are
 * disposable. Persist that grid and its topology so every reload cuts once. */
export function captureEditedGeometry(node){
 const geometry=node.geometry,source=node.userData.terrain||node.userData.landTile?terrainSource(geometry):null,count=source?.count??geometry.attributes.position.count;
 const state={position:Array.from(geometry.attributes.position.array.slice(0,count*3)),color:geometry.attributes.color?Array.from(geometry.attributes.color.array.slice(0,count*3)):null};
 if(source)state.terrainCutSource=source;return state;
}
export function restoreEditedGeometry(node,state,baseline){
 const geometry=node.geometry.clone(),terrain=node.userData.terrain||node.userData.landTile;
 // Older base-map saves included derived positions but omitted the original
 // topology. Its fresh baseline supplies the reliable grid, retaining all
 // authored heights/colours in the prefix and dropping only derived vertices.
 const source=terrain?(state.terrainCutSource??terrainSource(baseline??node.geometry)):null,count=source?.count??state.position.length/3;
 if(source){
  if(!Number.isInteger(count)||count<0||count*3>state.position.length||!Array.isArray(source.indices)||source.indices.some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('Invalid saved terrain grid: '+node.name);
  geometry.userData.terrainCutSource={count,indices:[...source.indices]};geometry.setIndex(source.indices);
 }
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(state.position.slice(0,count*3),3));
 if(state.color)geometry.setAttribute('color',new THREE.Float32BufferAttribute(state.color.slice(0,count*3),3));
 geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}
