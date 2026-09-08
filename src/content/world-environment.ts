/** Shared geography for terrain, map, ecology and games.
 *
 * Everything here is authored against the compact island: roughly
 * 320 m across, so the next thing worth driving to is always within
 * a few seconds. Water, forest and play are placed in the gaps
 * BETWEEN districts on purpose — the journey between two landmarks
 * is supposed to contain something, not just distance. */

export const CIRCUIT = {
  x:-99,z:-1,width:12,laps:2,
  /** What a good lap looks like, in seconds — the SPEED DEMON bar. At
   *  ~780 m a lap that is an average of about 20 m/s, which is quick
   *  without being unreachable. */
  targetLapSeconds:44,
  // A four-lane serpentine filling the western half of the island,
  // the way the reference gives its whole left side to the track. The
  // start/finish straight runs beside the content half, so the circuit
  // is something you come across rather than only visit on purpose.
  // ~780 m a lap, against the ~300 m loop this replaces.
  points:[[47,81],[46,45],[45,7],[44,-31],[43,-63],[39,-87],[28,-100],[14,-99],[12,-83],[11,-49],[10,-11],[9,25],[9,51],[5,65],[-5,73],[-15,66],[-18,45],[-19,9],[-20,-25],[-21,-57],[-25,-77],[-33,-87],[-41,-78],[-43,-57],[-45,-25],[-45,7],[-43,35],[-35,53],[-26,64],[-13,75],[7,78],[29,77],[43,79]] as [number,number][],
}
/**
 * Sea level. The ground falls away past the coast as -(over*0.12)^1.7,
 * so this number decides how wide the beach is: at -6 the waterline sat
 * twenty-four metres out and the island wore a dead sandy ring. At -2.5
 * the shore is about ten metres, which is a beach rather than a margin.
 */
export const OCEAN_LEVEL = -2.5

export const LAKES = [
  // Lagoons threaded between the districts, the way the reference
  // scatters water through its content half rather than pooling it.
  {id:'mirror-lake',x:78,z:-10,rx:16,rz:12,level:-0.7,depth:4.4},
  // South of the ring road, not under it. At (82, 92) the road's
  // south leg ran straight through the middle of this lake with no
  // bridge and no ford — you drove into four metres of water on the
  // main loop. It now sits in the bay between the road and the
  // coast, with the TIME MACHINE on its western shore.
  {id:'willow-lake',x:90,z:108,rx:13,rz:9,level:-0.65,depth:4.6},
  {id:'cold-tarn',x:-28,z:-106,rx:13,rz:10,level:-0.8,depth:4},
]
/** Off the northern highland, down the seam between the track and the
 *  districts. It is the boundary between the two halves of the island,
 *  which is why it is worth crossing. */
/**
 * How wide a bank is, in metres, on every piece of inland water.
 *
 * This is also the distance the water's influence REACHES past its
 * mapped edge, and the two have to be the same number. They were not:
 * the blend ran over 3.5 m but `inlandWater` stopped answering at
 * 1.18 lake radii — about 2 m out — so the bank was truncated a third
 * of the way down and every lake wore a ring cliff up to 5.7 m high.
 */
export const BANK_WIDTH = 7

export const RIVER = {
  width:8,level:-0.7,
  // Extended fourteen metres south, so the road that crosses it
  // crosses a river rather than clipping its last four metres and
  // dropping into a trench nobody had authored a bridge for.
  points:[[-40,-118],[-36,-96],[-34,-72],[-33,-48],[-32,-22],[-31,4],[-30,30],[-28,56],[-27,70]] as [number,number][],
}
export const WATERFALL = {x:-40,z:-118,top:10,bottom:-0.7,width:8}
/**
 * CROSSINGS, not decorations.
 *
 * All three bridges used to stand in open country: the nearest tarmac
 * to any of them was 26–31 m away, including the one literally typed
 * `kind: 'road'`. They were also hard-locked to the world X axis —
 * there was no rotation field, so a crossing on any other bearing was
 * not expressible — and the modern one spanned a lake no road went
 * near while its approach pads punched two sheer plateaus into it.
 *
 * Each one is now on a road, at the point where that road meets the
 * water, lying along the road's own tangent. `road` is the id in
 * `world.ts`; `rotation` is the yaw of the deck's long axis.
 */
export const BRIDGES = [
  // The north link, carrying the loop back off the circuit's top end.
  {x:-33.3,z:-56,length:28,width:8,kind:'wood',rotation:2.678,road:'north-link',level:0.9},
  // The circuit link, over the river's lower reach.
  {x:-28.2,z:56,length:28,width:9,kind:'road',rotation:2.199,road:'circuit-link',level:0.9},
  // The lake shortcut: forty metres of deck straight across Mirror
  // Lake, which is a real saving between UCL and the spine and is
  // meant to be found rather than signposted.
  {x:78,z:-10,length:44,width:8,kind:'modern',rotation:2.099,road:'lake-shortcut',level:1.2},
] as const
/** `flat` is the radius of ground a spot levels under itself, for the
 *  venues that build one continuous surface — a bowling lane laid over
 *  rolling ground has its pins underground at one end. */
export const PLAY_SPOTS = [
  {id:'bowling',label:'BOWLING',x:76,z:44,radius:20,flat:15},
  // One venue, two things to do in it: the quarry is the place and
  // TNT DOMINO is the challenge played there. It used to be listed
  // twice at identical coordinates, which the map worked around by
  // filtering one out by id.
  {id:'tnt',label:'TNT QUARRY',x:92,z:8,radius:16,flat:16,game:'domino'},
  {id:'deployment',label:'DEPLOYMENT ALTAR',x:58,z:-48,radius:13,flat:12},
  {id:'timeMachine',label:'TIME MACHINE',x:62,z:88,radius:12,flat:10},
  {id:'debugDash',label:'DEBUG DASH',x:8,z:46,radius:15},
  {id:'riverRun',label:'RIVER RUN',x:-32,z:-14,radius:13},
  {id:'chipRelay',label:'CHIP RELAY',x:34,z:40,radius:13,flat:11},
  {id:'gravityWell',label:'GRAVITY WELL',x:58,z:-118,radius:11},
  {id:'particleField',label:'PARTICLE FIELD',x:80,z:-54,radius:11},
  {id:'procedural',label:'PROCEDURAL TERRAIN',x:120,z:50,radius:12},
  // In the infield between two of the track's lanes: you only find it
  // by leaving the racing line.
  {id:'cabin',label:'OUT OF OFFICE',x:-72,z:10,radius:11},
] as const
export const RELAY_POINTS = [[-14,30],[26,14],[44,48]] as const
/** Wooded masses, not an even scatter: the north-west highland, the
 *  river banks, the lake shores, and thickets filling the pockets the
 *  ring road curves around. `[x, z, radius]`. */
export const FOREST_POCKETS = [
  // The northern highland — the densest woodland on the island.
  [-46,-128,26],[-20,-132,22],[-64,-140,20],
  // River banks, the seam between the track and the districts.
  [-38,-88,15],[-33,-56,14],[-31,-16,14],[-29,24,14],
  // The track's infield, which is scenery rather than activity.
  [-70,-40,20],[-72,42,18],[-104,-8,18],[-106,30,16],[-132,-40,16],[-134,18,15],
  // Lake shores and the gaps the ring road curves around.
  [96,-14,14],[100,101,13],[-4,-104,14],
  [26,-24,13],[74,-90,15],[112,-46,14],[124,14,14],[70,72,14],[16,84,14],
  // South coast scrub.
  [56,120,15],[-4,110,14],
  // Gaps found by sampling the island rather than by eye.
  [60,-10,13],[90,130,13],
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
/** The circuit spline in world coordinates, closed. Terrain flattens a
 *  corridor along it and the ecology keeps off it; both need the same
 *  line, so it lives here with the rest of the geography. */
export const CIRCUIT_TRACK: [number,number][] = [
  ...CIRCUIT.points.map(([x,z]) => [CIRCUIT.x + x, CIRCUIT.z + z] as [number,number]),
  [CIRCUIT.x + CIRCUIT.points[0][0], CIRCUIT.z + CIRCUIT.points[0][1]],
]

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
    // Reach exactly one bank width past the mapped edge, so the blend
    // has room to finish and the shore meets the land at zero.
    const reach=1+BANK_WIDTH/Math.min(lake.rx,lake.rz)
    if(radius<reach)region={level:lake.level,depth:lake.depth,edge:(1-radius)*Math.min(lake.rx,lake.rz),flow:0.16}
  }
  const distance=lineDistance(x,z,RIVER.points)
  if(distance<RIVER.width/2+BANK_WIDTH) {
    // 1.6 m at the deepest, not 2.6: a river you can FORD. At 2.6 the
    // car's origin sat a metre under the surface mid-stream and the
    // drowning timer started, so the only way across was a bridge.
    const river={level:RIVER.level,depth:1.6,edge:RIVER.width/2-distance,flow:1}
    // Unite the beds at confluences. A lake's outer bank must not dam a river
    // whose centreline continues through it.
    const depth=(w:typeof river)=>{const t=Math.max(0,Math.min(1,w.edge/(w.flow>.9?6:11)));return w.edge<0?w.edge:w.depth*Math.pow(t*t*(3-2*t),1.9)}
    if(!region||depth(river)>depth(region))region=river
  }
  return region
}
