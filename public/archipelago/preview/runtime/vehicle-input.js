/** One handler owns SPACE. A press hops the car at once; a second press
 * inside the window turns car ↔ plane. Held or auto-repeated keys never
 * produce a second press: only a release re-arms it. Braking is B / Ctrl.
 *
 * The key's state is explicit: `held` is the level (down since a press that
 * became a hop — that is what keeps the wheels raised, see runtime/jump.js),
 * and `edges` records pressed-this-step / released-this-step until consume()
 * reads them. The double-press window runs press to press, so a hold longer
 * than the window can never be the first half of a double press, and the
 * press that toggles the vehicle never holds anything. A release, reset(),
 * a blur or a hidden tab (Keyboard.releaseAll fires the release) all clear
 * `held`; typing in a field never reaches here (Keyboard ignores it).
 *
 * The touch JUMP button (touch-controls.js, through Driving.jumpButton) is
 * this same press and release, so its pressed / held / released state is
 * SPACE's — with { toggle: false }: on a touch screen two quick taps of
 * JUMP are two jumps, and the CAR / PLANE button is what flies.
 *
 * flight() reads a finger like the mouse — hold the viewport, the offset
 * from its centre steers — but across the whole width: on a phone that
 * finger is the only stick there is. */
export class VehicleInput {
 constructor(inputs,onToggle,now=()=>performance.now(),onTap=()=>{}){
  this.inputs=inputs;this.onToggle=onToggle;this.onTap=onTap;this.now=now;this.pending=null;this.spaceDown=false;this.held=false;this.edges={pressed:false,released:false};this.windowMs=300;
  this.down=code=>{if(code==='Space')this.press(this.now());};
  this.up=code=>{if(code==='Space')this.release(this.now());};
  inputs.keyboard.events.on('down',this.down);inputs.keyboard.events.on('up',this.up);
 }
 press(time,{toggle=true}={}){
  if(this.spaceDown)return;
  this.spaceDown=true;this.edges.pressed=true;
  if(toggle&&this.pending!==null&&time-this.pending<=this.windowMs){this.pending=null;this.held=false;this.onToggle();}
  else{this.pending=toggle?time:null;this.held=this.onTap()!==false;}
 }
 release(){if(!this.spaceDown)return;this.spaceDown=false;this.held=false;this.edges.released=true;}
 /** Edges since the last call, plus the level: {pressed, released, held}. */
 consume(){const e={...this.edges,held:this.held};this.edges.pressed=false;this.edges.released=false;return e;}
 /** Expires the double-press window. SPACE no longer brakes, so this never asks for it. */
 update(time=this.now()){
  if(this.pending!==null&&time-this.pending>=this.windowMs)this.pending=null;
  return false;
 }
 reset(){this.pending=null;if(this.spaceDown)this.edges.released=true;this.spaceDown=false;this.held=false;}
 flight(){
  const held=this.inputs.keyboard.pressed,stick=this.inputs.gamepad?.joysticks?.left;
  const key=k=>held.has(k)?1:0;
  let turn=key('KeyD')-key('KeyA')+key('ArrowRight')-key('ArrowLeft');
  let pitch=key('ArrowDown')+key('KeyQ')-key('ArrowUp')-key('KeyE');
  if(stick?.active){turn+=stick.safeX;pitch-=stick.safeY;}
  const pointer=this.inputs.pointer;
  // Mouse is deliberately opt-in: hold the viewport, point above/below centre. A finger turns fully at the screen's edge.
  if(pointer?.isDown){const el=pointer.element;turn+=(pointer.current.x/el.clientWidth-.5)*(pointer.mode==='touch'?2:.7);pitch-=(pointer.current.y/el.clientHeight-.5)*1.7;}
  return {throttle:key('KeyW')-key('KeyS'),turn:Math.max(-1,Math.min(1,turn)),pitch:Math.max(-1,Math.min(1,pitch))};
 }
 dispose(){this.inputs.keyboard.events.off('down',this.down);this.inputs.keyboard.events.off('up',this.up);this.reset();}
}
