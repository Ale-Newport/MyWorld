import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roadSampler} from '../../public/archipelago/preview/roads/nearest-road.js';
function linear(samples,x,z){let best={distance:Infinity};for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i],dx=b.p.x-a.p.x,dz=b.p.z-a.p.z,t=Math.max(0,Math.min(1,((x-a.p.x)*dx+(z-a.p.z)*dz)/(dx*dx+dz*dz||1))),px=a.p.x+dx*t,pz=a.p.z+dz*t,d=Math.hypot(x-px,z-pz);if(d<best.distance){const len=Math.hypot(dx,dz)||1;best={distance:d,s:a.s+(b.s-a.s)*t,y:(1-t)*a.p.y+t*b.p.y,lateral:((x-px)*-dz+(z-pz)*dx)/len,tx:dx/len,tz:dz/len};}}return best;}
test('spatial road lookup preserves distance, height, UVs and tangent on curved, closed and crossing roads',()=>{
 const shapes=[Array.from({length:501},(_,i)=>({p:{x:Math.cos(i/500*Math.PI*2)*80,y:Math.sin(i*.05)*3,z:Math.sin(i/500*Math.PI*2)*60},s:i})),Array.from({length:301},(_,i)=>({p:{x:Math.sin(i/50)*80,y:i*.01,z:Math.sin(i/25)*40},s:i}))];
 for(const samples of shapes){const query=roadSampler(samples);for(let i=0;i<1600;i++){const x=Math.sin(i*17.31)*140,z=Math.cos(i*8.33)*100,a=query(x,z),b=linear(samples,x,z);for(const k of Object.keys(b))assert.ok(Math.abs(a[k]-b[k])<1e-7,`${k}: ${a[k]} vs ${b[k]}`);}}
});
test('degenerate segments and equal-distance ties retain authored segment order',()=>{const s=[{p:{x:0,y:2,z:0},s:0},{p:{x:0,y:2,z:0},s:0},{p:{x:4,y:2,z:0},s:4},{p:{x:0,y:8,z:0},s:8}];assert.deepEqual(roadSampler(s)(2,1),linear(s,2,1));});
