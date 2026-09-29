/** One buffer owns SPACE. The legacy jump binding never sees it. */
export class VehicleInput {
 constructor(inputs,onToggle,now=()=>performance.now()){
  this.inputs=inputs;this.onToggle=onToggle;this.now=now;this.pending=null;this.spaceDown=false;this.brakeUntil=0;this.holdBrake=false;this.windowMs=300;
  this.down=code=>{if(code==='Space')this.press(this.now());};
  this.up=code=>{if(code==='Space')this.release(this.now());};
  inputs.keyboard.events.on('down',this.down);inputs.keyboard.events.on('up',this.up);
 }
 press(time){
  if(this.spaceDown)return;
  this.spaceDown=true;
  if(this.pending!==null&&time-this.pending<=this.windowMs){this.pending=null;this.holdBrake=false;this.brakeUntil=0;this.onToggle();}
  else this.pending=time;
 }
 release(){this.spaceDown=false;this.holdBrake=false;}
 update(time=this.now()){
  if(this.pending!==null&&time-this.pending>=this.windowMs){this.pending=null;this.holdBrake=this.spaceDown;this.brakeUntil=time+160;}
  return this.holdBrake||time<this.brakeUntil;
 }
 reset(){this.pending=null;this.holdBrake=false;this.brakeUntil=0;this.spaceDown=false;}
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
