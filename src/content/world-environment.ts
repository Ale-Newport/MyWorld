/** Shared geography for terrain, map, ecology and games.
 *
 * Everything here is authored against the compact island: roughly
 * 320 m across, so the next thing worth driving to is always within
 * a few seconds. Water, forest and play are placed in the gaps
 * BETWEEN districts on purpose — the journey between two landmarks
 * is supposed to contain something, not just distance. */

export const CIRCUIT = {
  x:105,z:-60,width:12,laps:3,
  // Its own flank of the island, the way the reference gives a whole
  // side to its circuit rather than tucking it into a corner.
  points:[[-5,33],[17,33],[32,22],[35,0],[27,-10],[12,-14],[3,-28],[-9,-30],[-14,-20],[-27,-21],[-35,-6],[-33,16],[-20,30]] as [number,number][],
}
export const LAKES = [
  // In the gap between focus, client and voxel — the causeway crosses it.
  {id:'mirror-lake',x:46,z:26,rx:20,rz:15,level:-0.7,depth:4.6},
  // Between gym, archive and the algorithm field.
  {id:'willow-lake',x:-54,z:98,rx:22,rz:16,level:-0.65,depth:4.8},
  // The northern tarn, fed by the river's overflow.
  {id:'cold-tarn',x:-32,z:-108,rx:16,rz:13,level:-0.8,depth:4.2},
]
/** Off the north-west highland and down the western side of the island.
 *  It runs INSIDE the coast, not along it — a river you can only see
 *  from the sea is not a river anybody drives to. */
export const RIVER = {width:8,level:-0.7,points:[[-112,-80],[-118,-78],[-124,-56],[-128,-32],[-128,-6],[-124,18],[-116,42]] as [number,number][]}
export const WATERFALL = {x:-112,z:-80,top:9,bottom:-0.7,width:8}
export const BRIDGES = [
  {x:-125,z:-52,length:24,width:8,kind:'wood'},
  {x:46,z:26,length:36,width:8,kind:'modern'},
] as const
export const PLAY_SPOTS = [
  {id:'bowling',label:'BOWLING',x:-28,z:-48,radius:22},
  {id:'tnt',label:'TNT QUARRY',x:70,z:-34,radius:16},
  {id:'deployment',label:'DEPLOYMENT ALTAR',x:-72,z:-96,radius:13},
  {id:'timeMachine',label:'TIME MACHINE',x:34,z:92,radius:12},
  {id:'debugDash',label:'DEBUG DASH',x:-64,z:70,radius:15},
  {id:'riverRun',label:'RIVER RUN',x:-127,z:-14,radius:13},
  {id:'chipRelay',label:'CHIP RELAY',x:22,z:32,radius:13},
  {id:'domino',label:'TNT DOMINO',x:70,z:-34,radius:16},
  {id:'gravityWell',label:'GRAVITY WELL',x:-24,z:-124,radius:11},
  {id:'particleField',label:'PARTICLE FIELD',x:22,z:-70,radius:11},
  {id:'procedural',label:'PROCEDURAL TERRAIN',x:106,z:24,radius:12},
  {id:'cabin',label:'OUT OF OFFICE',x:-112,z:16,radius:11},
] as const
export const RELAY_POINTS = [[-14,30],[26,14],[44,48]] as const
/** Wooded masses, not an even scatter: the north-west highland, the
 *  river banks, the lake shores, and thickets filling the pockets the
 *  ring road curves around. `[x, z, radius]`. */
export const FOREST_POCKETS = [
  // The northern highland — the densest woodland on the island.
  [-100,-74,26],[-112,-100,24],[-84,-112,26],[-56,-118,24],
  // River banks.
  [-120,-40,16],[-126,-6,15],[-114,34,14],
  // Lake shores.
  [-70,110,20],[-40,84,15],[62,38,15],[-46,-122,16],
  // Thickets inside the ring's curves.
  [34,-14,14],[-34,44,16],[10,96,15],[54,84,16],[100,66,18],
  // The eastern slope below the circuit.
  [128,-14,18],[76,-98,20],
  // South coast scrub.
  [-84,132,18],[36,128,16],
] as const
/**
 * The coastline, as a radius that varies with bearing. A perfect
 * circle reads as a plate on water; three low harmonics give bays and
 * headlands without any of it needing to be hand-drawn. Terrain and
 * the map both call this, so the shape they draw is the same shape.
 */
export function coastRadius(x:number,z:number,nominal:number):number {
  const a=Math.atan2(z,x)
  return nominal*(1
    +0.115*Math.sin(a*2+0.7)
    +0.075*Math.sin(a*3-1.9)
    +0.045*Math.sin(a*5+2.6))
}
export function lineDistance(x:number,z:number,points:readonly (readonly number[])[]):number {
  let best=Infinity
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1]
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)))
    best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t))
  }
  return best
}
export function inlandWater(x:number,z:number):{level:number;depth:number;edge:number;flow:number}|null {
  let region:{level:number;depth:number;edge:number;flow:number}|null=null
  for(const lake of LAKES) {
    const radius=Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz)
    if(radius<1.18)region={level:lake.level,depth:lake.depth,edge:(1-radius)*Math.min(lake.rx,lake.rz),flow:0.16}
  }
  const distance=lineDistance(x,z,RIVER.points)
  if(distance<RIVER.width) {
    const river={level:RIVER.level,depth:2.6,edge:RIVER.width/2-distance,flow:1}
    // Unite the beds at confluences. A lake's outer bank must not dam a river
    // whose centreline continues through it.
    const depth=(w:typeof river)=>{const t=Math.max(0,Math.min(1,w.edge/(w.flow>.9?4.5:7)));return w.edge<0?w.edge:w.depth*t*t*(3-2*t)}
    if(!region||depth(river)>depth(region))region=river
  }
  return region
}
