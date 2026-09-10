import fs from 'node:fs';
const P=JSON.parse(fs.readFileSync(new URL('./plan.json',import.meta.url)));
const W=78,H=40;
const g=Array.from({length:H},()=>Array(W).fill(' '));
const put=(u,v,ch)=>{const x=Math.round(u*(W-1)),y=Math.round(v*(H-1));if(x>=0&&x<W&&y>=0&&y<H)g[y][x]=ch;};
const line=(a,b,ch)=>{const n=Math.max(2,Math.ceil(Math.hypot((b[0]-a[0])*W,(b[1]-a[1])*H)*2));for(let i=0;i<=n;i++)put(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,ch);};
const poly=(pts,ch,close=true)=>{for(let i=0;i<pts.length-(close?0:1);i++)line(pts[i],pts[(i+1)%pts.length],ch);};
const fill=(pts,ch)=>{for(let y=0;y<H;y++)for(let x=0;x<W;x++){const u=x/(W-1),v=y/(H-1);let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const [xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>v)!==(yj>v)&&u<(xj-xi)*(v-yi)/(yj-yi)+xi)inside=!inside;}if(inside)g[y][x]=ch;}};
// land
fill(P.coast,'.');
// vegetation
for(const z of P.vegetation){ if(z.ring)continue; for(let y=0;y<H;y++)for(let x=0;x<W;x++){const u=x/(W-1),v=y/(H-1);if(((u-z.u)/z.rx)**2+((v-z.v)/z.ry)**2<=1)g[y][x]='"';}}
// water
for(const k of ['lakeWest','lakeSouth','bayNorthEast']) fill(P.water[k],'~');
{const p=P.water.landingRiver.path;for(let i=0;i<p.length-1;i++){const n=40;for(let t=0;t<=n;t++){const u=p[i][0]+(p[i+1][0]-p[i][0])*t/n,v=p[i][1]+(p[i+1][1]-p[i][1])*t/n;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)put(u+dx/W,v+dy/H,'~');}}}
// paths
for(const p of P.paths) poly(p.pts,':',false);
// race
poly(P.race.centreline,'#');
// zones
const Z=P.zones;
const tag=(u,v,t)=>{const x=Math.round(u*(W-1))-Math.floor(t.length/2),y=Math.round(v*(H-1));for(let i=0;i<t.length;i++){const xx=x+i;if(xx>=0&&xx<W&&y>=0&&y<H)g[y][xx]=t[i];}};
tag(Z.blackHole.u,Z.blackHole.v,'[BH]');
tag(Z.achievements.u,Z.achievements.v,'[ACHV]');
tag(Z.tnt.u,Z.tnt.v,'[TNT]');
tag(Z.raceStart.u,Z.raceStart.v+0.012,'[START]');
tag(Z.bowling.u,Z.bowling.v,'====[BOWLING]====');
tag(Z.social.u,Z.social.v,'[SOCIAL]');
tag(Z.bridge.u,Z.bridge.v,'[BRG]');
tag(Z.landing.u,Z.landing.v,'[LANDING]');
tag(Z.nameLetters.u,Z.nameLetters.v,'ALEJANDRO');
tag(Z.projects.u,Z.projects.v,'[PROJECTS]');
tag(Z.ramp.u,Z.ramp.v,'[RAMP>>]');
tag(Z.timeMachine.u,Z.timeMachine.v,'[TIME]');
tag(Z.maze.u,Z.maze.v,'[MAZE]');
const out=g.map(r=>r.join('').replace(/\s+$/,'')).join('\n');
fs.writeFileSync(new URL('./ascii.txt',import.meta.url), out+'\n');
console.log(out);
