import {planarBoolean,pointInPolygon,signedArea,cleanPolygon} from './roads/planar.js';

/* How a painted surface becomes triangles that follow the terrain (map-surfaces.js build()).
 *
 * planarBoolean answers with a vertical slab decomposition: every x where any outline has a vertex starts a new slab, so a brush
 * stroke that overlapped itself a thousand times comes back as ~1,700 trapezoids a few millimetres wide and 18 m tall. Splitting
 * those 4-way down to 3 m edges (the old way) made 179,000 triangles for 200 m2 of path.
 *
 *   1. dissolve   the trapezoids' shared edges cancel; what is left is the boundary of the painted region
 *   2. simplify   Douglas-Peucker on each boundary loop, at most `tolerance` metres from the painted edge; a loop that would change the
 *                 area by more than `areaTolerance` is simplified less (down to not at all)
 *   3. rebuild    planarBoolean again, from the simplified loops: a few hundred trapezoids instead of thousands
 *   4. lattice    each trapezoid is cut along the lines x = k*step and z = k*step, so every vertex is an outline vertex or a lattice
 *                 crossing, and a conforming surface follows the ground at `step` metres, as the old 3 m limit did
 * Pure geometry on [x,z] arrays: no THREE, no DOM, testable in node. */

const Q=1e7,key=(x,z)=>Math.round(x*Q)+','+Math.round(z*Q),EPS=1e-9;

/** The boundary of the union of `cells` (convex polygons, counter-clockwise, sharing vertical edges): loops with the region on their left
 * (outer loops counter-clockwise, holes clockwise). Interior edges cancel; a vertical edge that only partly meets its neighbour is split at the neighbour's vertices first. */
export function boundaryLoops(cells){
 const lines=new Map();
 for(const cell of cells)for(const [x,z] of cell){const k=Math.round(x*Q);(lines.get(k)??lines.set(k,new Set()).get(k)).add(z);}
 const sorted=new Map();for(const [k,set] of lines)sorted.set(k,[...set].sort((a,b)=>a-b));
 const edges=new Map();
 const add=(a,b)=>{if(key(...a)===key(...b))return;const forward=key(...a)+'>'+key(...b),backward=key(...b)+'>'+key(...a);if(edges.has(backward))edges.delete(backward);else edges.set(forward,[a,b]);};
 for(const cell of cells)for(let i=0;i<cell.length;i++){
  const a=cell[i],b=cell[(i+1)%cell.length];
  if(Math.abs(a[0]-b[0])<EPS){
   // A vertical edge: cut it at every vertex that lies on its line between its ends.
   const zs=sorted.get(Math.round(a[0]*Q))??[],lo=Math.min(a[1],b[1]),hi=Math.max(a[1],b[1]),up=b[1]>a[1],inside=zs.filter(z=>z>lo+EPS&&z<hi-EPS),run=[lo,...inside,hi];
   if(!up)run.reverse();
   for(let j=1;j<run.length;j++)add([a[0],run[j-1]],[a[0],run[j]]);
  }else add(a,b);
 }
 const out=new Map();
 for(const [a,b] of edges.values()){const k=key(...a);(out.get(k)??out.set(k,[]).get(k)).push({a,b,used:false});}
 const loops=[];
 for(const list of out.values())for(const first of list){
  if(first.used)continue;const loop=[];let edge=first;
  while(edge&&!edge.used){
   edge.used=true;loop.push(edge.a);
   const candidates=(out.get(key(...edge.b))??[]).filter(e=>!e.used);
   if(candidates.length<=1){edge=candidates[0];continue;}
   // A pinch point: take the sharpest left turn, which keeps the loops apart.
   const heading=Math.atan2(edge.b[1]-edge.a[1],edge.b[0]-edge.a[0]);let best=null,bestTurn=-Infinity;
   for(const c of candidates){let turn=Math.atan2(c.b[1]-c.a[1],c.b[0]-c.a[0])-heading;while(turn>Math.PI)turn-=Math.PI*2;while(turn<-Math.PI)turn+=Math.PI*2;if(turn>bestTurn){bestTurn=turn;best=c;}}
   edge=best;
  }
  if(loop.length>=3)loops.push(loop);
 }
 return loops;
}

/** Douglas-Peucker on a closed loop. */
export function simplifyLoop(loop,tolerance){
 const n=loop.length;if(n<=4||tolerance<=0)return loop;
 // Anchors: the point farthest from loop[0] and loop[0] itself.
 let far=0,best=-1;for(let i=1;i<n;i++){const d=Math.hypot(loop[i][0]-loop[0][0],loop[i][1]-loop[0][1]);if(d>best){best=d;far=i;}}
 const keep=new Uint8Array(n);keep[0]=1;keep[far]=1;
 const stack=[[0,far],[far,n]];
 while(stack.length){
  const [s,e]=stack.pop(),a=loop[s],b=loop[e%n],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);let worst=-1,at=-1;
  for(let i=s+1;i<e;i++){const p=loop[i],d=len<EPS?Math.hypot(p[0]-a[0],p[1]-a[1]):Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/len;if(d>worst){worst=d;at=i;}}
  if(worst>tolerance&&at>0){keep[at]=1;stack.push([s,at],[at,e]);}
 }
 const out=[];for(let i=0;i<n;i++)if(keep[i])out.push(loop[i]);return out;
}

/** Outer loops with the holes inside them (the smallest outer loop that contains a hole owns it). */
function groupLoops(loops){
 const outers=[],holes=[];for(const loop of loops){const a=signedArea(loop);if(Math.abs(a)<1e-9)continue;(a>0?outers:holes).push({loop,area:Math.abs(a),holes:[]});}
 for(const hole of holes){let owner=null;for(const o of outers)if(o.area>hole.area&&pointInPolygon(hole.loop[0],o.loop)&&(!owner||o.area<owner.area))owner=o;owner?.holes.push(hole.loop);}
 return outers;
}

const cellsArea=cells=>cells.reduce((s,c)=>s+Math.abs(signedArea(c)),0);

/** The same region as `cells`, as far fewer trapezoids. Falls back to `cells` themselves when no simplification keeps the area. */
export function dissolve(cells,{tolerance=.02,areaTolerance=.002}={}){
 if(cells.length<8)return cells;
 const target=cellsArea(cells),loops=boundaryLoops(cells);
 if(!loops.length)return cells;
 for(const t of [tolerance,tolerance/4,tolerance/16,0]){
  const groups=groupLoops(loops.map(l=>simplifyLoop(l,t)).filter(l=>l.length>=3)),next=[];
  for(const g of groups){const {cells:c}=planarBoolean([[g.loop],g.holes],counts=>counts[0]>0&&!counts[1]);next.push(...c);}
  if(next.length&&Math.abs(cellsArea(next)-target)<=target*areaTolerance)return next.length<cells.length?next:cells;
 }
 return cells;
}

/** Cuts a convex polygon with the line `axis`=c (0: x, 1: z); [] pieces are dropped. */
function cut(poly,axis,c){
 const left=[],right=[],n=poly.length;
 for(let i=0;i<n;i++){
  const a=poly[i],b=poly[(i+1)%n],sa=a[axis]-c,sb=b[axis]-c;
  if(sa<=EPS)left.push(a);if(sa>=-EPS)right.push(a);
  if((sa<-EPS&&sb>EPS)||(sa>EPS&&sb<-EPS)){const t=sa/(sa-sb),p=axis===0?[c,a[1]+(b[1]-a[1])*t]:[a[0]+(b[0]-a[0])*t,c];left.push(p);right.push(p);}
 }
 return [left.length>=3?left:null,right.length>=3?right:null];
}

/** Convex pieces of `cells`, none crossing a line x=origin[0]+k*step or z=origin[1]+k*step. (The origin is off the round numbers: terrain grids have their seams there.) */
export function latticePieces(cells,step,origin=[0,0]){
 const pieces=[];
 const split=(poly,axis,done)=>{
  let lo=Infinity,hi=-Infinity;for(const p of poly){lo=Math.min(lo,p[axis]);hi=Math.max(hi,p[axis]);}
  const o=origin[axis],first=Math.floor((lo-o)/step+1e-9)+1;
  for(let k=first;o+k*step<hi-1e-7;k++){
   const [a,b]=cut(poly,axis,o+k*step);
   if(!a||!b)continue;
   split(a,axis,done);split(b,axis,done);return;
  }
  done(poly);
 };
 for(const cell of cells)split(cell,0,column=>split(column,1,piece=>pieces.push(piece)));
 return pieces;
}

/** Everything build() needs: convex pieces on a lattice (or the cells as they are when `step` is 0). */
export function tessellate(cells,{step=3,tolerance=.02,origin=[0,0]}={}){
 const merged=dissolve(cells,{tolerance});
 return {pieces:step>0?latticePieces(merged,step,origin):merged,cells:merged};
}
export {cleanPolygon};

/** Splits the edges of `triangles` (index triples into `points`, each [x, z, height]) whose midpoint is off the ground by more than `tolerance`, until none is (or `rounds` ran out):
 * the same decision for both triangles that share an edge, so no crack opens; a triangle with 1, 2 or 3 split edges becomes 2, 3 or 4. `height(x, z)` is the surface's height there.
 * Edges shorter than `minEdge` are left alone. Mutates `points` (new midpoints are appended); returns the new triangle list. */
export function refineToGround(points,triangles,height,{tolerance=.01,minEdge=.5,rounds=4}={}){
 const mids=new Map(),decided=new Map();
 const mid=(a,b)=>{
  const k=a<b?a*4294967296+b:b*4294967296+a;let m=decided.get(k);
  if(m!==undefined)return m;
  const p=points[a],q=points[b];m=-1;
  if(Math.hypot(p[0]-q[0],p[1]-q[1])>=minEdge){const x=(p[0]+q[0])/2,z=(p[1]+q[1])/2,y=height(x,z);if(Math.abs(y-(p[2]+q[2])/2)>tolerance){points.push([x,z,y]);m=points.length-1;}}
  decided.set(k,m);return m;
 };
 let tris=triangles;
 for(let round=0;round<rounds;round++){
  const next=[];let split=false;
  for(let i=0;i<tris.length;i+=3){
   const a=tris[i],b=tris[i+1],c=tris[i+2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a),n=(ab>=0)+(bc>=0)+(ca>=0);
   if(!n){next.push(a,b,c);continue;}split=true;
   if(n===3)next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
   else if(n===1){if(ab>=0)next.push(a,ab,c,ab,b,c);else if(bc>=0)next.push(b,bc,a,bc,c,a);else next.push(c,ca,b,ca,a,b);}
   else{
    // two split edges: one corner triangle and a quad, cut along its shorter diagonal
    const quad=(p,q,r,s)=>{const d1=Math.hypot(points[p][0]-points[r][0],points[p][1]-points[r][1]),d2=Math.hypot(points[q][0]-points[s][0],points[q][1]-points[s][1]);if(d1<=d2)next.push(p,q,r,p,r,s);else next.push(p,q,s,q,r,s);};
    if(ab<0){next.push(c,ca,bc);quad(a,b,bc,ca);}
    else if(bc<0){next.push(a,ab,ca);quad(ab,b,c,ca);}
    else{next.push(b,bc,ab);quad(a,ab,bc,c);}
   }
  }
  tris=next;if(!split)break;
 }
 return tris;
}
