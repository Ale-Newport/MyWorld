import * as THREE from 'three';
import {SEA_LEVEL} from './world-config.js';
import {signedArea} from './roads/planar.js';

const caches=new WeakMap(),attributeIDs=new WeakMap(),EPS=1e-6;let nextAttributeID=0;
function attributeKey(attribute){if(!attribute)return '-';if(!attributeIDs.has(attribute))attributeIDs.set(attribute,++nextAttributeID);return attributeIDs.get(attribute)+':'+attribute.version;}
const bounds=points=>({minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[2])),maxZ:Math.max(...points.map(p=>p[2]))});
const intersects=(a,b)=>a.minX<=b.maxX+EPS&&a.maxX>=b.minX-EPS&&a.minZ<=b.maxZ+EPS&&a.maxZ>=b.minZ-EPS;

function aboveWater(points,sea){
 const out=[];
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  if(a[1]>=sea)out.push(a);
  if((a[1]<sea)!==(b[1]<sea)){
   const t=(sea-a[1])/(b[1]-a[1]);out.push(a.map((v,k)=>THREE.MathUtils.lerp(v,b[k],t)));
  }
 }
 if(out.length<3||Math.abs(signedArea(out.map(p=>[p[0],p[2]])))<EPS)return null;
 if(signedArea(out.map(p=>[p[0],p[2]]))<0)out.reverse();
 return out;
}

function spatial(polygons){
 const bins=new Map(),size=8;
 for(const p of polygons){p.bounds=bounds(p.points);const b=p.bounds;for(let x=Math.floor(b.minX/size);x<=Math.floor(b.maxX/size);x++)for(let z=Math.floor(b.minZ/size);z<=Math.floor(b.maxZ/size);z++){const k=x+':'+z;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(p);}}
 const query=b=>{const found=new Set();for(let x=Math.floor(b.minX/size);x<=Math.floor(b.maxX/size);x++)for(let z=Math.floor(b.minZ/size);z<=Math.floor(b.maxZ/size);z++)for(const p of bins.get(x+':'+z)??[])if(intersects(p.bounds,b))found.add(p);return [...found];};
 const inside=(x,z)=>query({minX:x,maxX:x,minZ:z,maxZ:z}).some(({points})=>points.every((a,i)=>{const b=points[(i+1)%points.length];return (b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0])>=-1e-9;}));
 return {query,inside};
}

// Cancel collinear triangle edges with a signed interval sweep, including
// T-junctions made by exact clipping. No union of the full heightfield is needed.
function boundaryCandidates(polygons){
 const lines=new Map();
 for(const {points} of polygons)for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(b[0]-a[0],b[2]-a[2]);if(length<EPS)continue;
  let dx=(b[0]-a[0])/length,dz=(b[2]-a[2])/length,sign=1;if(dx<-EPS||Math.abs(dx)<EPS&&dz<0){dx=-dx;dz=-dz;sign=-1;}
  const c=-dz*a[0]+dx*a[2],id=[dx,dz,c].map(n=>n.toFixed(6)).join(':');
  if(!lines.has(id))lines.set(id,{dx,dz,c,events:new Map(),edges:[]});
  const line=lines.get(id),ta=dx*a[0]+dz*a[2],tb=dx*b[0]+dz*b[2],lo=Math.min(ta,tb),hi=Math.max(ta,tb),k0=Math.round(lo/EPS)*EPS,k1=Math.round(hi/EPS)*EPS;
  line.events.set(k0,(line.events.get(k0)??0)+sign);line.events.set(k1,(line.events.get(k1)??0)-sign);
  line.edges.push({lo,hi,ta,tb,a,b});
 }
 const out=[];
 for(const {dx,dz,c,events,edges} of lines.values()){
  let count=0,previous;
  for(const [t,delta] of [...events].sort((a,b)=>a[0]-b[0])){
   if(count&&previous!==undefined&&t-previous>EPS){
    const mid=(previous+t)/2,edge=edges.find(e=>mid>=e.lo-EPS&&mid<=e.hi+EPS);
    const at=s=>[dx*s-dz*c,THREE.MathUtils.lerp(edge.a[1],edge.b[1],(s-edge.ta)/(edge.tb-edge.ta)),dz*s+dx*c];
    out.push(count>0?[at(previous),at(t)]:[at(t),at(previous)]);
   }
   count+=delta;previous=t;
  }
 }
 return out;
}

// Different authored terrain sources may overlap. Split their boundary at each
// crossing and keep only edges with land on exactly one side of the segment.
function exposedBoundary(candidates,index){
 const result=[];
 for(const [a,b] of candidates){
  const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),cuts=[0,1];
  for(const {points} of index.query(bounds([a,b])))for(let i=0;i<points.length;i++){
   const c=points[i],d=points[(i+1)%points.length],ex=d[0]-c[0],ez=d[2]-c[2],den=dx*ez-dz*ex;if(Math.abs(den)<1e-10)continue;
   const t=((c[0]-a[0])*ez-(c[2]-a[2])*ex)/den,u=((c[0]-a[0])*dz-(c[2]-a[2])*dx)/den;
   if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS)cuts.push(t);
  }
  cuts.sort((x,y)=>x-y);
  for(let i=1;i<cuts.length;i++){
   const lo=cuts[i-1],hi=cuts[i];if((hi-lo)*length<EPS)continue;
   const mid=(lo+hi)/2,x=a[0]+dx*mid,z=a[2]+dz*mid,offset=Math.min(.0001,length*(hi-lo)*.01),nx=-dz/length*offset,nz=dx/length*offset;
   const left=index.inside(x+nx,z+nz),right=index.inside(x-nx,z-nz);if(left===right)continue;
   const at=t=>a.map((v,k)=>THREE.MathUtils.lerp(v,b[k],t));result.push(left?[at(lo),at(hi)]:[at(hi),at(lo)]);
  }
 }
 return result;
}

function contours(segments){
 const outgoing=new Map(),unused=new Set(segments.map((_,i)=>i)),out=[],bins=new Map(),vertices=[],tolerance=.0002;
 // Float32 authored coordinates can differ by a few micrometres at an exact
 // clipped T-junction. Snap graph identity only; keep debug geometry unchanged.
 const planarKey=p=>{const x=Math.floor(p[0]/tolerance),z=Math.floor(p[2]/tolerance);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const id of bins.get((x+dx)+':'+(z+dz))??[]){const v=vertices[id];if(Math.hypot(v[0]-p[0],v[2]-p[2])<=tolerance)return id;}const id=vertices.length;vertices.push(p);const bin=x+':'+z;if(!bins.has(bin))bins.set(bin,[]);bins.get(bin).push(id);return id;};
 const endpoints=segments.map(([a,b])=>[planarKey(a),planarKey(b)]);
 endpoints.forEach(([a,b],i)=>{if(a===b){unused.delete(i);return;}if(!outgoing.has(a))outgoing.set(a,[]);outgoing.get(a).push(i);});
 while(unused.size){const first=unused.values().next().value,start=segments[first][0],startID=endpoints[first][0],points=[start];let next=first,endID;
  while(next!==undefined&&unused.has(next)){unused.delete(next);const end=segments[next][1];endID=endpoints[next][1];points.push(end);if(endID===startID)break;next=outgoing.get(endID)?.find(i=>unused.has(i));}
  const closed=endID===startID,area=closed?signedArea(points.slice(0,-1).map(p=>[p[0],p[2]])):0;
  out.push({kind:closed?(area<0?'hole':'outer'):'open',closed,area,points});
 }
 return out;
}

/** Cached JSON-ready data from the current physical terrain. Computed on demand
 * or after an edit, never during each frame. Coordinates are world XYZ. */
export function terrainDebugData(root){
 root.updateMatrixWorld(true);const meshes=[];
 root.traverseVisible(o=>{if(o.isMesh&&(o.userData.terrain||o.userData.landTile)&&!o.userData.deleted)meshes.push(o);});
 const seaLevel=root.userData.mapTerrain?.seaLevel??root.userData.seaLevel??SEA_LEVEL;
 const signature=seaLevel+'|'+meshes.map(o=>[o.uuid,o.geometry.uuid,attributeKey(o.geometry.attributes.position),attributeKey(o.geometry.index),...o.matrixWorld.elements].join(',')).join('|');
 const previous=caches.get(root);if(previous?.signature===signature)return previous.data;
 const polygons=[],heights=[];let minHeight=Infinity,maxHeight=-Infinity;
 for(const o of meshes){const p=o.geometry.attributes.position,ix=o.geometry.index?.array??Array.from({length:p.count},(_,i)=>i);for(let i=0;i<ix.length;i+=3){
  const points=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,ix[i+k]).applyMatrix4(o.matrixWorld).toArray());
  for(const point of points){minHeight=Math.min(minHeight,point[1]);maxHeight=Math.max(maxHeight,point[1]);}
  const above=aboveWater(points,seaLevel);if(above)polygons.push({points:above});
  heights.push([0,1,2].map(k=>(points[0][k]+points[1][k]+points[2][k])/3));
 }}
 const boundary=exposedBoundary(boundaryCandidates(polygons),spatial(polygons)),rings=contours(boundary),shoreline=boundary.map(s=>s.map(p=>[p[0],seaLevel+.014,p[2]]));
 const data={seaLevel,boundary,shoreline,contours:rings,holes:rings.filter(c=>c.kind==='hole'),heightRange:Number.isFinite(minHeight)?[minHeight,maxHeight]:null,heightSamples:heights.filter((_,i)=>i%Math.max(1,Math.ceil(heights.length/4000))===0),counts:{triangles:heights.length,boundarySegments:boundary.length,outer:rings.filter(c=>c.kind==='outer').length,holes:rings.filter(c=>c.kind==='hole').length,open:rings.filter(c=>!c.closed).length},legend:{boundary:'Amber: actual physical land boundary',shoreline:'Cyan: coast at sea level',holes:'Magenta: enclosed water holes',height:'Green points: actual terrain heights'}};
 caches.set(root,{signature,data});return data;
}

function lines(segments,color,opacity=1){return new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(segments.flat(2),3)),new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthTest:opacity<1}));}
function dispose(object){object.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});object.removeFromParent();}

export function createTerrainDebug(root){
 const data=terrainDebugData(root),group=new THREE.Group();group.name='Terrain debug';group.userData={collision:false,unselectable:true,proceduralDerived:true,terrainDebug:true};
 const layers=[['Boundary',data.boundary,0xffbf47],['Shoreline',data.shoreline,0x49f6ff],['Water holes',data.holes.flatMap(c=>c.points.slice(1).map((p,i)=>[c.points[i],p])),0xf562e6]];
 for(const [name,segments,color] of layers){const layer=lines(segments,color);layer.name=name;layer.renderOrder=30;group.add(layer);}
 const points=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(data.heightSamples.flat(),3)),new THREE.PointsMaterial({color:0x82f3a7,size:.25,depthTest:false}));points.name='Terrain heights';points.renderOrder=30;group.add(points);return group;
}

/** Original decoration returns on Undo. Derived coastline is reconstructed from
 * mapTerrain sources/operations; no contour cache is put in the saved document. */
export function updateTerrainShoreline(root){
 const state=root.userData.mapTerrain,active=!!(state&&(state.operations.length||state.shorelineDerived))||root.children.some(o=>o.userData.coastalProfile&&o.visible&&!o.userData.deleted);
 for(const o of root.children.filter(o=>o.name==='Shoreline foam'&&!o.userData.mapTerrainShoreline)){
  if(active){o.userData.mapTerrainFoamVisibility??=o.visible;o.visible=false;}
  else if(o.userData.mapTerrainFoamVisibility!==undefined){o.visible=o.userData.mapTerrainFoamVisibility;delete o.userData.mapTerrainFoamVisibility;}
 }
 const old=root.children.find(o=>o.userData.mapTerrainShoreline);
 if(!active){if(old)dispose(old);return null;}
 const data=terrainDebugData(root);if(old?.terrainShoreCache===data)return old;
 if(old)dispose(old);
 const foam=lines(data.shoreline,0xc9ede1,.44);foam.name='Edited shoreline foam';foam.userData={collision:false,unselectable:true,proceduralDerived:true,derivedWater:true,mapTerrainShoreline:true};
 // Keep the cache outside userData: userData is serialized by Object3D.toJSON.
 Object.defineProperty(foam,'terrainShoreCache',{value:data});root.add(foam);return foam;
}
