import fs from 'node:fs';
const P=JSON.parse(fs.readFileSync(new URL('./plan.json',import.meta.url)));
export const MAP_W=420, MAP_D=315;
const X=u=>+( (u-0.5)*MAP_W ).toFixed(1), Z=v=>+( (v-0.5)*MAP_D ).toFixed(1);
const pt=([u,v])=>[X(u),Z(v)];
const out={MAP_W,MAP_D};
out.coast=P.coast.map(pt);
out.race=P.race.centreline.map(pt);
out.raceWidth=+(P.race.widthNorm*MAP_W).toFixed(1);
out.water={
  lakeWest:P.water.lakeWest.map(pt),
  lakeSouth:P.water.lakeSouth.map(pt),
  bayNorthEast:P.water.bayNorthEast.map(pt),
  bayIsland:P.water.bayIsland.map(pt),
  river:{points:P.water.landingRiver.path.map(pt), width:+(P.water.landingRiver.halfWidth*2*MAP_W).toFixed(1)},
};
out.zones={};
for(const [k,z] of Object.entries(P.zones)){
  const o={x:X(z.u),z:Z(z.v)};
  if(z.rx!=null){o.rx=+(z.rx*MAP_W).toFixed(1);o.rz=+(z.ry*MAP_D).toFixed(1);}
  if(z.r!=null)o.radius=+(z.r*MAP_W).toFixed(1);
  if(z.size!=null)o.size=+(z.size*MAP_W).toFixed(1);
  if(z.len!=null){o.length=+(z.len*MAP_W).toFixed(1);o.width=+(z.width*MAP_D).toFixed(1);}
  if(z.w!=null){o.width=+(z.w*MAP_W).toFixed(1);o.depth=+(z.h*MAP_D).toFixed(1);}
  if(z.angleDeg!=null)o.angleDeg=z.angleDeg;
  if(z.headingDeg!=null)o.headingDeg=z.headingDeg;
  if(z.u0!=null){o.from=[X(z.u0),Z(z.v0)];o.to=[X(z.u1),Z(z.v1)];o.width=+(z.width*MAP_D).toFixed(1);delete o.x;delete o.z;}
  out.zones[k]=o;
}
out.vegetation=P.vegetation.filter(v=>!v.ring).map(v=>({id:v.id,x:X(v.u),z:Z(v.v),rx:+(v.rx*MAP_W).toFixed(1),rz:+(v.ry*MAP_D).toFixed(1),density:v.density}));
out.paths=P.paths.map(p=>({id:p.id,points:p.pts.map(pt)}));
// lap length
let L=0;for(let i=0;i<out.race.length;i++){const a=out.race[i],b=out.race[(i+1)%out.race.length];L+=Math.hypot(b[0]-a[0],b[1]-a[1]);}
out.lapLength=+L.toFixed(0);
if(process.argv[2]==='json') console.log(JSON.stringify(out,null,1));
else {
  console.log(`MAP ${MAP_W} x ${MAP_D}  (x ${-MAP_W/2}..${MAP_W/2}, z ${-MAP_D/2}..${MAP_D/2})   lap=${out.lapLength} m`);
  for(const [k,z] of Object.entries(out.zones)) console.log(k.padEnd(15), JSON.stringify(z));
  console.log('--- vegetation');
  for(const v of out.vegetation) console.log(' ', v.id.padEnd(26), `x=${v.x} z=${v.z} rx=${v.rx} rz=${v.rz} d=${v.density}`);
}
fs.writeFileSync(new URL('./world-units.json',import.meta.url), JSON.stringify(out,null,1));
