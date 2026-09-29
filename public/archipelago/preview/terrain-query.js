import * as THREE from 'three';

const queries=new WeakMap(),EPS=1e-7;
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
 const start=performance.now(),bins=new Map(),triangles=[],meshes=[],watched=[],ancestors=new Set([root]);
 root.updateWorldMatrix(true,true);
 root.traverse(o=>{if(terrainNode(o)){watched.push({object:o,geometry:o.geometry,position:o.geometry.attributes.position,positionVersion:o.geometry.attributes.position.version,index:o.geometry.index,indexVersion:o.geometry.index?.version});for(let p=o;p;p=p.parent)ancestors.add(p);}if(activeTerrain(o))meshes.push(o);});
 const transforms=[...ancestors].map(o=>({o,parent:o.parent,children:o.children.length,visible:o.visible,deleted:o.userData.deleted,editorOnly:o.userData.editorOnly,position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone(),matrix:o.matrix.clone()}));
 const vector=new THREE.Vector3();
 for(const mesh of meshes){
  const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index?.array,count=index?.length??position.count,world=mesh.matrixWorld;
  for(let i=0;i<count;i+=3){
   const points=[0,1,2].map(k=>vector.fromBufferAttribute(position,index?index[i+k]:i+k).applyMatrix4(world).toArray());
   const [a,b,c]=points,dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dx2*dz1;
   if(Math.abs(det)<1e-12)continue;
   const triangle=[a[0],a[1],a[2],dx1,b[1]-a[1],dz1,dx2,c[1]-a[1],dz2,1/det],id=triangles.length;triangles.push(triangle);
   const minX=Math.min(a[0],b[0],c[0]),maxX=Math.max(a[0],b[0],c[0]),minZ=Math.min(a[2],b[2],c[2]),maxZ=Math.max(a[2],b[2],c[2]);
   for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++){
    const key=x+':'+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(id);
   }
  }
 }
 const stats={meshes:meshes.length,triangles:triangles.length,bins:bins.size,buildMs:performance.now()-start,queries:0,triangleTests:0};
 return {
  stats,
  isCurrent(){return watched.every(s=>s.object.geometry===s.geometry&&s.geometry.attributes.position===s.position&&s.position.version===s.positionVersion&&s.geometry.index===s.index&&s.index?.version===s.indexVersion)&&transforms.every(s=>s.o.parent===s.parent&&s.o.children.length===s.children&&s.o.visible===s.visible&&s.o.userData.deleted===s.deleted&&s.o.userData.editorOnly===s.editorOnly&&s.o.position.equals(s.position)&&s.o.quaternion.equals(s.quaternion)&&s.o.scale.equals(s.scale)&&(s.o.matrixAutoUpdate||s.o.matrix.equals(s.matrix)));},
  heightAt(x,z,{minHeight=-Infinity,maxHeight=Infinity,fallback=null}={}){
   stats.queries++;if(!Number.isFinite(x)||!Number.isFinite(z))return fallback;
   let best=-Infinity;
   for(const id of bins.get(Math.floor(x/cellSize)+':'+Math.floor(z/cellSize))??[]){
    const t=triangles[id],px=x-t[0],pz=z-t[2],u=(t[8]*px-t[6]*pz)*t[9],v=(t[3]*pz-t[5]*px)*t[9];stats.triangleTests++;
    if(u<-EPS||v<-EPS||u+v>1+EPS)continue;
    const y=t[1]+u*t[4]+v*t[7];if(y>minHeight&&y<=maxHeight&&y>best)best=y;
   }
   return best===-Infinity?fallback:best;
  },
 };
}

export function invalidateTerrainQuery(root){queries.delete(root);}
export function refreshTerrainQuery(root,options){const query=createTerrainQuery(root,options);queries.set(root,query);return query;}
export function getTerrainQuery(root){const query=queries.get(root);return query?.isCurrent()?query:refreshTerrainQuery(root);}
export function terrainHeightAt(root,x,z,options){return getTerrainQuery(root).heightAt(x,z,options);}
