/* The runtime's side of the loading protocol with the page that hosts it (/world's leaf cover).
 *
 *  runtime -> host   archipelago:hello | archipelago:progress {stage, value, step, of} | archipelago:ready | archipelago:error
 *  host -> runtime   archipelago:live      the reveal has begun: take input, focus the canvas, show the controls notice
 *                    archipelago:revealed  the leaves have parted: the frame-time governor may start measuring
 *
 * Embedded in a host (parent !== window, the public player) the runtime ignores keyboard and pointer input until
 * `live`, so nothing can drive an invisible car or open the map behind the leaves. Opened on its own (QA scripts, a
 * direct visit) and in the admin studio it is live at once. A host that never says `live` (an older page) is
 * taken to have revealed 8 s after `ready`.
 * runtime/host.js (imported first by main.js) creates the link and installs the gate before anything else can bind a key. */

/** The eight steps the host lights, in order. `cpu` is each step's share of the work that is not a download: the medians of
 * performance.measure('archipelago:<id>') over cold starts on the dev machine (load 350, build 590, restore 1300, place 40, drive 680,
 * prepare 60, compile 150, frame 300 ms; the load step counts only its parsing), rounded; they sum to 1. */
export const STEPS=[
 {id:'load',label:'Loading the island',cpu:.10},
 {id:'build',label:'Building the island and its activities',cpu:.17},
 {id:'restore',label:'Applying the saved world',cpu:.37},
 {id:'place',label:'Placing the activities',cpu:.01},
 {id:'drive',label:'Starting the car',cpu:.20},
 {id:'prepare',label:'Preparing the car and the plane',cpu:.02},
 {id:'compile',label:'Compiling materials',cpu:.05},
 {id:'frame',label:'Drawing the first frame',cpu:.08},
];
/** The share of the bar the downloads own: the bytes of everything the first frame waits for count for this much, the CPU stages for the rest. */
export const BYTES_SHARE=.5;
const clamp01=v=>v<0?0:v>1?1:v;

/** A frame has been presented (or 120 ms have passed, or the tab is hidden and none will be): the host's compositor-driven
 * indicator has had a chance to advance before the next long task. Resolving inside the frame callback is not enough: the
 * continuation would run in that very rendering update, before the frame is committed and before the host has run the message
 * just posted to it. The macrotask after the callback runs when both have happened. */
export function nextFrame(win=globalThis){
 if(win.document?.hidden)return yieldToMain();
 return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;resolve();};win.requestAnimationFrame(()=>yieldToMain().then(finish));setTimeout(finish,120);});
}
/** A macrotask turn without waiting for a frame: input and the host's messages run, the next slice follows at once. */
export const yieldToMain=(()=>{
 let channel,queue;
 return ()=>new Promise(resolve=>{
  if(typeof MessageChannel==='undefined'||typeof document==='undefined')return void setTimeout(resolve,0);
  if(!channel){channel=new MessageChannel();queue=[];channel.port1.onmessage=()=>queue.shift()?.();}
  queue.push(resolve);channel.port2.postMessage(0);
 });
})();

/** Honest, monotonic progress. `post` receives {stage, value, step, of}: only when the step changes, or the value has moved
 * 0.01 and 100 ms have passed. A step change resolves once a frame has been presented, so the host can show it before the next long task. */
export function createProgress({post,now=()=>performance.now(),frame=()=>Promise.resolve(),mark=()=>{},steps=STEPS,bytesShare=BYTES_SHARE,minDelta=.01,minGap=100}={}){
 const downloads=new Map(),total=steps.reduce((s,x)=>s+x.cpu,0)||1,entry=key=>{let d=downloads.get(key);if(!d)downloads.set(key,d={loaded:0,real:0,hint:0,total:0});return d;};
 let index=-1,inside=0,high=0,postedValue=-1,postedAt=-Infinity,postedStep=-2,finished=false;
 const byteFraction=()=>{let loaded=0,size=0;for(const d of downloads.values()){loaded+=Math.min(d.loaded,d.total);size+=d.total;}return size?loaded/size:0;};
 const cpuFraction=()=>{let done=0;for(let i=0;i<index;i++)done+=steps[i].cpu;if(index>=0)done+=steps[index].cpu*clamp01(inside);return done/total;};
 const value=()=>{if(finished)return 1;high=Math.max(high,Math.min(.99,bytesShare*byteFraction()+(1-bytesShare)*cpuFraction()));return high;};
 const send=force=>{
  const v=value(),t=now(),changed=postedStep!==index;
  if(!force&&!changed&&!(v-postedValue>=minDelta&&t-postedAt>=minGap))return false;
  postedValue=v;postedAt=t;postedStep=index;
  post({stage:index<0?steps[0].label:steps[Math.min(index,steps.length-1)].label,value:Math.round(v*1000)/1000,step:Math.max(0,index),of:steps.length});return true;
 };
 return {
  steps,
  /** Enters a step (every step before it is complete). */
  step(id){const i=steps.findIndex(s=>s.id===id);if(i<0||i<=index)return Promise.resolve();index=i;inside=0;mark(id);return send(false)?frame():Promise.resolve();},
  /** How far through the current step the work is, 0..1. */
  inside(fraction){inside=clamp01(fraction);send(false);},
  /** Bytes of one download the first frame waits for. `size` is what the response said it would be (0 when it did not say);
   * `done` closes the download at what arrived. */
  bytes(key,loaded,size=0,done=false){const d=entry(key);d.loaded=Math.max(d.loaded,loaded);if(size>0)d.real=size;if(done)d.real=d.loaded;d.total=Math.max(d.real||d.hint,d.loaded);send(false);},
  /** A download the first frame waits for is about to start: `size` is a guess until the response says. */
  expect(key,size){const d=entry(key);d.hint=size;d.total=Math.max(d.real||d.hint,d.loaded);},
  /** Everything is done. */
  finish(){finished=true;index=steps.length;send(true);},
  get value(){return value();},
  get index(){return index;},
 };
}

/** Which input the runtime refuses until it is live. Capture phase on window, registered before any game input binds. */
export const GATED_EVENTS=['keydown','keyup','keypress','pointerdown','pointerup','pointermove','pointercancel','mousedown','mouseup','mousemove','click','dblclick','auxclick','contextmenu','wheel','touchstart','touchmove','touchend','touchcancel'];
const PASSIVE=new Set(['wheel','touchstart','touchmove','touchend','touchcancel','pointermove','mousemove']);
export const HOST_FALLBACK_MS=8000;

/** The live/revealed state of this runtime inside (or outside) its host. */
export function createHostLink({win,embedded,tell=()=>{}}){
 const live={now:!embedded,reason:embedded?null:'standalone'},liveWaiters=[],revealedWaiters=[];let revealed=!embedded,timer=0,gateInstalled=false;
 const fire=list=>{for(const fn of list.splice(0))try{fn();}catch(e){console.error(e);}};
 const goLive=reason=>{if(live.now)return;live.now=true;live.reason=reason;fire(liveWaiters);};
 const goRevealed=()=>{goLive('host');if(revealed)return;revealed=true;fire(revealedWaiters);};
 const link={
  get embedded(){return embedded;},get live(){return live.now;},get liveReason(){return live.reason;},get revealed(){return revealed;},
  installGate(){
   if(!embedded||gateInstalled)return;gateInstalled=true;
   const block=event=>{if(!live.now)event.stopImmediatePropagation();};
   for(const type of GATED_EVENTS)win.addEventListener(type,block,{capture:true,passive:PASSIVE.has(type)||undefined});
  },
  listen(){
   win.addEventListener('message',event=>{
    if(event.origin!==win.location.origin||event.source!==win.parent)return;
    const type=event.data?.type;if(type==='archipelago:live')goLive('host');else if(type==='archipelago:revealed')goRevealed();
   });
  },
  /** Runs now when live, else at the host's `live`. */
  whenLive(fn){if(live.now)fn();else liveWaiters.push(fn);},
  whenRevealed(fn){if(revealed)fn();else revealedWaiters.push(fn);},
  /** The first prepared frame was presented: from here an unresponsive host is taken to have revealed. */
  ready(){if(!embedded||live.now)return;clearTimeout(timer);timer=setTimeout(()=>goLive('fallback'),HOST_FALLBACK_MS);},
  goLive,goRevealed,
 };
 return link;
}
