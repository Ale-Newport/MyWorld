/** Rendering cost only: world geometry, controls and physics stay intact. */
export class AdaptiveQuality {
 constructor(renderer,sun,{cores=navigator.hardwareConcurrency??8,memory=navigator.deviceMemory??8}={}) {
  this.renderer=renderer;this.sun=sun;this.level=cores<=2||memory<=2?2:cores<=4||memory<=4?1:0;
  this.elapsed=0;this.frames=0;this.slow=0;this.healthy=0;this.changes=0;
  this.apply();
 }
 apply(){
  // High keeps the original desktop DPR budget; pixel limits apply only
  // when hardware hints or sustained frame cost call for a lower tier.
  const caps=[1.5,1.2,.85],pixels=[Infinity,2.4e6,1.2e6],shadows=[2048,1024,512];
  const ratio=Math.min(devicePixelRatio||1,caps[this.level],Math.sqrt(pixels[this.level]/Math.max(1,innerWidth*innerHeight)));
  if(Math.abs(this.renderer.getPixelRatio()-ratio)>.01)this.renderer.setPixelRatio(ratio);
  const size=shadows[this.level];
  if(this.sun.shadow.mapSize.x!==size){this.sun.shadow.mapSize.set(size,size);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.needsUpdate=true;}
  document.body.dataset.quality=['high','medium','low'][this.level];
 }
 reset(){this.elapsed=0;this.frames=0;this.slow=0;this.healthy=0;}
 sample(ms){
  if(ms<1||ms>250){this.reset();return;}
  this.elapsed+=ms;this.frames++;if(ms>28)this.slow++;
  if(this.elapsed<3000)return;
  const struggling=this.slow/this.frames>.3,healthy=this.slow/this.frames<.02&&this.elapsed/this.frames<19;
  this.healthy=healthy?this.healthy+this.elapsed:0;
  if(struggling&&this.level<2){this.level++;this.changes++;this.apply();this.healthy=0;}
  else if(this.healthy>18000&&this.level>0){this.level--;this.changes++;this.apply();this.healthy=0;}
  this.elapsed=0;this.frames=0;this.slow=0;
 }
}
