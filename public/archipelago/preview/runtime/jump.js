import {Events} from './Events.js';
/** One SPACE press is one hop, the /world2 way: the four hydraulic
 * suspensions extend to their high rest length for a fixed number of physics
 * steps, the spring force (Rapier scales it by the chassis mass) throws the
 * body up until every wheel has left the ground, and the suspensions drop back
 * so the car lands on its normal ride height. Counted in fixed 1/60 s steps,
 * so the hop is the same at any display refresh rate.
 *
 * A request is only honoured from the ground: the hop is spent until the car
 * has been airborne and landed again, which rules out mid-air jumps. A press a
 * few steps before touchdown is buffered rather than lost. */
export const JUMP={pulseSteps:12,bufferSteps:8,settleSteps:6,maxAirSteps:240};
export class CarJump{
 constructor(vehicle,player,ticker,{canJump=()=>true}={}){
  Object.assign(this,{vehicle,player,ticker,canJump});this.events=new Events();this.reset();
  this.step=()=>this.fixed();ticker.events.on('fixed',this.step,1.45);
 }
 get grounded(){const v=this.vehicle;return v.wheels.inContactCount>=3&&v.upward.y>.7;}
 /** Returns false when the press cannot become a hop (in the air, already hopping). */
 request(){if(this.state!=='ready')return false;this.buffer=JUMP.bufferSteps;return true;}
 fixed(){
  const s=this.player.suspensions;
  if(this.state==='pulse'){if(++this.steps>=JUMP.pulseSteps){s.fill('low');this.state='air';this.steps=0;}return;}
  if(this.state==='air'){this.steps++;const contact=this.vehicle.wheels.inContactCount;if(contact===0)this.airSteps++;if((this.airSteps>0&&this.grounded)||this.steps>JUMP.maxAirSteps){this.events.trigger('land',[this.airSteps/60]);this.state='settle';this.steps=0;}return;}
  if(this.state==='settle'){if(++this.steps>=JUMP.settleSteps)this.state='ready';return;}
  if(this.buffer>0){this.buffer--;if(this.grounded&&this.canJump()){s.fill('high');this.state='pulse';this.steps=0;this.airSteps=0;this.buffer=0;this.hops++;this.events.trigger('jump');}}
 }
 reset(){this.state='ready';this.steps=0;this.airSteps=0;this.buffer=0;this.hops??=0;}
 dispose(){this.ticker.events.off('fixed',this.step);this.events.clear();}
}
