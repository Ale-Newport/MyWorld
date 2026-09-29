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
