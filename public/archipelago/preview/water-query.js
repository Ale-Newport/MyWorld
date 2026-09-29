import * as THREE from 'three';
function contains(x,z,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
/** World-space water levels come from editable lake surfaces, including scale. */
export function waterLevelQuery(root,seaLevel){
 const lakes=[];root.updateMatrixWorld(true);root.traverseVisible(o=>{if(!o.userData.terrainCut?.contour||o.userData.parameters?.iceMode)return;let surface;o.traverse(n=>{if(n.userData.waterSurface&&n.userData.surface_type==='water')surface=n;});if(!surface)return;const level=surface.getWorldPosition(new THREE.Vector3()).y;lakes.push({inverse:o.matrixWorld.clone().invert(),contour:o.userData.terrainCut.contour,level});});
 const p=new THREE.Vector3();return (x,z)=>{for(const lake of lakes){p.set(x,lake.level,z).applyMatrix4(lake.inverse);if(contains(p.x,p.z,lake.contour))return lake.level;}return seaLevel;};
}
