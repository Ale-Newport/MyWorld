import * as THREE from 'three';
import {SEA_LEVEL} from './world-config.js';
import {signedArea} from './roads/planar.js';

const caches=new WeakMap(),attributeIDs=new WeakMap(),EPS=1e-6;let nextAttributeID=0;
function attributeKey(attribute){if(!attribute)return '-';if(!attributeIDs.has(attribute))attributeIDs.set(attribute,++nextAttributeID);return attributeIDs.get(attribute)+':'+attribute.version;}
// The land of every terrain mesh, clipped to what is above the sea, in flat typed arrays. The world has ~136 000 terrain triangles; one JS array per
// point, per polygon, per bounds and per height made this the largest allocation of the start of /world (about 90 MB promoted to the old space while
// it ran, on a throttled phone the difference between one major collection in the middle of the restore and none). Same arithmetic as the object
// version, point by point, so the data it derives is the same to the last bit.
function landPolygons(meshes,sea){
 let total=0;for(const o of meshes)total+=Math.ceil((o.geometry.index?.array.length??o.geometry.attributes.position.count)/3);
 const step=Math.max(1,Math.ceil(total/4000)),samples=[],v=new THREE.Vector3(),t=new Float64Array(9),clip=new Float64Array(18);
 let pts=new Float64Array(Math.max(36,total*9)),vertices=0,count=0,minHeight=Infinity,maxHeight=-Infinity,g=0;
 const start=new Uint32Array(total+1),bounds=new Float64Array(total*4);
 for(const o of meshes){
  const position=o.geometry.attributes.position,index=o.geometry.index?.array,length=index?index.length:position.count,world=o.matrixWorld;
  for(let i=0;i<length;i+=3,g++){
   for(let k=0;k<3;k++){v.fromBufferAttribute(position,index?index[i+k]:i+k).applyMatrix4(world);t[k*3]=v.x;t[k*3+1]=v.y;t[k*3+2]=v.z;minHeight=Math.min(minHeight,v.y);maxHeight=Math.max(maxHeight,v.y);}
   if(g%step===0)samples.push([0,1,2].map(k=>(t[k]+t[3+k]+t[6+k])/3));
   let n=0;
   for(let a=0;a<3;a++){
    const b=(a+1)%3,ay=t[a*3+1],by=t[b*3+1];
    if(ay>=sea){clip[n*3]=t[a*3];clip[n*3+1]=ay;clip[n*3+2]=t[a*3+2];n++;}
    if((ay<sea)!==(by<sea)){const f=(sea-ay)/(by-ay);for(let k=0;k<3;k++)clip[n*3+k]=THREE.MathUtils.lerp(t[a*3+k],t[b*3+k],f);n++;}
   }
   if(n<3)continue;
   let area=0;for(let j=0;j<n;j++){const q=(j+1)%n;area+=clip[j*3]*clip[q*3+2]-clip[q*3]*clip[j*3+2];}area*=.5;
   if(Math.abs(area)<EPS)continue;
   if(vertices*3+n*3>pts.length){const grown=new Float64Array(pts.length*2);grown.set(pts);pts=grown;}
   let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
   for(let j=0;j<n;j++){
    const from=(area<0?n-1-j:j)*3,to=(vertices+j)*3;pts[to]=clip[from];pts[to+1]=clip[from+1];pts[to+2]=clip[from+2];
    minX=Math.min(minX,clip[from]);maxX=Math.max(maxX,clip[from]);minZ=Math.min(minZ,clip[from+2]);maxZ=Math.max(maxZ,clip[from+2]);
   }
   bounds[count*4]=minX;bounds[count*4+1]=maxX;bounds[count*4+2]=minZ;bounds[count*4+3]=maxZ;
   start[count++]=vertices;vertices+=n;
  }
 }
 start[count]=vertices;
 return {pts,start,bounds,count,total,samples,minHeight,maxHeight};
}

const slotOf=(keys,u,k)=>{let a=0,b=u;while(a<b){const mid=(a+b)>>1;if(keys[mid]<k)a=mid+1;else b=mid;}return a;};
// A number that is the same for two numbers exactly when their toFixed(6) texts are the same (the key of a line has always been those three texts):
// the digits of the text as an integer, minus the sign the text would carry (a small negative still reads "-0.000000"). NaN when the number is not
// finite or too big for that: the caller then uses the text itself.
export function fixed6(x){
 const negative=x<0,magnitude=negative?-x:x,y=magnitude*1e6;if(!(y<2147483000))return NaN;
 const floor=Math.floor(y),fraction=y-floor;
 // y is the product rounded to a double; far enough from a tie its rounding is the text's, near a tie the text decides
 const n=fraction>.499999&&fraction<.500001?Number(magnitude.toFixed(6).replace('.','')):fraction>.5?floor+1:floor;
 return n>=2147483000?NaN:negative?-n-.5:n;
}

// Cancel collinear triangle edges with a signed interval sweep, including
// T-junctions made by exact clipping. No union of the full heightfield is needed.
// The edges are grouped by their line into one typed array each, the groups in the order their first edge came, the edges of a group in the order they
// came; a line is its direction and offset to six decimals, found in a hash table of the three numbers, not of the text made of them.
function boundaryCandidates({pts,start,count}){
 const edges=start[count],group=new Int32Array(edges),lo=new Float64Array(edges),hi=new Float64Array(edges),ta=new Float64Array(edges),tb=new Float64Array(edges),ay=new Float64Array(edges),by=new Float64Array(edges),sign=new Int8Array(edges);
 let table=new Int32Array(1<<16),mask=table.length-1,lines=0,room=1<<15,keyed=new Float64Array(room*3),shape=new Float64Array(room*3),hashed=new Uint8Array(room),texts=null,e=0;
 const hashOf=(k0,k1,k2)=>{let h=Math.imul((k0*2)|0,-1640531535)^Math.imul((k1*2)|0,-2048144777)^Math.imul((k2*2)|0,-1028477379);h^=h>>>15;return Math.imul(h,-2048144789)^(h>>>13);};
 const add=(dx,dz,c,k0,k1,k2,text)=>{
  const g=lines++;
  if(g===room){room*=2;const k=new Float64Array(room*3),h=new Float64Array(room*3),f=new Uint8Array(room);k.set(keyed);h.set(shape);f.set(hashed);keyed=k;shape=h;hashed=f;}
  shape[g*3]=dx;shape[g*3+1]=dz;shape[g*3+2]=c;
  if(text!==undefined){texts.set(text,g);return g;}
  keyed[g*3]=k0;keyed[g*3+1]=k1;keyed[g*3+2]=k2;hashed[g]=1;
  if(lines*2>table.length){
   table=new Int32Array(table.length*2);mask=table.length-1;
   for(let r=0;r<lines;r++){if(!hashed[r])continue;let i=hashOf(keyed[r*3],keyed[r*3+1],keyed[r*3+2])&mask;while(table[i]!==0)i=(i+1)&mask;table[i]=r+1;}
  }else{let i=hashOf(k0,k1,k2)&mask;while(table[i]!==0)i=(i+1)&mask;table[i]=g+1;}
  return g;
 };
 for(let p=0;p<count;p++){
  const from=start[p],n=start[p+1]-from;
  for(let i=0;i<n;i++){
   const A=(from+i)*3,B=(from+(i+1)%n)*3,a0=pts[A],a2=pts[A+2],b0=pts[B],b2=pts[B+2],length=Math.hypot(b0-a0,b2-a2);if(length<EPS)continue;
   let dx=(b0-a0)/length,dz=(b2-a2)/length,s=1;if(dx<-EPS||Math.abs(dx)<EPS&&dz<0){dx=-dx;dz=-dz;s=-1;}
   const c=-dz*a0+dx*a2,k0=fixed6(dx),k1=fixed6(dz),k2=fixed6(c);
   let line=-1;
   if(k0===k0&&k1===k1&&k2===k2){
    let i2=hashOf(k0,k1,k2)&mask,g;
    while((g=table[i2])!==0){const r=g-1;if(keyed[r*3]===k0&&keyed[r*3+1]===k1&&keyed[r*3+2]===k2){line=r;break;}i2=(i2+1)&mask;}
    if(line<0)line=add(dx,dz,c,k0,k1,k2);
   }else{
    const text=dx.toFixed(6)+':'+dz.toFixed(6)+':'+c.toFixed(6);texts??=new Map();
    line=texts.get(text);if(line===undefined)line=add(dx,dz,c,0,0,0,text);
   }
   const ts=dx*a0+dz*a2,te=dx*b0+dz*b2;
   group[e]=line;lo[e]=Math.min(ts,te);hi[e]=Math.max(ts,te);ta[e]=ts;tb[e]=te;ay[e]=pts[A+1];by[e]=pts[B+1];sign[e]=s;e++;
  }
 }
 table=null;texts=null;
 const first=new Int32Array(lines+1);
 for(let i=0;i<e;i++)first[group[i]+1]++;
 for(let i=0;i<lines;i++)first[i+1]+=first[i];
 const order=new Int32Array(e),fill=first.slice(0,lines);
 for(let i=0;i<e;i++)order[fill[group[i]]++]=i;
 const out=[];let keys=new Float64Array(64),net=new Float64Array(64);
 for(let l=0;l<lines;l++){
  const from=first[l],to=first[l+1],m=to-from;
  if(m*2>keys.length){keys=new Float64Array(m*4);net=new Float64Array(m*4);}
  for(let j=0;j<m;j++){const q=order[from+j];keys[j*2]=Math.round(lo[q]/EPS)*EPS+0;keys[j*2+1]=Math.round(hi[q]/EPS)*EPS+0;}
  if(m*2<=24){for(let j=1;j<m*2;j++){const k=keys[j];let h=j-1;while(h>=0&&keys[h]>k){keys[h+1]=keys[h];h--;}keys[h+1]=k;}}else keys.subarray(0,m*2).sort();
  let u=0;for(let j=0;j<m*2;j++)if(j===0||keys[j]!==keys[j-1])keys[u++]=keys[j];
  for(let j=0;j<u;j++)net[j]=0;
  for(let j=0;j<m;j++){const q=order[from+j];net[slotOf(keys,u,Math.round(lo[q]/EPS)*EPS+0)]+=sign[q];net[slotOf(keys,u,Math.round(hi[q]/EPS)*EPS+0)]-=sign[q];}
  let running=0,previous,seen=false;
  for(let j=0;j<u;j++){
   const t=keys[j];
   if(running&&seen&&t-previous>EPS){
    const mid=(previous+t)/2;let q=-1;for(let h=from;h<to;h++){const c=order[h];if(mid>=lo[c]-EPS&&mid<=hi[c]+EPS){q=c;break;}}
    if(q>=0){
     const dx=shape[l*3],dz=shape[l*3+1],c=shape[l*3+2],at=s=>[dx*s-dz*c,THREE.MathUtils.lerp(ay[q],by[q],(s-ta[q])/(tb[q]-ta[q])),dz*s+dx*c];
     out.push(running>0?[at(previous),at(t)]:[at(t),at(previous)]);
    }
   }
   running+=net[j];previous=t;seen=true;
  }
 }
 return out;
}

// The land polygons by 8 m cell (a polygon in every cell its bounds touch): what is near a box, and whether a point is inside any polygon.
function spatial({pts,start,bounds,count}){
 const size=8,cells=new Map();let members=0,ccx=Infinity,ccz=Infinity;
 for(let p=0;p<count;p++){ccx=Math.min(ccx,Math.floor(bounds[p*4]/size));ccz=Math.min(ccz,Math.floor(bounds[p*4+2]/size));}
 let rows=0;for(let p=0;p<count;p++)rows=Math.max(rows,Math.floor(bounds[p*4+3]/size)-ccz+1);
 const eachCell=(p,fn)=>{for(let x=Math.floor(bounds[p*4]/size);x<=Math.floor(bounds[p*4+1]/size);x++)for(let z=Math.floor(bounds[p*4+2]/size);z<=Math.floor(bounds[p*4+3]/size);z++)fn((x-ccx)*rows+(z-ccz));};
 const sizes=[];
 for(let p=0;p<count;p++)eachCell(p,key=>{let c=cells.get(key);if(c===undefined){c=sizes.length;cells.set(key,c);sizes.push(0);}sizes[c]++;members++;});
 const first=new Int32Array(sizes.length+1);for(let c=0;c<sizes.length;c++)first[c+1]=first[c]+sizes[c];
 const fill=first.slice(0,sizes.length),list=new Int32Array(members);
 for(let p=0;p<count;p++)eachCell(p,key=>{list[fill[cells.get(key)]++]=p;});
 const seen=new Int32Array(count);let stamp=0,found=new Int32Array(64),n=0;
 const cellAt=(x,z)=>(z<ccz||z-ccz>=rows?undefined:cells.get((x-ccx)*rows+(z-ccz)));
 const touches=(p,minX,maxX,minZ,maxZ)=>bounds[p*4]<=maxX+EPS&&bounds[p*4+1]>=minX-EPS&&bounds[p*4+2]<=maxZ+EPS&&bounds[p*4+3]>=minZ-EPS;
 return {
  pts,start,
  /** Fills `found` with the polygons whose bounds touch the box; returns how many. */
  near(minX,maxX,minZ,maxZ){
   n=0;stamp++;
   for(let x=Math.floor(minX/size);x<=Math.floor(maxX/size);x++)for(let z=Math.floor(minZ/size);z<=Math.floor(maxZ/size);z++){
    const c=cellAt(x,z);if(c===undefined)continue;
    for(let h=first[c];h<first[c+1];h++){const p=list[h];if(seen[p]!==stamp&&touches(p,minX,maxX,minZ,maxZ)){seen[p]=stamp;if(n===found.length){const grown=new Int32Array(n*2);grown.set(found);found=grown;}found[n++]=p;}}
   }
   return n;
  },
  get found(){return found;},
  inside(x,z){
   const c=cellAt(Math.floor(x/size),Math.floor(z/size));if(c===undefined)return false;
   for(let h=first[c];h<first[c+1];h++){
    const p=list[h];if(!touches(p,x,x,z,z))continue;
    const from=start[p],m=start[p+1]-from;let all=true;
    for(let i=0;i<m&&all;i++){const A=(from+i)*3,B=(from+(i+1)%m)*3;all=(pts[B]-pts[A])*(z-pts[A+2])-(pts[B+2]-pts[A+2])*(x-pts[A])>=-1e-9;}
    if(all)return true;
   }
   return false;
  }
 };
}

// Different authored terrain sources may overlap. Split their boundary at each
// crossing and keep only edges with land on exactly one side of the segment.
function exposedBoundary(candidates,index){
 const result=[],{pts,start}=index;
 for(const [a,b] of candidates){
  const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),cuts=[0,1];
  const near=index.near(Math.min(a[0],b[0]),Math.max(a[0],b[0]),Math.min(a[2],b[2]),Math.max(a[2],b[2])),found=index.found;
  for(let h=0;h<near;h++){
   const from=start[found[h]],m=start[found[h]+1]-from;
   for(let i=0;i<m;i++){
    const C=(from+i)*3,D=(from+(i+1)%m)*3,ex=pts[D]-pts[C],ez=pts[D+2]-pts[C+2],den=dx*ez-dz*ex;if(Math.abs(den)<1e-10)continue;
    const t=((pts[C]-a[0])*ez-(pts[C+2]-a[2])*ex)/den,u=((pts[C]-a[0])*dz-(pts[C+2]-a[2])*dx)/den;
    if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS)cuts.push(t);
   }
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
 const land=landPolygons(meshes,seaLevel);
 const boundary=exposedBoundary(boundaryCandidates(land),spatial(land)),rings=contours(boundary),shoreline=boundary.map(s=>s.map(p=>[p[0],seaLevel+.014,p[2]]));
 const data={seaLevel,boundary,shoreline,contours:rings,holes:rings.filter(c=>c.kind==='hole'),heightRange:Number.isFinite(land.minHeight)?[land.minHeight,land.maxHeight]:null,heightSamples:land.samples,counts:{triangles:land.total,boundarySegments:boundary.length,outer:rings.filter(c=>c.kind==='outer').length,holes:rings.filter(c=>c.kind==='hole').length,open:rings.filter(c=>!c.closed).length},legend:{boundary:'Amber: actual physical land boundary',shoreline:'Cyan: coast at sea level',holes:'Magenta: enclosed water holes',height:'Green points: actual terrain heights'}};
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
