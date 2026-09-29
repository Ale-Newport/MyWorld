import * as THREE from 'three';
import {bufferPolyline,disc,planarBoolean} from './roads/planar.js';
import {createBrushSurface,getSurfaceDefinition,setSurfaceDefinition} from './map-surfaces.js';

/** Keep corners while dropping redundant pointer samples; radius is metres. */
export function brushShape(points,radius){
 if(!Number.isFinite(radius)||radius<=0||!points.length)throw Error('Invalid brush radius or stroke');
 const p=points.map(v=>v.isVector3?[v.x,v.z]:[...v]);if(p.some(v=>v.length!==2||!v.every(Number.isFinite)))throw Error('Invalid brush point');
 const unique=p.filter((v,i)=>!i||Math.hypot(v[0]-p[i-1][0],v[1]-p[i-1][1])>1e-6),simple=[];
 function simplify(a,b){let best=radius*.08,index=-1;const from=unique[a],to=unique[b],dx=to[0]-from[0],dz=to[1]-from[1];for(let i=a+1;i<b;i++){const v=unique[i],t=THREE.MathUtils.clamp(((v[0]-from[0])*dx+(v[1]-from[1])*dz)/(dx*dx+dz*dz||1),0,1),d=Math.hypot(v[0]-from[0]-t*dx,v[1]-from[1]-t*dz);if(d>best){best=d;index=i;}}if(index>=0){simplify(a,index);simplify(index,b);}else simple.push(from);}
 if(unique.length>1)simplify(0,unique.length-1);simple.push(unique.at(-1));
 return simple.length===1?[disc(simple[0],radius,20)]:bufferPolyline(simple,radius*2,{roundCaps:true,joinSteps:20});
}
const visible=o=>{for(let p=o;p;p=p.parent)if(!p.visible||p.userData.deleted)return false;return true;};
function localPolygons(node,polygons){node.updateWorldMatrix(true,false);return polygons.map(poly=>poly.map(([x,z])=>{const p=node.worldToLocal(new THREE.Vector3(x,0,z));return [p.x,p.z];}));}
function intersectsStroke(node,polygons){const b=new THREE.Box3().setFromObject(node);return polygons.some(p=>Math.max(...p.map(v=>v[0]))>=b.min.x&&Math.min(...p.map(v=>v[0]))<=b.max.x&&Math.max(...p.map(v=>v[1]))>=b.min.z&&Math.min(...p.map(v=>v[1]))<=b.max.z);}

/** Subtraction changes geometry, never deletes a whole crossed path. The caller
 * wraps one completed pointer stroke in the world's shared history command. */
export function applyPathBrush(root,points,{kind='add',material='Slabs',radius=1,heightAt,register=n=>n,canEdit=()=>true}={}){
 const polygons=brushShape(points,radius),surfaces=[];root.updateMatrixWorld(true);root.traverse(o=>{if(o.userData.mapSurface&&visible(o)&&canEdit(o))surfaces.push(o);});
 if(kind==='erase'){
  const changed=[];for(const node of surfaces){if(!intersectsStroke(node,polygons))continue;const def=getSurfaceDefinition(node),cuts=planarBoolean([def.brushCuts??[],localPolygons(node,polygons)],n=>n[0]>0||n[1]>0).cells,before=node.userData.surfaceStats.area;
   setSurfaceDefinition(node,{brushCuts:cuts},{heightAt});if(Math.abs(node.userData.surfaceStats.area-before)>1e-6)changed.push(node);else setSurfaceDefinition(node,{brushCuts:def.brushCuts??[]},{heightAt});
  }return changed;
 }
 if(kind!=='add')throw Error('Unknown path brush operation');
 // Only combine overlapping painted paths with the same material. Original
 // curves/plazas retain their own definitions and control points.
 const node=surfaces.find(o=>o.parent===root&&o.userData.surfaceDefinition.kind==='brush'&&o.userData.surfaceMaterial===material&&intersectsStroke(o,polygons));
 if(node){const def=getSurfaceDefinition(node),retained=planarBoolean([def.cells,def.brushCuts??[]],n=>n[0]>0&&!n[1]).cells,cells=planarBoolean([retained,localPolygons(node,polygons)],n=>n[0]>0||n[1]>0).cells;setSurfaceDefinition(node,{cells,brushCuts:[]},{heightAt});return [node];}
 const cells=planarBoolean([polygons],n=>n[0]>0).cells,created=register(createBrushSurface({cells,material},{heightAt}));root.add(created);return [created];
}
