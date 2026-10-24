import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planarBoolean,signedArea,pointInPolygon} from '../../public/archipelago/preview/roads/planar.js';
import {boundaryLoops,simplifyLoop,dissolve,latticePieces,refineToGround,tessellate} from '../../public/archipelago/preview/surface-tessellate.js';
import {createBrushSurface,createPlaza,rebuildSurface} from '../../public/archipelago/preview/map-surfaces.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/surface-brush-cells.json',import.meta.url),'utf8'));
const area=cells=>cells.reduce((s,c)=>s+Math.abs(signedArea(c)),0);
const square=(x,z,s=1)=>[[x,z],[x+s,z],[x+s,z+s],[x,z+s]];

test('the boundary of two squares that share an edge is one loop; a square with a hole has two',()=>{
 const loops=boundaryLoops([square(0,0),square(1,0)]);
 assert.equal(loops.length,1);assert.equal(Math.abs(signedArea(loops[0])),2);
 // 3 x 3 squares without the middle one
 const ring=[];for(let x=0;x<3;x++)for(let z=0;z<3;z++)if(x!==1||z!==1)ring.push(square(x,z));
 const two=boundaryLoops(ring).map(signedArea).sort((a,b)=>a-b);
 assert.equal(two.length,2);assert.equal(two[0],-1);assert.equal(two[1],9);          // hole clockwise, outline counter-clockwise
});

test('a vertical edge that only partly meets its neighbour is cut at the neighbour\'s vertices',()=>{
 // one tall cell on the left, two short ones on the right: the shared edge is x = 1 from z 0 to 2, met in two parts
 const loops=boundaryLoops([[[0,0],[1,0],[1,2],[0,2]],[[1,0],[2,0],[2,1],[1,1]],[[1,1],[2,1],[2,2],[1,2]]]);
 assert.equal(loops.length,1);assert.equal(Math.abs(signedArea(loops[0])),4);
});

test('Douglas-Peucker keeps corners and drops what lies within the tolerance of a straight line',()=>{
 const loop=[[0,0],[1,.001],[2,0],[3,-.001],[4,0],[4,4],[0,4]];
 const out=simplifyLoop(loop,.01);
 assert.ok(out.length<=5,'the nearly straight edge collapses '+out.length);
 assert.ok(out.some(p=>p[0]===4&&p[1]===4)&&out.some(p=>p[0]===0&&p[1]===4));
});

test('the brush stroke of the published world dissolves from 1,699 slivers to a few dozen trapezoids with the same area',()=>{
 const {cells,area:exact}=planarBoolean([fixture.cells],n=>n[0]>0);
 assert.equal(cells.length,fixture.cells.length);
 const merged=dissolve(cells);
 assert.ok(merged.length<cells.length/10,'cells '+merged.length);
 assert.ok(Math.abs(area(merged)-exact)<exact*.005,'area within 0.5 %: '+area(merged)+' vs '+exact);
 // the same ground: seeded points agree except within 3 cm of the edge
 let seed=11;const rnd=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296,xs=fixture.cells.flat();
 const lo=[Math.min(...xs.map(p=>p[0])),Math.min(...xs.map(p=>p[1]))],hi=[Math.max(...xs.map(p=>p[0])),Math.max(...xs.map(p=>p[1]))];
 let wrong=0;const N=3000;
 for(let i=0;i<N;i++){const p=[lo[0]+rnd()*(hi[0]-lo[0]),lo[1]+rnd()*(hi[1]-lo[1])],a=cells.some(c=>pointInPolygon(p,c)),b=merged.some(c=>pointInPolygon(p,c));if(a!==b)wrong++;}
 assert.ok(wrong<=N*.003,'points on the other side of the edge: '+wrong);
});

test('lattice pieces cover the same area and none crosses a lattice line',()=>{
 const cells=[[[0.3,0.1],[5.3,0.4],[5.3,4.9],[0.3,4.2]]],step=2,origin=[.173,.119];
 const pieces=latticePieces(cells,step,origin);
 assert.ok(Math.abs(area(pieces)-area(cells))<1e-9);
 for(const p of pieces){for(const axis of [0,1]){const lo=Math.min(...p.map(v=>v[axis])),hi=Math.max(...p.map(v=>v[axis])),o=origin[axis],k=Math.floor((lo-o)/step+1e-6)+1;assert.ok(o+k*step>=hi-1e-6,'a piece spans a lattice line on axis '+axis);}}
});

test('refining to the ground splits an edge on both sides, opens no crack, and leaves a flat region alone',()=>{
 const flat=[[0,0,0],[2,0,0],[2,2,0],[0,2,0]],tris=[0,1,2,0,2,3];
 assert.deepEqual(refineToGround(flat.map(p=>p.slice()),tris.slice(),()=>0),tris);
 // a bump in the middle of the shared diagonal
 const points=[[0,0,0],[4,0,0],[4,4,0],[0,4,0]],height=(x,z)=>Math.exp(-((x-2)**2+(z-2)**2));
 points.forEach(p=>p[2]=height(p[0],p[1]));
 const refined=refineToGround(points,[0,1,2,0,2,3],height,{tolerance:.01,minEdge:.4});
 assert.ok(refined.length>6*3);
 // no T-junction: no vertex lies inside another triangle's edge
 const edges=[];for(let i=0;i<refined.length;i+=3)for(let k=0;k<3;k++)edges.push([refined[i+k],refined[i+(k+1)%3]]);
 for(const [a,b] of edges){const p=points[a],q=points[b];for(let v=0;v<points.length;v++){if(v===a||v===b)continue;const r=points[v],t=((r[0]-p[0])*(q[0]-p[0])+(r[1]-p[1])*(q[1]-p[1]))/((q[0]-p[0])**2+(q[1]-p[1])**2),d=Math.hypot(r[0]-p[0]-t*(q[0]-p[0]),r[1]-p[1]-t*(q[1]-p[1]));assert.ok(!(t>1e-6&&t<1-1e-6&&d<1e-9),'vertex '+v+' sits on the edge '+a+'-'+b);}}
 let sum=0;for(let i=0;i<refined.length;i+=3){const [a,b,c]=[refined[i],refined[i+1],refined[i+2]].map(k=>points[k]);sum+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;}
 assert.ok(Math.abs(sum-16)<1e-9,'the refined triangles still cover the square: '+sum);
});

test('a brush surface and a plaza on rolling ground: far fewer triangles, welded, the area of the definition, within 2 cm of the ground',()=>{
 const ground=(x,z)=>.15+.04*Math.sin(x*.7)*Math.cos(z*.5);
 const brush=createBrushSurface({cells:fixture.cells},{heightAt:ground}),stats=brush.userData.surfaceStats;
 assert.ok(stats.triangles<3000,'the 200 m2 path is '+stats.triangles+' triangles (it was 179,178)');
 assert.ok(brush.geometry.index&&brush.geometry.attributes.position.count<stats.triangles,'welded and indexed');
 // seen from above, the triangles cover the definition's area to 0.5 %
 const pos=brush.geometry.attributes.position,idx=brush.geometry.index;let seen=0;
 for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);seen+=Math.abs((pos.getX(b)-pos.getX(a))*(pos.getZ(c)-pos.getZ(a))-(pos.getX(c)-pos.getX(a))*(pos.getZ(b)-pos.getZ(a)))/2;}
 assert.ok(Math.abs(seen-stats.area)<stats.area*.005,'area '+seen+' vs '+stats.area);
 // height: sample inside triangles
 let worst=0;for(let i=0;i<idx.count;i+=3*7){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2),x=(pos.getX(a)+pos.getX(b)+pos.getX(c))/3,z=(pos.getZ(a)+pos.getZ(b)+pos.getZ(c))/3,y=(pos.getY(a)+pos.getY(b)+pos.getY(c))/3;worst=Math.max(worst,Math.abs(y-(ground(x,z)+.025)));}
 assert.ok(worst<.02,'the surface is '+worst+' m off the ground');
 // facing up
 brush.geometry.computeVertexNormals();const n=brush.geometry.attributes.normal;let up=0;for(let i=0;i<n.count;i++)if(n.getY(i)>0)up++;
 assert.equal(up,n.count,'every normal faces up');
 // rebuilding gives the same geometry (the restore rebuilds every surface from its definition)
 const before=Array.from(brush.geometry.attributes.position.array),again=rebuildSurface(brush,{heightAt:ground}).geometry.attributes.position.array;
 assert.deepEqual(Array.from(again),before);
 const plaza=createPlaza({polygon:[[0,0],[30,0],[30,20],[0,20]],holes:[[[10,5],[14,5],[14,9],[10,9]]]},{heightAt:ground});
 assert.ok(plaza.userData.surfaceStats.triangles<700,'plaza '+plaza.userData.surfaceStats.triangles);
 assert.ok(Math.abs(plaza.userData.surfaceStats.area-(600-16))<1e-6);
});

test('surfaces that do not follow the terrain are built as before, two triangles for a rectangle',()=>{
 const flat=createPlaza({polygon:[[0,0],[8,0],[8,6],[0,6]],conformToTerrain:false,height:.2},{heightAt:()=>0});
 assert.equal(flat.userData.surfaceStats.triangles,2);
});

test('tessellate with step 0 only dissolves',()=>{
 const {pieces,cells}=tessellate([square(0,0),square(1,0),square(2,0),square(0,1),square(1,1),square(2,1),square(0,2),square(1,2),square(2,2)],{step:0});
 assert.equal(pieces,cells);assert.ok(Math.abs(area(pieces)-9)<1e-9);
});
