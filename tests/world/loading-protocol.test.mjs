import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STEPS,BYTES_SHARE,GATED_EVENTS,HOST_FALLBACK_MS,createProgress,createHostLink,nextFrame,yieldToMain} from '../../public/archipelago/preview/runtime/loading.js';
import {AdaptiveQuality} from '../../public/archipelago/preview/runtime/quality.js';

/** A window with capture-order listeners and dispatch(), enough for the gate and the host messages. */
function fakeWindow(){
 const listeners=[],parent={};
 return {location:{origin:'https://site.test'},parent,listeners,
  addEventListener(type,fn,options){listeners.push({type,fn,options});},
  dispatch(type,event={}){let stopped=false;const e={type,stopImmediatePropagation(){stopped=true;},...event};for(const l of listeners.filter(l=>l.type===type)){if(stopped)break;l.fn(e);}return {stopped};},
  parent};
}
const clock=()=>{let t=0;return {now:()=>t,advance:ms=>{t+=ms;}};};

test('there are eight steps whose shares of the CPU work sum to one, and main.js enters exactly those',()=>{
 assert.equal(STEPS.length,8);assert.equal(new Set(STEPS.map(s=>s.id)).size,8);
 assert.ok(Math.abs(STEPS.reduce((s,x)=>s+x.cpu,0)-1)<1e-9,'cpu shares sum to 1');
 assert.ok(BYTES_SHARE>0&&BYTES_SHARE<1);
 const main=fs.readFileSync(new URL('../../public/archipelago/preview/main.js',import.meta.url),'utf8');
 const entered=[...main.matchAll(/stage\('([a-z]+)'\)/g)].map(m=>m[1]);
 assert.deepEqual([...new Set(entered)].sort(),STEPS.map(s=>s.id).sort(),'every step is entered by main.js, none else');
});

test('progress: posts only on a step change, or a 0.01 move after 100 ms; every post carries stage, value, step and of',async()=>{
 const posts=[],c=clock();let frames=0;
 const p=createProgress({post:m=>posts.push(m),now:c.now,frame:()=>{frames++;return Promise.resolve();}});
 await p.step('load');assert.equal(posts.length,1);assert.deepEqual(posts[0],{stage:STEPS[0].label,value:0,step:0,of:8});assert.equal(frames,1);
 p.expect('doc',1000);
 p.bytes('doc',20,1000);c.advance(500);assert.equal(posts.length,1,'a 0.001 move is not posted');
 c.advance(0);p.bytes('doc',300,1000);assert.equal(posts.length,2,'0.15 of the bytes at half the bar, 500 ms after the last post');
 p.bytes('doc',400,1000);assert.equal(posts.length,2,'0.05 more, but the last post was 0 ms ago');
 c.advance(99);p.bytes('doc',410,1000);assert.equal(posts.length,2,'99 ms is not enough');
 c.advance(2);p.bytes('doc',420,1000);assert.equal(posts.length,3,'0.1 s and 0.01 later: posted');
 await p.step('build');assert.equal(posts.length,4,'a step change always posts');assert.equal(posts.at(-1).step,1);assert.equal(frames,2,'and waits for a presented frame');
 await p.step('build');assert.equal(posts.length,4,'entering the current step again is nothing');
 for(const m of posts)assert.deepEqual(Object.keys(m),['stage','value','step','of']);
 assert.ok(posts.every((m,i)=>i===0||m.value>=posts[i-1].value),'monotonic');
});

test('progress: honest and monotonic: bytes while downloading, the measured CPU shares after, never above .99 before finish',async()=>{
 const posts=[],c=clock();const p=createProgress({post:m=>posts.push(m),now:c.now});
 await p.step('load');
 p.expect('island',5e6);p.expect('doc',15e6);p.bytes('island',5e6,5e6,true);
 const quarter=BYTES_SHARE*(5e6/20e6);assert.ok(Math.abs(p.value-quarter)<1e-9,`only the island arrived: ${p.value}`);
 // A guess that turns out too small (the response says 30 MB) must not make the bar go back.
 const high=p.value;p.bytes('doc',1e6,30e6);assert.ok(p.value>=high,'the bar never goes back when a size is learnt');
 p.bytes('doc',30e6,30e6,true);
 for(const s of STEPS.slice(1))await p.step(s.id);
 assert.ok(p.value<=.99,`not 1 before finish (${p.value})`);
 const cpuDone=STEPS.slice(0,-1).reduce((s,x)=>s+x.cpu,0);
 assert.ok(p.value>=BYTES_SHARE+(1-BYTES_SHARE)*cpuDone-1e-9,'all the bytes and every step but the last are in');
 p.inside(.5);assert.ok(p.value>=BYTES_SHARE+(1-BYTES_SHARE)*(cpuDone+STEPS.at(-1).cpu*.5)-1e-9);
 p.finish();assert.equal(p.value,1);assert.equal(posts.at(-1).value,1);assert.equal(posts.at(-1).step,8);
 assert.ok(posts.every((m,i)=>i===0||m.value>=posts[i-1].value&&m.step>=posts[i-1].step));
});

test('progress: a hint is replaced by the real size and a finished download counts as complete',()=>{
 const p=createProgress({post(){}});
 p.expect('doc',17e6);p.bytes('doc',1e6,4e6);p.bytes('doc',4e6,0,true);
 assert.ok(Math.abs(p.value-BYTES_SHARE)<1e-9,`all of the (one) download arrived, no CPU yet: ${p.value}`);
});

test('the input gate: embedded, game input is stopped in the capture phase until the host says live',()=>{
 const win=fakeWindow(),host=createHostLink({win,embedded:true});host.installGate();host.installGate();
 assert.equal(win.listeners.length,GATED_EVENTS.length,'installed once per event');
 assert.ok(win.listeners.every(l=>l.options.capture===true),'capture phase');
 assert.ok(win.listeners.filter(l=>['wheel','touchstart','touchmove','pointermove'].includes(l.type)).every(l=>l.options.passive===true),'scrolling input stays passive');
 for(const type of ['keydown','keyup','pointerdown','click','wheel','touchstart','contextmenu'])assert.equal(win.dispatch(type).stopped,true,`${type} is stopped before live`);
 assert.equal(host.live,false);
 host.goLive('host');
 for(const type of ['keydown','pointerdown','click'])assert.equal(win.dispatch(type).stopped,false,`${type} passes once live`);
});

test('the input gate: opened on its own, or in the studio, nothing is gated and the runtime is live at once',()=>{
 const win=fakeWindow(),host=createHostLink({win,embedded:false});host.installGate();
 assert.equal(win.listeners.length,0);assert.equal(host.live,true);assert.equal(host.liveReason,'standalone');assert.equal(host.revealed,true);
 let ran=0;host.whenLive(()=>ran++);host.whenRevealed(()=>ran++);assert.equal(ran,2,'callbacks run at once');
});

test('host messages: live and revealed from the parent window only, in this origin',()=>{
 const win=fakeWindow(),host=createHostLink({win,embedded:true});host.listen();
 const order=[];host.whenLive(()=>order.push('live'));host.whenRevealed(()=>order.push('revealed'));
 win.dispatch('message',{origin:'https://evil.test',source:win.parent,data:{type:'archipelago:live'}});
 win.dispatch('message',{origin:win.location.origin,source:{},data:{type:'archipelago:live'}});
 win.dispatch('message',{origin:win.location.origin,source:win.parent,data:{type:'archipelago:other'}});
 assert.equal(host.live,false,'a stranger, a sibling frame or another message does nothing');
 win.dispatch('message',{origin:win.location.origin,source:win.parent,data:{type:'archipelago:live'}});
 assert.deepEqual([host.live,host.revealed,host.liveReason],[true,false,'host']);assert.deepEqual(order,['live']);
 win.dispatch('message',{origin:win.location.origin,source:win.parent,data:{type:'archipelago:revealed'}});
 assert.deepEqual([host.revealed,order],[true,['live','revealed']]);
 win.dispatch('message',{origin:win.location.origin,source:win.parent,data:{type:'archipelago:revealed'}});assert.deepEqual(order,['live','revealed'],'callbacks run once');
});

test('an old host that never says live is taken to have revealed 8 s after ready',(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const win=fakeWindow(),host=createHostLink({win,embedded:true});host.listen();
 host.ready();t.mock.timers.tick(HOST_FALLBACK_MS-1);assert.equal(host.live,false);
 t.mock.timers.tick(1);assert.equal(host.live,true);assert.equal(host.liveReason,'fallback');
 const timely=createHostLink({win:fakeWindow(),embedded:true});timely.ready();timely.goLive('host');t.mock.timers.tick(HOST_FALLBACK_MS);assert.equal(timely.liveReason,'host','a live that came is not overwritten');
});

test('nextFrame: resolves after the frame callback and a macrotask, after 120 ms without a frame, and at once in a hidden tab',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let callback=null;const win={document:{hidden:false},requestAnimationFrame:fn=>{callback=fn;}};
 let done=false;const waiting=nextFrame(win).then(()=>{done=true;});
 await Promise.resolve();assert.equal(done,false,'not before the frame');
 callback();await Promise.resolve();assert.equal(done,false,'nor inside the frame callback: the host has not run yet');
 t.mock.timers.tick(0);await waiting;assert.equal(done,true);
 let stalled=false;const noFrame=nextFrame({document:{hidden:false},requestAnimationFrame(){}}).then(()=>{stalled=true;});
 t.mock.timers.tick(119);await Promise.resolve();assert.equal(stalled,false);t.mock.timers.tick(1);await noFrame;assert.equal(stalled,true,'a frame that never comes costs 120 ms');
 let hidden=false;const away=nextFrame({document:{hidden:true},requestAnimationFrame(){throw Error('no frame in a hidden tab');}}).then(()=>{hidden=true;});
 t.mock.timers.tick(0);await away;assert.equal(hidden,true,'a hidden tab does not wait for a frame or a throttled timer');
 let turns=0;const first=yieldToMain().then(()=>turns++),second=yieldToMain().then(()=>turns++);t.mock.timers.tick(0);await Promise.all([first,second]);assert.equal(turns,2);
});

test('the quality governor ignores every frame until released, and starts its first window clean',()=>{
 globalThis.devicePixelRatio=2;globalThis.innerWidth=1440;globalThis.innerHeight=900;globalThis.document={body:{dataset:{}}};
 const renderer={ratio:1.5,getPixelRatio(){return this.ratio},setPixelRatio(v){this.ratio=v}},sun={shadow:{mapSize:{x:2048,set(x,y){this.x=x;this.y=y}},map:null}};
 const q=new AdaptiveQuality(renderer,sun,{cores:8,memory:8});
 q.hold();for(let i=0;i<400;i++)q.sample(60);
 assert.equal(q.level,0,'a parting full of slow frames demotes nothing');assert.equal(q.elapsed,0);assert.equal(renderer.ratio,1.5);
 q.release();assert.equal(q.held,false);for(let i=0;i<10;i++)q.sample(16);assert.equal(q.frames,10,'sampling starts at the release');
 for(let i=0;i<160;i++)q.sample(40);assert.equal(q.level,2,'and still responds to sustained cost');
});
