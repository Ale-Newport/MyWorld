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
 * few steps before touchdown is buffered rather than lost.
 *
 * HELD, as in /world2 (Player.updateHydraulics: all four 'high' while jump is
 * held): when the pulse ends and the press that started it is still down
 * (`holding()`), the suspensions stay 'high' instead of dropping — the car
 * lands on, and drives on, extended wheels — until the release. Holding adds
 * no impulse of its own: it is the same rest length and stiffness the pulse
 * used, gravity and the solver untouched, and the visual wheels follow the
 * physical suspension length as always (VisualVehicle). A press that was
 * refused (in the air, in the plane) raises nothing.
 *
 * RELEASED, the wheels come back to 'low' over JUMP.lowerSteps: a transient
 * 'lowering' level whose rest length and stiffness ease from high to low, so
 * the body is let down on its tyres. Switching straight to 'low' (as /world2
 * does) shortened the springs 0.75 m in one step; the suspension ray only
 * reaches rest length + radius, so the tyres lost the ground and the body
 * fell. Corner hydraulics still held then take over again.
 *
 * Invariant: 'high' exists only during a pulse or an active hold, and
 * 'lowering' only while lowering. Each step any other (left by the horn's
 * corner bounce, a reset, a lost release) is turned back to 'low', so nothing
 * can leave the wheels stuck extended. */
export const JUMP={pulseSteps:12,bufferSteps:8,settleSteps:6,maxAirSteps:240,lowerSteps:50};
const smooth=t=>t*t*(3-2*t);
export class CarJump{
 constructor(vehicle,player,ticker,{canJump=()=>true,holding=()=>false}={}){
  Object.assign(this,{vehicle,player,ticker,canJump,holding});this.events=new Events();this.reset();
  vehicle.suspensionsHeights.lowering??=vehicle.suspensionsHeights.low;vehicle.suspensionsStiffness.lowering??=vehicle.suspensionsStiffness.low;
  this.step=()=>this.fixed();ticker.events.on('fixed',this.step,1.45);
 }
 get grounded(){const v=this.vehicle;return v.wheels.inContactCount>=3&&v.upward.y>.7;}
 /** Returns false when the press cannot become a hop (in the air, already hopping). */
 request(){if(this.state!=='ready')return false;this.buffer=JUMP.bufferSteps;return true;}
 /** The hold is over (release, blur, map, mode switch): the wheels start coming down on the next step.
  * `now` puts them straight back to 'low' (a teleport, where the car is set down at rest anyway). */
 release(now=false){if(this.extended){this.extended=false;this.lowering=now?0:JUMP.lowerSteps;this.events.trigger('release');}if(now)this.lowering=0;this.clean();}
 /** No 'high' outside a pulse or a hold, no 'lowering' outside the lowering. */
 clean(){if(this.state==='pulse'||this.extended||this.lowering>0)return;const s=this.player.suspensions;for(let i=0;i<4;i++)if(s[i]==='high'||s[i]==='lowering')s[i]='low';}
 fixed(){
  const s=this.player.suspensions;
  if(this.extended&&!(this.holding()&&this.canJump()))this.release();
  if(this.extended)s.fill('high');
  else if(this.lowering>0&&this.state!=='pulse'){
   const v=this.vehicle,H=v.suspensionsHeights,K=v.suspensionsStiffness,e=smooth(1-(--this.lowering)/JUMP.lowerSteps);H.lowering=H.high+(H.low-H.high)*e;K.lowering=K.high+(K.low-K.high)*e;
   for(let i=0;i<4;i++)if(s[i]==='high')s[i]='lowering';
   if(this.lowering===0){for(let i=0;i<4;i++)if(s[i]==='lowering')s[i]='low';this.player.updateHydraulics?.();}
  }
  else this.clean();
  if(this.state==='pulse'){if(++this.steps>=JUMP.pulseSteps){if(this.holding()&&this.canJump()){this.extended=true;this.events.trigger('hold');}else s.fill('low');this.state='air';this.steps=0;}return;}
  if(this.state==='air'){this.steps++;const contact=this.vehicle.wheels.inContactCount;if(contact===0)this.airSteps++;if((this.airSteps>0&&this.grounded)||this.steps>JUMP.maxAirSteps){this.events.trigger('land',[this.airSteps/60]);this.state='settle';this.steps=0;}return;}
  if(this.state==='settle'){if(++this.steps>=JUMP.settleSteps)this.state='ready';return;}
  if(this.buffer>0){this.buffer--;if(this.grounded&&this.canJump()){this.lowering=0;s.fill('high');this.state='pulse';this.steps=0;this.airSteps=0;this.buffer=0;this.hops++;this.events.trigger('jump');}}
 }
 reset(){this.state='ready';this.steps=0;this.airSteps=0;this.buffer=0;this.hops??=0;this.extended=false;this.lowering=0;}
 dispose(){this.ticker.events.off('fixed',this.step);this.events.clear();}
}
