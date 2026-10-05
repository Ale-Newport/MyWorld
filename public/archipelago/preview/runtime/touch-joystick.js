import {Nipple} from '../portfolio/world/input/Nipple.js';
import {PLACEMENT} from './placement.js';
/* THE TOUCH JOYSTICK ON THE ISLAND — /world2's ring on the ground around
   the car (portfolio/world/input/Nipple.js, compiled from
   src/world/input/Nipple.ts), with the two things /world needs on top.
   How a finger is read does not change: press anywhere on the world and
   drag; the distance from the car is the throttle, the bearing the
   steering, and a tap inside the inner circle (on the car) is a jump.
   Driving wires it the way Game.ts does: built before the Player and
   handed to it, added to the scene, updated once per frame after the
   devices (Driving.poll), fed every 'orbit' action in touch mode, and
   destroyed with the drive.

   HEIGHT. /world2's ground is the plane y = 0, so the ring, and the plane
   a finger is projected onto, sit between 0.1 and 0.65 m. The island is
   not flat: here the same band is measured from the ground under the car
   — where its wheels touch, averaged, or in the air where they last
   touched — so the ring lies on the ground the car stands on and the
   finger reads true there.

   CANCEL. Letting go without a tap: the map, a teleport, a recovery, the
   plane, a run that holds the car, a blur or another device took over
   while a finger was down. A finger lifted inside the inner circle is a
   tap, and a tap hops; a release that is not a finger lifting must not. */
export class TouchJoystick extends Nipple{
 constructor(tweens,vehicle){super(tweens);this.vehicle=vehicle;this.ground=vehicle.position.y-PLACEMENT.rest;}
 /** The ground under the car: where its wheels touch, or — airborne, or in the plane — where they last did. */
 groundLevel(){let y=0,n=0;for(const w of this.vehicle.wheels.items)if(w.inContact&&w.contactPoint){y+=w.contactPoint.y;n++;}if(n)this.ground=y/n;return this.ground;}
 /** Nipple.setCoordinates, measured from that ground instead of y = 0. */
 setCoordinates(x,y,z,angle){const g=this.groundLevel();super.setCoordinates(x,y-g,z,angle);this.position.y+=g;this.group.position.y=this.position.y;this.plane.constant=-this.position.y;}
 cancel(){if(!this.active)return;this.active=false;this.inRadiusLow=false;this.progress=0;this.material.uniforms.uProgress.value=0;this.events.trigger('release');}
}
