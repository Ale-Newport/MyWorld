import sharp from 'sharp';
import fs from 'node:fs';
const S='/private/tmp/claude-501/-Users-alejandro-Projects-Portfolio/c0fcbb6f-acee-4860-9aa4-058322b578c4/scratchpad/';
const P=JSON.parse(fs.readFileSync(new URL('./plan.json',import.meta.url)));
const W=1200,H=900; const X=u=>(u*W).toFixed(1), Y=v=>(v*H).toFixed(1);
const poly=(pts,attr)=>`<polygon points="${pts.map(p=>`${X(p[0])},${Y(p[1])}`).join(' ')}" ${attr}/>`;
const pl=(pts,attr)=>`<polyline points="${pts.map(p=>`${X(p[0])},${Y(p[1])}`).join(' ')}" fill="none" ${attr}/>`;
let s='';
s+=poly(P.coast,'fill="none" stroke="#00e5ff" stroke-width="4" stroke-dasharray="10 6"');
// race
const c=P.race.centreline;
s+=pl([...c,c[0]],`stroke="#ff00ff" stroke-width="${P.race.widthNorm*W}" opacity="0.35" stroke-linejoin="round" stroke-linecap="round"`);
s+=pl([...c,c[0]],'stroke="#ff00ff" stroke-width="3"');
c.forEach((p,i)=>{ if(i%6===0) s+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4" fill="#ff00ff"/><text x="${X(p[0])+5}" y="${Y(p[1])-5}" fill="#ff00ff" font-size="13" font-weight="bold">${i}</text>`;});
// water
for(const k of ['lakeWest','lakeSouth','bayNorthEast','bayIsland']) s+=poly(P.water[k],'fill="#0080ff" fill-opacity="0.35" stroke="#0040ff" stroke-width="3"');
s+=pl(P.water.landingRiver.path,`stroke="#0080ff" stroke-width="${P.water.landingRiver.halfWidth*2*W}" opacity="0.4" stroke-linecap="round"`);
s+=pl(P.water.landingRiver.path,'stroke="#0040ff" stroke-width="2.5"');
// paths
for(const p of P.paths){ s+=pl(p.pts,'stroke="#b05000" stroke-width="9" opacity="0.55" stroke-linecap="round"'); s+=pl(p.pts,'stroke="#7a3000" stroke-width="2"'); }
// vegetation
for(const z of P.vegetation){ if(z.ring) continue; s+=`<ellipse cx="${X(z.u)}" cy="${Y(z.v)}" rx="${z.rx*W}" ry="${z.ry*H}" fill="#00c000" fill-opacity="0.28" stroke="#008000" stroke-width="2"/><text x="${X(z.u)}" y="${Y(z.v)}" fill="#004400" font-size="12" text-anchor="middle" font-weight="bold">${z.id}</text>`;}
// zones
const Z=P.zones; const lab=(u,v,t,col='#000')=>`<text x="${X(u)}" y="${Y(v)}" fill="${col}" font-size="16" font-weight="bold" text-anchor="middle" stroke="#fff" stroke-width="3" paint-order="stroke">${t}</text>`;
const box=(u,v,w2,h2,col,rot=0)=>`<rect x="${X(u)-w2*W/2}" y="${Y(v)-h2*H/2}" width="${w2*W}" height="${h2*H}" fill="none" stroke="${col}" stroke-width="3" transform="rotate(${rot} ${X(u)} ${Y(v)})"/>`;
s+=`<ellipse cx="${X(Z.landing.u)}" cy="${Y(Z.landing.v)}" rx="${Z.landing.rx*W}" ry="${Z.landing.ry*H}" fill="#ffffff" fill-opacity="0.25" stroke="#ff0000" stroke-width="3"/>`+lab(Z.landing.u,Z.landing.v,'LANDING');
s+=box(Z.nameLetters.u,Z.nameLetters.v,Z.nameLetters.w,Z.nameLetters.h,'#111')+lab(Z.nameLetters.u,Z.nameLetters.v-0.03,'NAME');
s+=box(Z.bridge.u,Z.bridge.v,Z.bridge.len,Z.bridge.width,'#8B4513',Z.bridge.angleDeg)+lab(Z.bridge.u,Z.bridge.v-0.03,'BRIDGE','#8B4513');
s+=`<ellipse cx="${X(Z.social.u)}" cy="${Y(Z.social.v)}" rx="${Z.social.rx*W}" ry="${Z.social.ry*H}" fill="none" stroke="#ff0000" stroke-width="3"/>`+lab(Z.social.u,Z.social.v,'SOCIAL');
s+=`<ellipse cx="${X(Z.bowling.u)}" cy="${Y(Z.bowling.v)}" rx="${Z.bowling.rx*W}" ry="${Z.bowling.ry*H}" fill="none" stroke="#ff0000" stroke-width="3"/>`+lab(Z.bowling.u,Z.bowling.v+0.055,'BOWLING');
const L=Z.bowlingLane; s+=pl([[L.u0,L.v0],[L.u1,L.v1]],`stroke="#ff8800" stroke-width="${L.width*H}" opacity="0.6"`);
s+=`<circle cx="${X(Z.bowlingScreen.u)}" cy="${Y(Z.bowlingScreen.v)}" r="9" fill="#ff8800"/><text x="${X(Z.bowlingScreen.u)+10}" y="${Y(Z.bowlingScreen.v)}" font-size="13" fill="#ff4400" font-weight="bold">SCREEN</text>`;
s+=`<ellipse cx="${X(Z.projects.u)}" cy="${Y(Z.projects.v)}" rx="${Z.projects.rx*W}" ry="${Z.projects.ry*H}" fill="none" stroke="#ff0000" stroke-width="3"/>`+lab(Z.projects.u,Z.projects.v,'PROJECTS');
s+=box(Z.ramp.u,Z.ramp.v,Z.ramp.len,Z.ramp.width,'#ff0000',Z.ramp.headingDeg)+lab(Z.ramp.u,Z.ramp.v-0.03,'RAMP');
s+=`<circle cx="${X(Z.timeMachine.u)}" cy="${Y(Z.timeMachine.v)}" r="${Z.timeMachine.r*W}" fill="none" stroke="#ccaa00" stroke-width="3"/>`+lab(Z.timeMachine.u,Z.timeMachine.v-0.04,'TIME');
s+=box(Z.maze.u,Z.maze.v,Z.maze.size,Z.maze.size*W/H,'#ff0000',Z.maze.angleDeg)+lab(Z.maze.u,Z.maze.v,'MAZE');
s+=`<ellipse cx="${X(Z.achievements.u)}" cy="${Y(Z.achievements.v)}" rx="${Z.achievements.rx*W}" ry="${Z.achievements.ry*H}" fill="none" stroke="#ff6600" stroke-width="3"/>`+lab(Z.achievements.u,Z.achievements.v,'ACHV');
s+=`<circle cx="${X(Z.blackHole.u)}" cy="${Y(Z.blackHole.v)}" r="${Z.blackHole.r*W}" fill="none" stroke="#000" stroke-width="3"/>`+lab(Z.blackHole.u,Z.blackHole.v-0.045,'BLACKHOLE');
s+=`<ellipse cx="${X(Z.tnt.u)}" cy="${Y(Z.tnt.v)}" rx="${Z.tnt.rx*W}" ry="${Z.tnt.ry*H}" fill="none" stroke="#cc0000" stroke-width="3"/>`+lab(Z.tnt.u,Z.tnt.v,'TNT','#cc0000');
s+=`<circle cx="${X(Z.raceStart.u)}" cy="${Y(Z.raceStart.v)}" r="10" fill="#ff00ff"/>`+lab(Z.raceStart.u+0.03,Z.raceStart.v+0.02,'S/F','#ff00ff');
const svg=Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`);
await sharp(S+'map_rect.png').composite([{input:svg,top:0,left:0}]).png().toFile(S+'overlay.png');
// also on flat
await sharp(S+'m_flat.png').composite([{input:svg,top:0,left:0}]).png().toFile(S+'overlay_flat.png');
console.log('ok');
