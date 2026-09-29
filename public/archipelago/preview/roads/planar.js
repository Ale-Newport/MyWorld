/** Planar polygon boolean by a vertical arrangement sweep.
 * Every crossing is an x event. Between events edge order is invariant, so
 * boolean interval runs form disjoint trapezoids (including holes). No stacked
 * triangles, raster approximation, server, or native dependency is involved.
 */
const EPS=1e-8;
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
export function signedArea(p){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1];}return a*.5;}
export function cleanPolygon(p){const a=[];for(const v of p)if(!a.length||Math.hypot(v[0]-a.at(-1)[0],v[1]-a.at(-1)[1])>EPS)a.push(v);if(a.length>2&&Math.hypot(a[0][0]-a.at(-1)[0],a[0][1]-a.at(-1)[1])<EPS)a.pop();if(signedArea(a)<0)a.reverse();return a;}
export function rectangle(a,b,width){const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<EPS)return[];const nx=-dz/l*width*.5,nz=dx/l*width*.5;return cleanPolygon([[a[0]+nx,a[1]+nz],[a[0]-nx,a[1]-nz],[b[0]-nx,b[1]-nz],[b[0]+nx,b[1]+nz]]);}
export function disc(c,r,steps=12){return Array.from({length:steps},(_,i)=>[c[0]+Math.cos(i/steps*Math.PI*2)*r,c[1]+Math.sin(i/steps*Math.PI*2)*r]);}
export function bufferPolyline(points,width,{closed=false,roundCaps=false,joinSteps=24}={}){
 const out=[],r=width*.5;for(let i=1;i<points.length;i++){const p=rectangle(points[i-1],points[i],width);if(p.length)out.push(p);}
 const end=closed?points.length-1:points.length;
 for(let i=closed?0:1;i<(closed?end:end-1);i++){
  const a=points[(i-1+end)%end],b=points[i],c=points[(i+1)%end],before=Math.atan2(b[1]-a[1],b[0]-a[0]),after=Math.atan2(c[1]-b[1],c[0]-b[0]);let turn=after-before;while(turn>Math.PI)turn-=Math.PI*2;while(turn<-Math.PI)turn+=Math.PI*2;if(Math.abs(turn)<1e-7)continue;
  const start=before+(turn>0?-Math.PI/2:Math.PI/2),steps=Math.max(1,Math.ceil(Math.abs(turn)/(Math.PI*2/joinSteps))),poly=[b];for(let k=0;k<=steps;k++){const angle=start+turn*k/steps;poly.push([b[0]+Math.cos(angle)*r,b[1]+Math.sin(angle)*r]);}out.push(cleanPolygon(poly));
 }
 if(roundCaps&&!closed){out.push(disc(points[0],r,joinSteps),disc(points.at(-1),r,joinSteps));}return out;
}
export function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
const zAt=(e,x)=>e.a[1]+(x-e.a[0])*e.dz/e.dx;
export function planarBoolean(sets,predicate=counts=>counts[0]>0){
 const polygons=[],edges=[],events=[];
 sets.forEach((set,setIndex)=>set.forEach(poly=>{const p=cleanPolygon(poly);if(p.length<3||Math.abs(signedArea(p))<EPS)return;const es=[];let minX=Infinity,maxX=-Infinity;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dz=b[1]-a[1];events.push(a[0]);minX=Math.min(minX,a[0]);maxX=Math.max(maxX,a[0]);if(Math.abs(dx)<EPS)continue;const e={a,b,dx,dz,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1]),id:edges.length};edges.push(e);es.push(e);}polygons.push({es,minX,maxX,setIndex});}));
 // Broad phase sorted x sweep. Collinear edges need no extra x events:
 // their endpoints already split coincident runs.
 const sorted=[...edges].sort((a,b)=>a.minX-b.minX),active=[];
 for(const b of sorted){for(let i=active.length-1;i>=0;i--)if(active[i].maxX<b.minX-EPS)active.splice(i,1);for(const a of active){if(a.maxZ<b.minZ-EPS||b.maxZ<a.minZ-EPS)continue;const den=cross(a.dx,a.dz,b.dx,b.dz);if(Math.abs(den)<EPS)continue;const px=b.a[0]-a.a[0],pz=b.a[1]-a.a[1],t=cross(px,pz,b.dx,b.dz)/den,u=cross(px,pz,a.dx,a.dz)/den;if(t>EPS&&t<1-EPS&&u>EPS&&u<1-EPS)events.push(a.a[0]+t*a.dx);}active.push(b);}
 events.sort((a,b)=>a-b);const xs=[];for(const x of events)if(!xs.length||x-xs.at(-1)>EPS*4)xs.push(x);
 const cells=[];let area=0;const byX=[...polygons].sort((a,b)=>a.minX-b.minX),live=[];let next=0;
 for(let i=1;i<xs.length;i++){const left=xs[i-1],right=xs[i],mid=(left+right)*.5;if(right-left<EPS)continue;while(next<byX.length&&byX[next].minX<mid)live.push(byX[next++]);for(let j=live.length-1;j>=0;j--)if(live[j].maxX<mid)live.splice(j,1);const bounds=[];
  for(const p of live){const cut=p.es.filter(e=>mid>e.minX&&mid<e.maxX).map(e=>({z:zAt(e,mid),edge:e})).sort((a,b)=>a.z-b.z);for(let j=0;j+1<cut.length;j+=2){bounds.push({...cut[j],set:p.setIndex,change:1});bounds.push({...cut[j+1],set:p.setIndex,change:-1});}}
  bounds.sort((a,b)=>a.z-b.z);const counts=sets.map(()=>0);let start=null;
  for(let j=0;j<bounds.length;){const before=predicate(counts),at=bounds[j];let k=j;while(k<bounds.length&&Math.abs(bounds[k].z-at.z)<EPS){counts[bounds[k].set]+=bounds[k].change;k++;}const after=predicate(counts);if(!before&&after)start=at.edge;else if(before&&!after&&start){const end=at.edge,p=cleanPolygon([[left,zAt(start,left)],[right,zAt(start,right)],[right,zAt(end,right)],[left,zAt(end,left)]]),a=Math.abs(signedArea(p));if(a>EPS){cells.push(p);area+=a;}start=null;}j=k;}
 }
 return {cells,area,slabs:Math.max(0,xs.length-1),inputPolygons:polygons.length};
}
export function cellsArea(cells){return cells.reduce((sum,p)=>sum+Math.abs(signedArea(p)),0);}
