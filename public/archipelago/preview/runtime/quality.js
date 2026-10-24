/** Rendering cost only: world geometry, controls and physics stay intact.
 *
 * Two axes. `level` (0 high, 1 medium, 2 low) is the GPU's: the pixel ratio, the pixel budget and the shadow map's size.
 * `cpu` (0, 1, 2) is the main thread's, for a device that is slow in draw calls and scene work, which fewer pixels do not help:
 * 1 draws the shadow map at half rate, drops the smallest casters and the far grass; 2 turns the sun's shadow off and stops the grass swaying
 * and the far animations. Which axis a slow window moves depends on how much of each frame the main thread spent (`sample(ms, cpuMs)`). */
/** Which animation frames draw when the render rate is capped (a touch screen, the governor's level 1 and up).
 *
 * A cap is a whole number of display refreshes between two draws, never a time: `every` is the largest N that keeps the rate at 60 or above (a 60, 72, 75, 90 or 100 Hz screen draws every
 * refresh, a 120 or 144 Hz one every second, 240 Hz every fourth), and a draw is due once N-1/2 refreshes have passed since the last one. That leaves half a refresh of slack on both
 * sides of every decision, so no timestamp jitter can decide it. (The test this replaces, `gap < cap - refresh/2`, was a tie at exactly 90 Hz: 11.11 ms against 11.11 ms, so the frames came as a mix of
 * 11 and 22 ms.) The refresh is measured over blocks of vsyncs, a mean in which the jitter of the timestamps cancels at the ends, and a late frame that skipped k-1 refreshes counts as k. */
export const FRAME_CAP_FPS=60,PACER_TOLERANCE=.05;
export class FramePacer{
 constructor(){this.refresh=1000/FRAME_CAP_FPS;this.every=1;this.raf=0;this.drawn=-Infinity;this.span=0;this.ticks=0;this.blocks=0;this.odd=0;this.oddGap=0;}
 /** First thing in every requestAnimationFrame callback. */
 observe(now){
  const last=this.raf;this.raf=now;if(!last)return;
  const gap=now-last;if(gap<=.5||gap>=100)return;
  const ratio=gap/this.refresh,k=Math.max(1,Math.round(ratio));
  if(Math.abs(ratio-k)>.25){
   // Not a whole number of the refreshes measured so far. A late frame is one; a display that changed its rate (a phone's adaptive refresh, a power mode, another monitor) is not: three such gaps alike in a row are the new refresh.
   this.odd=this.odd>0&&Math.abs(gap-this.oddGap)<=.06*gap?this.odd+1:1;this.oddGap=gap;
   if(this.odd>=3){this.refresh=gap;this.span=this.ticks=0;this.odd=0;this.blocks++;}
   return;
  }
  this.odd=0;this.span+=gap;this.ticks+=k;
  if(this.ticks>=(this.blocks?30:12)){this.refresh=this.span/this.ticks;this.span=this.ticks=0;this.blocks++;}
 }
 /** Whether the callback at `now` draws, under a cap of `cap` ms between draws (0: none). */
 draw(now,cap=0){
  if(cap>0){
   this.every=Math.max(1,Math.floor(cap/this.refresh+PACER_TOLERANCE));
   if(now-this.drawn<(this.every-.5)*this.refresh)return false;
  }
  this.drawn=now;return true;
 }
}
const PIXELS=[5e6,2.4e6,1.2e6],CAPS=[1.5,1.2,.85],SHADOWS=[2048,1024,512];
/** The pixel budget at level 0 holds the first seconds of a canvas bigger than this (a 4K screen with 4x MSAA): a smaller one (2560x1440 at 1.5, 8.3 Mpx) starts at its full ratio, so nothing re-samples later. */
const BUDGET_ABOVE=8.6e6;
export class AdaptiveQuality{
 constructor(renderer,sun,{cores=navigator.hardwareConcurrency??8,memory=navigator.deviceMemory??8,rig=null,onCpu=null}={}) {
  this.renderer=renderer;this.sun=sun;this.rig=rig;this.onCpu=onCpu;this.level=cores<=2||memory<=2?2:cores<=4||memory<=4?1:0;this.cpu=0;
  this.elapsed=0;this.frames=0;this.slow=0;this.healthy=0;this.changes=0;this.cpuElapsed=0;this.cpuFrames=0;
  // Level 0 starts under a pixel budget on a canvas over BUDGET_ABOVE (the governor needs seconds to notice a struggling 4K one): a healthy window lifts it.
  this.budgeted=true;this.calm=0;
  this.apply();
 }
 apply(){
  // High keeps the original desktop DPR budget; pixel limits apply only
  // when hardware hints or sustained frame cost call for a lower tier.
  const full=Math.min(devicePixelRatio||1,CAPS[0]),pixels=this.level===0?(!this.budgeted||innerWidth*innerHeight*full*full<=BUDGET_ABOVE?Infinity:PIXELS[0]):PIXELS[this.level];
  const ratio=Math.min(devicePixelRatio||1,CAPS[this.level],Math.sqrt(pixels/Math.max(1,innerWidth*innerHeight)));
  if(Math.abs(this.renderer.getPixelRatio()-ratio)>.01)this.renderer.setPixelRatio(ratio);
  const size=SHADOWS[this.level];
  if(this.sun.shadow.mapSize.x!==size){this.sun.shadow.mapSize.set(size,size);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.needsUpdate=true;}
  this.rig?.setSize(size);
  document.body.dataset.quality=['high','medium','low'][this.level];
 }
 /** The main thread's tier: what each tier turns down is for main.js (onCpu) and the shadow rig. */
 setCpu(tier){
  tier=Math.max(0,Math.min(2,tier));if(tier===this.cpu)return;this.cpu=tier;
  this.rig?.setEvery(tier===1?2:1);this.rig?.setOff(tier>=2);
  this.onCpu?.(tier);document.body.dataset.cpuTier=String(tier);
 }
 reset(){this.elapsed=0;this.frames=0;this.slow=0;this.healthy=0;this.cpuElapsed=0;this.cpuFrames=0;this.calm=0;}
 /** Embedded in /world the first frames are drawn while the cover's leaves part and the GPU composites them too: hold() ignores every sample
  * until release(), which the host's `revealed` calls, and which starts the first window clean. */
 hold(){this.held=true;this.reset();}
 release(){this.held=false;this.reset();}
 sample(ms,cpuMs){
  if(this.held)return;
  if(ms<1||ms>250){this.reset();return;}
  this.elapsed+=ms;this.frames++;if(ms>28)this.slow++;if(cpuMs!==undefined){this.cpuElapsed+=cpuMs;this.cpuFrames++;}
  if(this.elapsed<3000)return;
  const struggling=this.slow/this.frames>.3,healthy=this.slow/this.frames<.02&&this.elapsed/this.frames<19;
  this.healthy=healthy?this.healthy+this.elapsed:0;
  // CPU-bound: the main thread spent most of every frame (draw submission, scene graph, JS) and the frames were slow anyway.
  const cpuBound=this.cpuFrames>20&&this.cpuElapsed/this.cpuFrames>.55*this.elapsed/this.frames;
  if(this.budgeted&&this.level===0&&!struggling){if(healthy&&++this.calm>=1){this.budgeted=false;this.apply();}}
  if(struggling){
   this.calm=0;
   if(cpuBound&&this.cpu<2){this.setCpu(this.cpu+1);this.changes++;this.healthy=0;}
   else if(this.level<2){this.level++;this.changes++;this.budgeted=true;this.apply();this.healthy=0;}
   else if(this.cpu<2){this.setCpu(this.cpu+1);this.changes++;this.healthy=0;}
  }
  else if(this.healthy>18000&&(this.level>0||this.cpu>0)){if(this.cpu>0)this.setCpu(this.cpu-1);else{this.level--;this.apply();}this.changes++;this.healthy=0;}
  this.elapsed=0;this.frames=0;this.slow=0;this.cpuElapsed=0;this.cpuFrames=0;
 }
}
