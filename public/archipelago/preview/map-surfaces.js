import * as THREE from 'three';
import {surfaceMaterial,surfaceUV,materialChoices} from './surface-materials.js';
import {bufferPolyline,planarBoolean,pointInPolygon,signedArea,cleanPolygon} from './roads/planar.js';
import {MAIN_HEIGHT} from './world-config.js';
export {materialChoices};
const clone=value=>JSON.parse(JSON.stringify(value)),EPS=1e-7,cache=new WeakMap();
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(a,b,p){return Math.abs(cross(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
function intersects(a,b,c,d){const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);return ac*ad< -EPS&&ca*cb< -EPS||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);}
function contour(value,label){if(!Array.isArray(value)||value.length<3||value.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw Error(label+' needs at least three finite [x,z] points');const points=value.map(p=>[...p]);if(points.length>3&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<EPS)points.pop();for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<EPS)throw Error(label+' has duplicate adjacent points');for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;if(intersects(a,b,points[j],points[(j+1)%points.length]))throw Error(label+' intersects itself');}}if(Math.abs(signedArea(points))<EPS)throw Error(label+' has no area');return cleanPolygon(points);}
function contoursCross(a,b){for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(intersects(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;return false;}
export function validateSurfaceDefinition(def){
 if(!def||!['path','plaza','brush'].includes(def.kind))throw Error('Surface kind must be path, plaza or brush');surfaceMaterial(def.material??'Slabs');
 if(!Number.isFinite(def.sampleSpacing)||def.sampleSpacing<.25||def.sampleSpacing>10)throw Error('Surface sample spacing must be between 0.25 and 10 metres');
 if(!Number.isFinite(def.offset)||Math.abs(def.offset)>.5)throw Error('Surface offset must be finite and within 0.5 m');
 if(def.kind==='path'){if(def.closed&&def.points?.length<3)throw Error('A closed path needs three points');if(!Array.isArray(def.points)||def.points.length<2||def.points.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('A path needs two finite [x,y,z] control points');if(!Number.isFinite(def.width)||def.width<.2||def.width>30)throw Error('Path width must be between 0.2 and 30 metres');for(let i=1;i<def.points.length;i++)if(Math.hypot(def.points[i][0]-def.points[i-1][0],def.points[i][2]-def.points[i-1][2])<EPS)throw Error('Path points must have distinct horizontal positions');}
 else if(def.kind==='brush'){if(!Array.isArray(def.cells)||!Number.isFinite(def.height))throw Error('Invalid brush surface');def.cells.forEach(p=>contour(p,'Brush cell'));}
 else{const outer=contour(def.polygon,'Plaza polygon'),holes=(def.holes??[]).map((h,i)=>contour(h,'Plaza hole '+i));if(!Number.isFinite(def.height))throw Error('Plaza height must be finite');for(let i=0;i<holes.length;i++){if(!holes[i].every(p=>pointInPolygon(p,outer))||contoursCross(outer,holes[i]))throw Error('Plaza holes must be strictly inside its polygon');for(let j=0;j<i;j++)if(contoursCross(holes[i],holes[j])||pointInPolygon(holes[i][0],holes[j])||pointInPolygon(holes[j][0],holes[i]))throw Error('Plaza holes must not overlap');}}
 (def.brushCuts??[]).forEach(p=>contour(p,'Brush eraser'));
 return true;
}
function normalize(def){return {schema:1,kind:def.kind,material:def.material??'Slabs',offset:def.offset??.025,conformToTerrain:def.conformToTerrain??true,sampleSpacing:def.sampleSpacing??.75,...clone(def)};}
export function getSurfaceDefinition(node){if(!node.userData.surfaceDefinition)throw Error('Object is not an editable map surface');return clone(node.userData.surfaceDefinition);}
function nearestHeight(samples,x,z){let distance=Infinity,y=0;for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i],dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1),d=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);if(d<distance){distance=d;y=THREE.MathUtils.lerp(a.y,b.y,t);}}return y;}
function build(node,def,{heightAt}={}){
 validateSurfaceDefinition(def);node.updateWorldMatrix(true,false);const matrix=node.matrixWorld;if(Math.abs(matrix.determinant())<EPS)throw Error('Surface scale must be nonzero');const inverse=matrix.clone().invert();let cells,area,curve=null,samples=[],length=0;
 if(def.kind==='path'){
  curve=new THREE.CatmullRomCurve3(def.points.map(p=>new THREE.Vector3(...p)),!!def.closed,'centripetal');curve.arcLengthDivisions=Math.max(200,def.points.length*80);curve.updateArcLengths();const scale=new THREE.Vector3();matrix.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);const width=def.width*(Math.abs(scale.x)+Math.abs(scale.z))*.5;
  samples=curve.getSpacedPoints(Math.min(1600,Math.max(2,Math.ceil(curve.getLength()*Math.max(Math.abs(scale.x),Math.abs(scale.z))/Math.max(.25,def.sampleSpacing))))).map(p=>p.applyMatrix4(matrix));for(let i=1;i<samples.length;i++)length+=samples[i].distanceTo(samples[i-1]);const polys=bufferPolyline(samples.map(p=>[p.x,p.z]),width,{closed:!!def.closed,roundCaps:!!def.roundCaps});({cells,area}=planarBoolean([polys],c=>c[0]>0));
 }else if(def.kind==='brush'){
  const polygons=def.cells.map(cell=>cell.map(p=>{const v=new THREE.Vector3(p[0],def.height,p[1]).applyMatrix4(matrix);return [v.x,v.z];}));({cells,area}=planarBoolean([polygons],n=>n[0]>0));
 }else{
  const world=p=>new THREE.Vector3(p[0],def.height,p[1]).applyMatrix4(matrix),outer=def.polygon.map(world).map(p=>[p.x,p.z]),holes=(def.holes??[]).map(h=>h.map(world).map(p=>[p.x,p.z]));({cells,area}=planarBoolean([[outer],holes],c=>c[0]>0&&!c[1]));
 }
 if(def.brushCuts?.length){const cuts=def.brushCuts.map(cell=>cell.map(p=>{const v=new THREE.Vector3(p[0],0,p[1]).applyMatrix4(matrix);return [v.x,v.z];}));({cells,area}=planarBoolean([cells,cuts],n=>n[0]>0&&!n[1]));}
 const positions=[],uv=[],indices=[],height=(x,z)=>{const measured=def.conformToTerrain?heightAt?.(x,z):null;return (Number.isFinite(measured)?measured:def.kind==='path'?nearestHeight(samples,x,z):new THREE.Vector3(0,def.height,0).applyMatrix4(matrix).y)+def.offset;};
 const vertex=point=>{const [x,z]=point,p=new THREE.Vector3(x,height(x,z),z).applyMatrix4(inverse);positions.push(...p.toArray());uv.push(...surfaceUV(x,z,def.material));return positions.length/3-1;};
 // A bounded grid subdivision follows terrain between outline points too.
 function triangle(a,b,c,depth=0){const edge=Math.max(Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(a[0]-c[0],a[1]-c[1]),Math.hypot(c[0]-b[0],c[1]-b[1]));if(def.conformToTerrain&&heightAt&&edge>3&&depth<8){const ab=a.map((v,i)=>(v+b[i])/2),bc=b.map((v,i)=>(v+c[i])/2),ca=c.map((v,i)=>(v+a[i])/2);triangle(a,ab,ca,depth+1);triangle(ab,b,bc,depth+1);triangle(ca,bc,c,depth+1);triangle(ab,bc,ca,depth+1);}else indices.push(vertex(a),vertex(c),vertex(b));}
 for(const cell of cells)for(let i=1;i<cell.length-1;i++)triangle(cell[0],cell[i],cell[i+1]);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData={mapSurfaceGenerated:true,worldTiling:true};
 return {geometry,area,length,samples,curve,definition:def};
}
export function rebuildSurface(node,options={}){
 const def=getSurfaceDefinition(node),data=build(node,def,options);if(node.geometry?.userData.mapSurfaceGenerated)node.geometry.dispose();node.geometry=data.geometry;node.material=surfaceMaterial(def.material);node.receiveShadow=true;
 Object.assign(node.userData,{mapSurface:true,surfaceDefinition:clone(def),surfaceKind:def.kind,surfaceMaterial:def.material,editable_root:true,layer:'Paths',category:'Paths',collision:!!data.geometry.index.count,ground_surface:true,surface_type:'path',physics_mode:'STATIC',friction:.7,restitution:.02,surfaceStats:{area:data.area,length:data.length,triangles:data.geometry.index.count/3},surfaceDiagnostics:[]});cache.set(node,data);return data;
}
export function setSurfaceDefinition(node,patch,options={}){const previous=getSurfaceDefinition(node),next=normalize({...previous,...patch});validateSurfaceDefinition(next);node.userData.surfaceDefinition=next;try{return rebuildSurface(node,options);}catch(error){node.userData.surfaceDefinition=previous;throw error;}}
export function createPath(def,options={}){const node=new THREE.Mesh();node.name=def.name??'Pedestrian path';node.userData.surfaceDefinition=normalize({kind:'path',width:2,...def});rebuildSurface(node,options);return node;}
export function createPlaza(def,options={}){const node=new THREE.Mesh();node.name=def.name??'Plaza';node.userData.surfaceDefinition=normalize({kind:'plaza',height:MAIN_HEIGHT,holes:[],...def});rebuildSurface(node,options);return node;}
export function createBrushSurface(def,options={}){const node=new THREE.Mesh();node.name=def.name??'Painted path';node.userData.surfaceDefinition=normalize({kind:'brush',height:MAIN_HEIGHT,cells:[],...def});rebuildSurface(node,options);return node;}
export function rebuildSurfaces(root,options={}){const rebuilt=[];root.updateMatrixWorld(true);root.traverse(node=>{if(!(node.userData.mapSurface||node.userData.surfaceDefinition))return;if(options.terrainBounds){if(node.userData.surfaceDefinition?.conformToTerrain===false)return;const b=new THREE.Box3().setFromObject(node),a=options.terrainBounds;if(b.max.x<a.minX||b.min.x>a.maxX||b.max.z<a.minZ||b.min.z>a.maxZ)return;}rebuilt.push(rebuildSurface(node,options));});return rebuilt;}
export function surfaceGeometryData(node){return cache.get(node);}
