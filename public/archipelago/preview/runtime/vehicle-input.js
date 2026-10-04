/** One handler owns SPACE. A press hops the car at once; a second press
 * inside the window turns car ↔ plane. Held or auto-repeated keys never
 * produce a second press: only a release re-arms it. Braking is B / Ctrl. */
export class VehicleInput {
 constructor(inputs,onToggle,now=()=>performance.now(),onTap=()=>{}){
  this.inputs=inputs;this.onToggle=onToggle;this.onTap=onTap;this.now=now;this.pending=null;this.spaceDown=false;this.windowMs=300;
  this.down=code=>{if(code==='Space')this.press(this.now());};
  this.up=code=>{if(code==='Space')this.release(this.now());};
  inputs.keyboard.events.on('down',this.down);inputs.keyboard.events.on('up',this.up);
 }
 press(time){
  if(this.spaceDown)return;
  this.spaceDown=true;
  if(this.pending!==null&&time-this.pending<=this.windowMs){this.pending=null;this.onToggle();}
  else{this.pending=time;this.onTap();}
 }
 release(){this.spaceDown=false;}
 /** Expires the double-press window. SPACE no longer brakes, so this never asks for it. */
 update(time=this.now()){
  if(this.pending!==null&&time-this.pending>=this.windowMs)this.pending=null;
  return false;
 }
 reset(){this.pending=null;this.spaceDown=false;}
 flight(){
  const held=this.inputs.keyboard.pressed,stick=this.inputs.gamepad?.joysticks?.left;
  const key=k=>held.has(k)?1:0;
  let turn=key('KeyD')-key('KeyA')+key('ArrowRight')-key('ArrowLeft');
  let pitch=key('ArrowDown')+key('KeyQ')-key('ArrowUp')-key('KeyE');
  if(stick?.active){turn+=stick.safeX;pitch-=stick.safeY;}
  const pointer=this.inputs.pointer;
  // Mouse is deliberately opt-in: hold the viewport, point above/below centre.
  if(pointer?.isDown){const el=pointer.element;turn+=(pointer.current.x/el.clientWidth-.5)*.7;pitch-=(pointer.current.y/el.clientHeight-.5)*1.7;}
  return {throttle:key('KeyW')-key('KeyS'),turn:Math.max(-1,Math.min(1,turn)),pitch:Math.max(-1,Math.min(1,pitch))};
 }
 dispose(){this.inputs.keyboard.events.off('down',this.down);this.inputs.keyboard.events.off('up',this.up);this.reset();}
}
