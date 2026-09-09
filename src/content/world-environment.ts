/** Shared geography for terrain, map, ecology and games.
 *
 * Everything here is authored against the compact island: roughly
 * 320 m across, so the next thing worth driving to is always within
 * a few seconds. Water, forest and play are placed in the gaps
 * BETWEEN districts on purpose — the journey between two landmarks
 * is supposed to contain something, not just distance. */

export const CIRCUIT = {
  x:-99,z:-1,width:12,laps:2,
  /**
   * What a good lap looks like, in seconds — the SPEED DEMON bar.
   *
   * Measured rather than guessed: `scripts/world-race-drive.mjs` runs
   * the lap at three paces and its careful middle setting averages
   * 6.1 m/s over the 546 m. Sixty seconds is 9.1 m/s, which needs a
   * driver who uses the straights and does not run wide at the esses.
   */
  targetLapSeconds:60,
  /**
   * NEWPORT CIRCUIT — a road course, not a serpentine.
   *
   * What this replaces was four near-parallel lanes joined at the
   * ends. It read as a slalom rather than a track, two of its lanes
   * merged into a single slab of tarmac in the north-west, and its
   * start/finish line sat on a 0.8 m-radius cusp where the closed
   * spline turned back on itself — so the lap began mid-hairpin.
   *
   * The layout now has the things a circuit is supposed to have, in
   * this order from the line:
   *
   *   START/FINISH   the south straight, 55 m, beside the link road
   *                  so the track is something you come across
   *   TURN 1         a long fast right onto the west side, R ~22 m
   *   THE WEST RUN   80 m of near-straight, the fastest part
   *   TURNS 2-3      a medium right into the north-west
   *   THE HAIRPIN    the north end, R ~11 m, slowest corner
   *   THE DESCENT    north-east, fast, downhill (see the profile below)
   *   THE ESSES      a left-right-left chicane into the infield
   *   THE INFIELD    technical, second gear
   *   TURN 9         right onto the east straight
   *   EAST STRAIGHT  70 m, the overtaking place, with the JUMP on it
   *   THE LAST CORNER back onto the line
   *
   * Coordinates are LOCAL — add `x` and `z`. Kept in that form
   * because the whole circuit can then be moved with two numbers.
   */
  points:[
    // start / finish straight, running west
    [44,80],[26,82],[6,83],
    // turn 1: a long fast right, its line set by the coastline —
    // the south-west is the narrowest part of the island and the
    // track is held eighteen metres inside the sand
    [-6,76],[-15,67],[-25,56],[-35,44],
    // the west run — the fastest part of the lap
    [-46,24],[-46,-2],[-45,-28],
    // turns 2 and 3, into the north-west
    [-42,-52],[-35,-73],[-24,-88],
    // the hairpin, the slowest corner
    [-8,-97],[10,-97],[24,-89],
    // the descent
    [31,-74],[34,-56],
    // the esses and the infield: second gear, and where a lap is lost
    [30,-40],[16,-36],[2,-34],[-10,-28],[-18,-16],[-20,-2],[-16,12],
    [-6,22],[8,26],[22,24],[32,16],
    // turn 9 onto the east straight
    [40,30],
    // the east straight, with the jump on it
    [44,48],[44,66],
  ] as [number,number][],
  /**
   * Elevation along the lap, as [position 0..1, metres above the
   * natural ground]. The terrain flattens a corridor to whatever it
   * finds underneath, and what it finds on the island's west side is
   * nearly level — so without this the circuit is a billiard table.
   * Interpolated smoothly and applied by `Terrain.heightAt`.
   *
   * The crest sits just before the esses, so the fast north-east
   * descent runs downhill into the slowest part of the lap; the dip
   * is on the west run, which makes its far end a blind entry.
   *
   * Kept small — 2.2 m at the crest, not 3.4. The corridor has to
   * carry the ground around it up as well, and at 3.4 the shoulder
   * met the river bank at thirty-four degrees, which
   * `world-shore-check.mjs` correctly called a wall.
   */
  elevation:[
    [0.00,0.0],[0.12,-0.4],[0.28,-0.9],[0.42,0.3],
    [0.55,1.7],[0.66,2.2],[0.74,0.8],[0.86,0.1],[1.00,0.0],
  ] as [number,number][],
  /** The jump, as a position along the lap. On the east straight. */
  jumpAt:0.93,
}

/** Height the circuit is raised above the natural ground at `t` (0..1). */
export function circuitElevation(t:number):number {
  const keys=CIRCUIT.elevation
  const u=((t%1)+1)%1
  for(let i=1;i<keys.length;i++) {
    if(u>keys[i][0])continue
    const [a,ha]=keys[i-1],[b,hb]=keys[i]
    const k=(u-a)/Math.max(1e-6,b-a)
    return ha+(hb-ha)*k*k*(3-2*k)
  }
  return 0
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
  {x:80,z:-12,length:44,width:8,kind:'modern',rotation:2.356,road:'lake-shortcut',level:1.2},
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
  {id:'deployment',label:'DEPLOYMENT ALTAR',x:50,z:-46,radius:13,flat:12},
  {id:'timeMachine',label:'TIME MACHINE',x:62,z:88,radius:12,flat:10},
  {id:'debugDash',label:'DEBUG DASH',x:8,z:46,radius:15},
  {id:'riverRun',label:'RIVER RUN',x:-32,z:-14,radius:13},
  {id:'chipRelay',label:'CHIP RELAY',x:34,z:40,radius:13,flat:11},
  {id:'gravityWell',label:'GRAVITY WELL',x:58,z:-118,radius:11},
  // Out of the maze: the labyrinth is 54 by 44 m and this sat inside
  // its eastern half.
  {id:'particleField',label:'PARTICLE FIELD',x:60,z:-24,radius:11},
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
  // The northern highland — the densest woodland on the island. Pulled
  // inland: at (-46,-128) r26 the pocket's centre was seven metres
  // inside the coastline, so most of its area was at sea and the
  // scatter threw away nine attempts in ten.
  [-38,-105,26],[-18,-119,22],[-48,-109,20],
  // River banks, the seam between the track and the districts.
  [-38,-88,15],[-33,-56,14],[-31,-16,14],[-29,24,14],
  /* The track's infield and the seam beside it — scenery rather than
     activity. The old six were placed against the previous serpentine
     and every one of them ended up on the new racing line, so the
     ecology rejected almost every tree it tried to plant in them and
     the whole west of the island came out bare. These four are what
     actually fits, found by sampling the ground rather than by eye. */
  [-102,-65,16],[-82,51,14],[-60,-12,14],[-92,-8,12],
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
