import * as THREE from 'three';

const queries=new WeakMap(),EPS=1e-7,CELLS=2**26;
const terrainNode=o=>o.isMesh&&(o.userData.terrain||o.userData.landTile||o.userData.mapTerrainGenerated)&&!o.userData.waterObject&&!o.userData.sea;
function activeTerrain(o){
 if(!terrainNode(o))return false;
 for(let p=o;p;p=p.parent)if(!p.visible||p.userData.deleted||p.userData.editorOnly)return false;
 return !!o.geometry?.attributes.position;
}

/** Build once per authoring change. Camera layers, selection locks, material
 * sidedness and render batching never determine physical terrain support. */
export function createTerrainQuery(root,{cellSize=4}={}){
 if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Terrain query cell size must be positive');
 const start=performance.now(),meshes=[],watched=[],ancestors=new Set([root]);
 root.updateWorldMatrix(true,true);
 root.traverse(o=>{if(terrainNode(o)){watched.push({object:o,geometry:o.geometry,position:o.geometry.attributes.position,positionVersion:o.geometry.attributes.position.version,index:o.geometry.index,indexVersion:o.geometry.index?.version});for(let p=o;p;p=p.parent)ancestors.add(p);}if(activeTerrain(o))meshes.push(o);});
 const transforms=[...ancestors].map(o=>({o,parent:o.parent,children:o.children.length,visible:o.visible,deleted:o.userData.deleted,editorOnly:o.userData.editorOnly,position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone(),matrix:o.matrix.clone()}));
 const vector=new THREE.Vector3();
 // The triangles are one Float64Array, ten numbers each (the numbers a height query needs), and the cells list theirs in Int32Arrays. As a ten-element
 // array per triangle and an array of ids per cell they were a few hundred thousand small objects the collector had to carry for as long as the
 // query lived, and every rebuild while the world restores made them again: the biggest single share of the heap the start of /world peaked at.
 let capacity=0;for(const mesh of meshes){const g=mesh.geometry;capacity+=Math.ceil((g.index?.array.length??g.attributes.position.count)/3);}
 const tri=new Float64Array(capacity*10),span=new Int32Array(capacity*4);let triangleCount=0;
 for(const mesh of meshes){
  const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index?.array,count=index?.length??position.count,world=mesh.matrixWorld;
  for(let i=0;i<count;i+=3){
   vector.fromBufferAttribute(position,index?index[i]:i).applyMatrix4(world);const ax=vector.x,ay=vector.y,az=vector.z;
   vector.fromBufferAttribute(position,index?index[i+1]:i+1).applyMatrix4(world);const bx=vector.x,by=vector.y,bz=vector.z;
   vector.fromBufferAttribute(position,index?index[i+2]:i+2).applyMatrix4(world);const cx=vector.x,cy=vector.y,cz=vector.z;
   const dx1=bx-ax,dz1=bz-az,dx2=cx-ax,dz2=cz-az,det=dx1*dz2-dx2*dz1;
   if(Math.abs(det)<1e-12)continue;
   const id=triangleCount++,o=id*10;tri[o]=ax;tri[o+1]=ay;tri[o+2]=az;tri[o+3]=dx1;tri[o+4]=by-ay;tri[o+5]=dz1;tri[o+6]=dx2;tri[o+7]=cy-ay;tri[o+8]=dz2;tri[o+9]=1/det;
   // The cells the triangle's box covers (none, when a corner is not a number).
   const x0=Math.floor(Math.min(ax,bx,cx)/cellSize),x1=Math.floor(Math.max(ax,bx,cx)/cellSize),z0=Math.floor(Math.min(az,bz,cz)/cellSize),z1=Math.floor(Math.max(az,bz,cz)/cellSize),s=id*4;
   if(x0<=x1&&z0<=z1){span[s]=x0;span[s+1]=x1;span[s+2]=z0;span[s+3]=z1;}else{span[s]=1;span[s+1]=0;span[s+2]=1;span[s+3]=0;}
  }
 }
 // A cell's number is looked up in `cells`; its triangles are members[first[n]..first[n+1]), in the order of their ids.
 const cells=new Map(),counts=[];let pairs=0;
 for(let id=0;id<triangleCount;id++){const s=id*4;for(let x=span[s];x<=span[s+1];x++)for(let z=span[s+2];z<=span[s+3];z++){const key=x*CELLS+z;let n=cells.get(key);if(n===undefined){n=counts.length;cells.set(key,n);counts.push(0);}counts[n]++;pairs++;}}
 const first=new Int32Array(counts.length+1);for(let n=0;n<counts.length;n++)first[n+1]=first[n]+counts[n];
 const next=first.slice(0,counts.length),members=new Int32Array(pairs);
 for(let id=0;id<triangleCount;id++){const s=id*4;for(let x=span[s];x<=span[s+1];x++)for(let z=span[s+2];z<=span[s+3];z++)members[next[cells.get(x*CELLS+z)]++]=id;}
 const stats={meshes:meshes.length,triangles:triangleCount,bins:cells.size,buildMs:performance.now()-start,queries:0,triangleTests:0};
 return {
  stats,
  isCurrent(){return watched.every(s=>s.object.geometry===s.geometry&&s.geometry.attributes.position===s.position&&s.position.version===s.positionVersion&&s.geometry.index===s.index&&s.index?.version===s.indexVersion)&&transforms.every(s=>s.o.parent===s.parent&&s.o.children.length===s.children&&s.o.visible===s.visible&&s.o.userData.deleted===s.deleted&&s.o.userData.editorOnly===s.editorOnly&&s.o.position.equals(s.position)&&s.o.quaternion.equals(s.quaternion)&&s.o.scale.equals(s.scale)&&(s.o.matrixAutoUpdate||s.o.matrix.equals(s.matrix)));},
  heightAt(x,z,{minHeight=-Infinity,maxHeight=Infinity,fallback=null}={}){
   stats.queries++;if(!Number.isFinite(x)||!Number.isFinite(z))return fallback;
   let best=-Infinity;
   const cell=cells.get(Math.floor(x/cellSize)*CELLS+Math.floor(z/cellSize));
   for(let m=cell===undefined?0:first[cell],stop=cell===undefined?0:first[cell+1];m<stop;m++){
    const o=members[m]*10,px=x-tri[o],pz=z-tri[o+2],u=(tri[o+8]*px-tri[o+6]*pz)*tri[o+9],v=(tri[o+3]*pz-tri[o+5]*px)*tri[o+9];stats.triangleTests++;
    if(u<-EPS||v<-EPS||u+v>1+EPS)continue;
    const y=tri[o+1]+u*tri[o+4]+v*tri[o+7];if(y>minHeight&&y<=maxHeight&&y>best)best=y;
   }
   return best===-Infinity?fallback:best;
  },
 };
}

export function invalidateTerrainQuery(root){queries.delete(root);}
export function refreshTerrainQuery(root,options){const query=createTerrainQuery(root,options);queries.set(root,query);return query;}
export function getTerrainQuery(root){const query=queries.get(root);return query?.isCurrent()?query:refreshTerrainQuery(root);}
export function terrainHeightAt(root,x,z,options){return getTerrainQuery(root).heightAt(x,z,options);}
