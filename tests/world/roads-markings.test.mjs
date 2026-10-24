import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createRoad,createJunction,rebuildRoadNetwork,roadGeometryData,paintStrips,clipPaint} from '../../public/archipelago/preview/roads/road-system.js';
import {planarBoolean,pointInPolygon} from '../../public/archipelago/preview/roads/planar.js';
import {ROAD_PLANS} from '../../public/archipelago/preview/roads/road-plans.js';
import {MAIN_HEIGHT} from '../../public/archipelago/preview/world-config.js';
// Frozen from the build before the paint was emitted as direct strips: every mesh of the island's eleven roads,
// hashed by vertex positions + indices (rounded to 0.1 mm), with its triangle count and planar area.
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/roads-baseline.json',import.meta.url),'utf8'));
const junctionBaseline=JSON.parse(fs.readFileSync(new URL('./fixtures/junctions-baseline.json',import.meta.url),'utf8'));
const PAINT=/Lane and edge markings$/;
const PAINTED=c=>c[0]>0&&c[1]>0&&!c[2];

/** The island's roads exactly as world-map.js builds them. */
function island({defer=true}={}){
 const root=new THREE.Group();
 for(const [name,points,width,closed,type] of ROAD_PLANS){
  const o=createRoad({id:'map-'+name,points:points.map(([x,n])=>[x,MAIN_HEIGHT+.055,-n]),width,closed,type,grid:name==='Catalunya Club',conformToTerrain:false,rails:{left:name==='Catalunya Club',right:name==='Catalunya Club'}},{defer});
  o.name=name;root.add(o);
 }
 rebuildRoadNetwork(root);return root;
}
function summary(root){
 const out={};
 root.traverse(o=>{
  if(!o.isMesh)return;const g=o.geometry,p=g.attributes.position;if(!p||!p.count)return;
  let hash=0;for(let i=0;i<p.array.length;i++)hash=(hash*31+Math.round(p.array[i]*1e4))|0;
  if(g.index)for(let i=0;i<g.index.array.length;i++)hash=(hash*17+g.index.array[i])|0;
  out[(o.parent?.name||'')+' / '+o.name]={vertices:p.count,triangles:g.index?g.index.count/3:p.count/3,hash,area:+triangles(g).reduce((a,t)=>a+t.area,0).toFixed(6)};
 });
 return out;
}
/** Triangles of a generated road mesh, in the XZ plane. */
function triangles(g){
 const p=g.attributes.position,idx=g.index.array,out=[];
 for(let i=0;i<idx.length;i+=3){const a=[p.getX(idx[i]),p.getZ(idx[i])],b=[p.getX(idx[i+1]),p.getZ(idx[i+1])],c=[p.getX(idx[i+2]),p.getZ(idx[i+2])];out.push({poly:[a,b,c],area:Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2});}
 return out;
}
/** Membership of a point in a union of small polygons, through a uniform grid. */
function membership(polys,size=3){
 const cells=new Map();
 for(const poly of polys){let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of poly){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  for(let x=Math.floor(minX/size);x<=Math.floor(maxX/size);x++)for(let z=Math.floor(minZ/size);z<=Math.floor(maxZ/size);z++){const k=x+':'+z;if(!cells.has(k))cells.set(k,[]);cells.get(k).push({poly,minX,maxX,minZ,maxZ});}}
 return (x,z)=>{for(const s of cells.get(Math.floor(x/size)+':'+Math.floor(z/size))??[])if(x>=s.minX&&x<=s.maxX&&z>=s.minZ&&z<=s.maxZ&&pointInPolygon([x,z],s.poly))return true;return false;};
}
const rng=seed=>()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};

/** Compares a built road's paint with the exact boolean of the same strips: same area when no strips overlap, same coverage always. */
function comparePaint(o,random,{samples=3000,exactArea=true}={}){
 const data=roadGeometryData(o),mark=o.children.find(c=>PAINT.test(c.name));
 if(!data||!mark)return null;
 const strips=paintStrips(data),reference=planarBoolean([strips,data.polys,data.nearOthers],PAINTED),actual=triangles(mark.geometry);
 const areaActual=actual.reduce((a,t)=>a+t.area,0),inReference=membership(reference.cells),inActual=membership(actual.map(t=>t.poly));
 let mismatches=0;
 for(let i=0;i<samples&&strips.length;i++){
  const s=strips[Math.floor(random()*strips.length)],xs=s.map(p=>p[0]),zs=s.map(p=>p[1]),x=Math.min(...xs)-.1+random()*(Math.max(...xs)-Math.min(...xs)+.2),z=Math.min(...zs)-.1+random()*(Math.max(...zs)-Math.min(...zs)+.2);
  if(inReference(x,z)!==inActual(x,z))mismatches++;
 }
 // The mesh keeps float32 positions, so its area is measured to about 2e-5 of itself.
 const slack=2e-5*Math.max(1,reference.area);
 if(exactArea)assert.ok(Math.abs(areaActual-reference.area)<=slack,`${o.name}: painted area ${areaActual} vs exact ${reference.area}`);
 else assert.ok(areaActual>=reference.area-slack,`${o.name}: painted area ${areaActual} fell short of exact ${reference.area}`);
 return {area:areaActual,reference:reference.area,mismatches,strips:strips.length,triangles:actual.length,referenceCells:reference.cells.length};
}

test('the island\'s roads: every mesh but the paint is bit-identical to the build before the paint change',()=>{
 const now=summary(island());
 assert.deepEqual(Object.keys(now).sort(),Object.keys(baseline).sort());
 for(const [key,was] of Object.entries(baseline)){
  if(PAINT.test(key))continue;
  const is=now[key];
  assert.equal(is.vertices,was.vertices,key+' vertices');assert.equal(is.triangles,was.triangles,key+' triangles');assert.equal(is.hash,was.hash,key+' vertex hash');
 }
});

test('the island\'s paint covers exactly the ground it did, with a fraction of the triangles',()=>{
 const root=island(),now=summary(root),random=rng(7);let before=0,after=0,areaBefore=0,areaAfter=0;
 for(const [key,was] of Object.entries(baseline)){
  if(!PAINT.test(key))continue;
  before+=was.triangles;after+=now[key].triangles;areaBefore+=was.area;areaAfter+=now[key].area;
  assert.ok(Math.abs(now[key].area-was.area)<=2e-5*was.area,`${key}: painted area ${now[key].area} was ${was.area}`);
 }
 assert.ok(Math.abs(areaAfter-areaBefore)<2e-5*areaBefore,`total painted area ${areaAfter} vs ${areaBefore}`);
 assert.ok(after<before*.3,`paint triangles ${after} should be under 30% of ${before}`);
 let strips=0,hard=0;
 root.traverse(o=>{if(!o.userData.road_points||o.userData.proceduralDerived)return;const r=comparePaint(o,random,{samples:2500});if(!r)return;strips+=r.strips;assert.equal(r.mismatches,0,`${o.name}: ${r.mismatches} points differ in paint coverage`);hard+=r.referenceCells;});
 assert.ok(strips>1000&&hard>strips,'the comparison actually exercised the paint');
});

test('deferring the solo road build changes nothing about the network',()=>{
 const a=summary(island({defer:true})),b=summary(island({defer:false}));
 assert.deepEqual(a,b);
});

test('randomised and degenerate road networks keep the paint exactly where the exact boolean puts it',()=>{
 const random=rng(2024);let compared=0,junctionStrips=0,roadsBuilt=0;
 for(let trial=0;trial<10;trial++){
  const root=new THREE.Group(),count=2+Math.floor(random()*3);
  for(let r=0;r<count;r++){
   const n=2+Math.floor(random()*6),cx=(random()-.5)*14,cz=(random()-.5)*14,points=[];
   for(let i=0;i<n;i++)points.push([cx+(random()-.5)*60,.2,cz+(random()-.5)*60]);
   if(random()<.25&&points.length>1)points.splice(1,0,[...points[0]]);                  // duplicate control point
   if(random()<.2&&points.length>2)points[2]=[points[1][0]+(points[1][0]-points[0][0]),.2,points[1][2]+(points[1][2]-points[0][2])]; // collinear
   if(random()<.2)for(const p of points){p[0]=cx+(p[0]-cx)*.1;p[2]=cz+(p[2]-cz)*.1;}  // a loop far tighter than the road is wide
   const closed=points.length>2&&random()<.35,type=random()<.3?'race':'road';
   let o;try{o=createRoad({id:'r'+trial+'-'+r,points,width:2.5+random()*6.5,closed,type,markings:true,grid:random()<.2,rails:{left:random()<.2,right:random()<.2}},{defer:true});}catch{continue;}
   o.name='road '+trial+'.'+r;root.add(o);
  }
  if(random()<.5){const deck=new THREE.Group();deck.userData.drivableBridge=true;const mesh=new THREE.Mesh(new THREE.BoxGeometry(6+random()*8,.5,3+random()*5),new THREE.MeshBasicMaterial());mesh.name='Deck';mesh.position.set((random()-.5)*30,-.05,(random()-.5)*30);mesh.rotation.y=random()*3;deck.add(mesh);root.add(deck);}
  rebuildRoadNetwork(root);
  root.traverse(o=>{if(!o.userData.road_points||o.userData.proceduralDerived)return;roadsBuilt++;const r=comparePaint(o,random,{samples:700,exactArea:false});if(!r)return;compared++;
   assert.ok(r.mismatches<=1,`${o.name}: ${r.mismatches} of 700 sampled points differ in paint coverage`);
   // Where the centre line folds back on itself (a loop tighter than the road is wide) neighbouring strips overlap: the same
   // ground is painted twice, coplanar and in one colour. That adds area, never loses it, and never more than doubles it.
   assert.ok(r.area<=r.reference*2+1e-6,`${o.name}: painted area ${r.area} exceeds exact ${r.reference} by more than overlapped strips can explain`);
   const data=roadGeometryData(o);if(data.nearOthers.length)junctionStrips+=r.strips;});
 }
 assert.ok(roadsBuilt>=20&&compared>=15,`only ${compared} of ${roadsBuilt} roads could be compared`);
 assert.ok(junctionStrips>0,'some roads met other roads or bridge decks');
});

test('a strip that leaves the road or meets another road is cut exactly, whatever shape it has',()=>{
 const root=new THREE.Group(),o=createRoad({id:'straight',points:[[-30,.2,0],[0,.2,0],[30,.2,0]],width:6,markings:true,type:'road'},{defer:true});root.add(o);rebuildRoadNetwork(root);
 const data=roadGeometryData(o),quad=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
 const paint=[
  quad(-20,-.05,-19,.05),                       // wholly inside the asphalt: kept as it is
  quad(-10,2.5,-9,3.5),                         // straddles the edge (z = 3): cut to the half inside
  quad(5,5,6,6),                                // wholly outside: nothing
  [[12,-.05],[14,.05],[12.2,.05],[13.5,-.05]],  // a bow tie, not a quad
  quad(18,-.1,19,.1),                           // under another road's asphalt: nothing
  quad(24,-.1,25,.1),                           // beside it, but its bounding box is within reach of the other road's
 ];
 const others=[quad(17,-1,22,1),[[24.2,-2],[26,-2],[26,-1],[24.2,-1]]];
 const reference=planarBoolean([paint,data.polys,others],PAINTED),mine=clipPaint(paint,data,others);
 const area=cells=>cells.reduce((a,c)=>a+triangleArea(c),0);
 assert.ok(Math.abs(area(mine.cells)-reference.area)<1e-9,`${area(mine.cells)} vs ${reference.area}`);
 const inReference=membership(reference.cells,1),inMine=membership(mine.cells,1),random=rng(5);let wrong=0;
 for(let i=0;i<4000;i++){const x=-22+random()*50,z=-4+random()*8;if(inReference(x,z)!==inMine(x,z))wrong++;}
 assert.equal(wrong,0);
 assert.ok(reference.area>.79&&reference.area<1,`the fixture keeps one whole strip, half of another, the bow tie and the strip beside the other road (${reference.area})`);
});
function triangleArea(poly){let a=0;for(let i=0;i<poly.length;i++){const q=poly[(i+1)%poly.length];a+=poly[i][0]*q[1]-q[0]*poly[i][1];}return Math.abs(a)/2;}

test('the editor library\'s junction presets keep every mesh but the paint bit-identical, and the paint\'s ground',()=>{
 for(const [kind,was] of Object.entries(junctionBaseline)){
  const now=summary(createJunction(kind,{width:7,length:24,radius:12,height:.055}));
  assert.deepEqual(Object.keys(now).sort(),Object.keys(was).sort(),kind);
  for(const [key,before] of Object.entries(was)){
   if(PAINT.test(key)){assert.ok(Math.abs(now[key].area-before.area)<=2e-5*before.area+1e-6,`${kind} ${key}: painted area ${now[key].area} was ${before.area}`);continue;}
   assert.equal(now[key].hash,before.hash,`${kind} ${key} vertex hash`);assert.equal(now[key].triangles,before.triangles,`${kind} ${key} triangles`);
  }
 }
});
