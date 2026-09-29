import * as THREE from 'three';
import {getTerrainQuery} from './terrain-query.js';
/** Recolour the existing ocean grid from the edited island's physical bottom.
 * Run only after authoring changes; no per-frame terrain sampling. */
export function refreshCoastalWater(root){
 if(!root.children.some(n=>n.userData.coastalProfile&&n.visible&&!n.userData.deleted))return;
 const sea=root.children.find(n=>n.userData.sea),positions=sea?.geometry.attributes.position,colors=sea?.geometry.attributes.color;if(!positions||!colors)return;
 const query=getTerrainQuery(root),level=root.userData.seaLevel??-.35,deep=new THREE.Color('#237f9d'),shallow=new THREE.Color('#70c9bc'),edge=new THREE.Color('#b0d5ba'),point=new THREE.Vector3();sea.updateWorldMatrix(true,false);
 for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(sea.matrixWorld);const depth=Math.max(0,level-(query.heightAt(point.x,point.z)??level-4)),color=shallow.clone().lerp(deep,THREE.MathUtils.smoothstep(depth,.4,3));if(depth<.35)color.lerp(edge,1-depth/.35);colors.setXYZ(i,color.r,color.g,color.b);}
 colors.needsUpdate=true;sea.material.transparent=true;sea.material.opacity=.9;sea.material.depthWrite=false;sea.material.needsUpdate=true;
}
