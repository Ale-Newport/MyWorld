import * as THREE from 'three';
import {SEA_LEVEL} from './world-config.js';

/** Shallow colour follows the actual sea floor; the far ocean has no tile edge. */
export function finishOcean(root,heightAt){
 const sea=root.children.find(o=>o.userData.sea);if(!sea)return;
 const half=220,n=220,positions=[],colors=[],indices=[],uv=[];
 const deep=new THREE.Color('#197e9f'),shallow=new THREE.Color('#68cbd0'),foam=new THREE.Color('#b1e5db');
 const vertex=(x,z)=>{positions.push(x,0,z);uv.push(x*.06,z*.06);const depth=Math.max(0,SEA_LEVEL-heightAt(x,z)),fade=THREE.MathUtils.smoothstep(depth,.05,1.8),c=shallow.clone().lerp(deep,fade);if(depth<.09)c.lerp(foam,.26);colors.push(c.r,c.g,c.b);return positions.length/3-1;};
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++)vertex(-half+x*2,-half+z*2);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x;indices.push(a,a+n+1,a+1,a+1,a+n+1,a+n+2);}
 // A continuous outer skirt connects the detailed coast to the horizon.
 const boundary=[];for(let i=0;i<=n;i++)boundary.push(i);for(let j=1;j<=n;j++)boundary.push(j*(n+1)+n);for(let i=n-1;i>=0;i--)boundary.push(n*(n+1)+i);for(let j=n-1;j>0;j--)boundary.push(j*(n+1));
 const outer=boundary.map(i=>vertex(positions[i*3]*6,positions[i*3+2]*6));
 for(let k=0;k<boundary.length;k++){const next=(k+1)%boundary.length,a=boundary[k],b=boundary[next],c=outer[k],d=outer[next];indices.push(a,b,c,b,d,c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();sea.geometry.dispose();sea.geometry=g;sea.rotation.set(0,0,0);sea.position.y=SEA_LEVEL;sea.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.28,metalness:.12,side:THREE.DoubleSide});
 sea.userData.seaDepthColors=true;sea.receiveShadow=true;
 // White contour segments are sampled from the same terrain, never a cliff wall.
 const segments=[],step=2;for(let z=-134;z<134;z+=step)for(let x=-154;x<154;x+=step){const p=[[x,z],[x+step,z],[x+step,z+step],[x,z+step]],h=p.map(([x,z])=>heightAt(x,z)-SEA_LEVEL),cuts=[];for(let i=0;i<4;i++){const j=(i+1)%4;if(h[i]*h[j]>=0)continue;const t=h[i]/(h[i]-h[j]);cuts.push([THREE.MathUtils.lerp(p[i][0],p[j][0],t),SEA_LEVEL+.014,THREE.MathUtils.lerp(p[i][1],p[j][1],t)]);}if(cuts.length===2)segments.push(...cuts[0],...cuts[1]);}
 const edge=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(segments,3)),new THREE.LineBasicMaterial({color:0xc9ede1,transparent:true,opacity:.44}));edge.name='Shoreline foam';edge.userData={collision:false,unselectable:true,derivedWater:true};root.add(edge);
}

/** Open sea needs no 2 m grid. Once the saved world is applied and the coastal water is tinted from its final terrain, every block of the grid
 * whose vertices all carry one colour becomes two triangles: a flat surface coloured per vertex draws the same when the vertices of a block agree,
 * so the decision reads the final colours (never a depth guess, which disagreed with the final terrain along the south coast). An edge that meets
 * a finer block keeps that block's vertices, so the surface stays watertight. The studio keeps the full grid: new land is tinted vertex by vertex. */
export function simplifyOcean(root,{tolerance=3e-4,block=16}={}){
 const sea=root.children.find(o=>o.userData.sea);if(!sea)return null;
 const n=220,half=220,cell=2,W=n+1,G=W*W,g=sea.geometry,pos=g.attributes.position,col=g.attributes.color,uv=g.attributes.uv,old=g.index?.array;
 if(!old||!col||!uv||pos.count!==G+4*n)return null; // not the full grid finishOcean builds (already simplified, or something else)
 const c=col.array,leaves=[],used=new Uint8Array(G);
 // flat: no colour channel varies by more than the tolerance across the vertices of the block
 const flat=(x0,z0,x1,z1)=>{
  let a=1e9,b=1e9,d=1e9,A=-1e9,B=-1e9,D=-1e9;
  for(let z=z0;z<=z1;z++)for(let x=x0,k=(z*W+x)*3;x<=x1;x++,k+=3){const r=c[k],s=c[k+1],t=c[k+2];if(r<a)a=r;if(r>A)A=r;if(s<b)b=s;if(s>B)B=s;if(t<d)d=t;if(t>D)D=t;}
  return A-a<=tolerance&&B-b<=tolerance&&D-d<=tolerance;
 };
 const leaf=(x0,z0,x1,z1)=>{leaves.push(x0,z0,x1,z1);used[z0*W+x0]=used[z0*W+x1]=used[z1*W+x0]=used[z1*W+x1]=1;};
 const split=(x0,z0,x1,z1)=>{
  const wide=x1-x0>1,tall=z1-z0>1;
  if((wide||tall)&&flat(x0,z0,x1,z1)||!wide&&!tall){leaf(x0,z0,x1,z1);return;}
  const mx=wide?(x0+x1)>>1:x1,mz=tall?(z0+z1)>>1:z1;
  split(x0,z0,mx,mz);if(mx<x1)split(mx,z0,x1,mz);if(mz<z1)split(x0,mz,mx,z1);if(mx<x1&&mz<z1)split(mx,mz,x1,z1);
 };
 for(let z=0;z<n;z+=block)for(let x=0;x<n;x+=block)split(x,z,Math.min(x+block,n),Math.min(z+block,n));
 for(let i=0;i<=n;i++)used[i]=used[n*W+i]=used[i*W]=used[i*W+n]=1; // the skirt is stitched to every vertex of the rim
 const index=[],ring=[],extra=[]; // extra: the centre vertices of blocks that have finer neighbours (x, z, r, g, b)
 for(let l=0;l<leaves.length;l+=4){
  const x0=leaves[l],z0=leaves[l+1],x1=leaves[l+2],z1=leaves[l+3],a=z0*W+x0,b=z0*W+x1,d=z1*W+x1,e=z1*W+x0;
  if(x1-x0===1&&z1-z0===1){index.push(a,e,b,b,e,d);continue;} // a cell keeps its own diagonal: its four colours differ
  // a flat block: its outline carries the vertices a finer neighbour put on each edge
  ring.length=0;
  for(let x=x0;x<x1;x++)if(x===x0||used[z0*W+x])ring.push(z0*W+x);
  for(let z=z0;z<z1;z++)if(z===z0||used[z*W+x1])ring.push(z*W+x1);
  for(let x=x1;x>x0;x--)if(x===x1||used[z1*W+x])ring.push(z1*W+x);
  for(let z=z1;z>z0;z--)if(z===z1||used[z*W+x0])ring.push(z*W+x0);
  if(ring.length===4){index.push(a,e,b,b,e,d);continue;}
  // every outline segment is a triangle edge shared with the neighbour, from a vertex in the middle: no T-junction, so no crack
  const centre=pos.count+extra.length/5;extra.push((-half+(x0+x1)*cell/2),(-half+(z0+z1)*cell/2),c[a*3],c[a*3+1],c[a*3+2]);
  for(let i=0;i<ring.length;i++)index.push(centre,ring[(i+1)%ring.length],ring[i]);
 }
 // the skirt (any triangle that reaches past the grid) is unchanged
 for(let i=0;i<old.length;i+=3)if(old[i]>=G||old[i+1]>=G||old[i+2]>=G)index.push(old[i],old[i+1],old[i+2]);
 // only the vertices still in use
 const remap=new Int32Array(pos.count+extra.length/5).fill(-1);let count=0;for(let i=0;i<index.length;i++)if(remap[index[i]]<0)remap[index[i]]=count++;
 const P=new Float32Array(count*3),C=new Float32Array(count*3),U=new Float32Array(count*2);
 for(let v=0;v<remap.length;v++){
  const k=remap[v];if(k<0)continue;
  if(v<pos.count){P.set(pos.array.subarray(v*3,v*3+3),k*3);C.set(c.subarray(v*3,v*3+3),k*3);U.set(uv.array.subarray(v*2,v*2+2),k*2);}
  else{const m=(v-pos.count)*5,x=extra[m],z=extra[m+1];P.set([x,0,z],k*3);C.set([extra[m+2],extra[m+3],extra[m+4]],k*3);U.set([x*.06,z*.06],k*2);}
 }
 for(let i=0;i<index.length;i++)index[i]=remap[index[i]];
 const next=new THREE.BufferGeometry();next.setAttribute('position',new THREE.BufferAttribute(P,3));next.setAttribute('color',new THREE.BufferAttribute(C,3));next.setAttribute('uv',new THREE.BufferAttribute(U,2));
 next.setIndex(new THREE.BufferAttribute(count>65535?new Uint32Array(index):new Uint16Array(index),1));next.computeVertexNormals();
 sea.geometry=next;g.dispose();return sea;
}
