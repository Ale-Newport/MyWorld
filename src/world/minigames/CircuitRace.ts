import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Minigame } from './Minigame'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { Physical } from '../physics/Physics'
import { textTexture } from '../world/materials'
import { chamferedBox, wheelGeometry } from '../world/geometry'
import { CIRCUIT, CIRCUIT_TRACK, PLAY_SPOTS, lineDistance } from '@/content/world-environment'
import { blockedBy } from '@/content/world-layout'

/** CircuitArea.js (folio-2025, MIT) informed the curtains, countdown and reset.
 * This non-crossing layout and directed swept gates are original.
 * The base state is the sole authority, named here by its race semantics. */
export const RaceState = { IDLE:'idle', READY:'ready', COUNTDOWN:'countdown', RACING:'running', FINISHED:'finished', RESETTING:'resetting' } as const
export interface RaceGate {
  index:number; centre:THREE.Vector3; normal:THREE.Vector2; a:THREE.Vector2; b:THREE.Vector2
  rotation:number; halfWidth:number; respawn:{position:THREE.Vector3;rotation:number}
}
export function raceTime(seconds:number):string {
  const ms=Math.max(0,Math.round(seconds*1000))
  return [String(Math.floor(ms/60000)).padStart(2,'0'),String(Math.floor(ms/1000)%60).padStart(2,'0'),String(ms%1000).padStart(3,'0')].join(':')
}
/** Directed swept plane crossing, bounded to the physical gate width/height.
 * Fractional arrival times prevent frame-rate-dependent finish rounding. */
export function crossGate(from:THREE.Vector3,to:THREE.Vector3,gate:RaceGate):number|null {
  const nx=gate.normal.x,nz=gate.normal.y,c=gate.centre
  const d0=(from.x-c.x)*nx+(from.z-c.z)*nz,d1=(to.x-c.x)*nx+(to.z-c.z)*nz
  if(d0>=0||d1<0||d1-d0<0.00001)return null
  const t=-d0/(d1-d0),x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t,y=from.y+(to.y-from.y)*t
  if(Math.abs((x-c.x)*-nz+(z-c.z)*nx)>gate.halfWidth)return null
  if(y<c.y+0.25||y>c.y+5.8)return null
  return t
}
/* ============================================================
   THINGS IN THE WAY

   Two sets of obstacles stand ON the racing surface: a spill of TNT
   crates off the quarry on the west run, and a timber slalom on the
   drop out of the sweeper into the esses. Both are destructible and
   both go back when the race resets — a lap that is only difficult
   the first time is a lap with scenery, not obstacles.

   THE CORRIDOR is the number everything else is derived from.
   `scripts/world-race-drive.mjs` drives the whole lap with a
   bang-bang autopilot that aims at a point 6, 8 or 10 m ahead ON THE
   CENTRELINE and never looks sideways: it will not steer round
   anything. The car is 1.7 m wide, so 0.85 m of that corridor is the
   car itself and the rest is the driver's tracking error, which on a
   45 m-radius run is well under a metre.

   2.8 m either side of the centreline therefore stays clear of
   everything. Two obstacles facing each other across the track leave
   a 5.6 m gap — 3.3 car widths on a 10 m track — and a single one
   leaves 7.9 m. That is threadable at nineteen metres a second and
   still narrow enough that a human takes a line through it.
   ============================================================ */
const CORRIDOR=2.8
/** Where a knockable obstacle is in its life. */
interface Obstacle {
  kind:'tnt'|'timber'
  mesh:THREE.InstancedMesh
  index:number
  physical:Physical
  /** Seconds until it goes off; -1 while it is just a box in the way. */
  fuse:number
  gone:boolean
  /** `ticker.elapsed` when it went, for the re-rack timer. */
  goneAt:number
  /** Nothing detonates for two seconds after a re-rack: the crates
   *  land on the tarmac and on EACH OTHER, and the stacked ones were
   *  blowing themselves up on the way down. */
  armedAt:number
}

export class CircuitRace extends Minigame {
  readonly id='circuit' as const
  readonly title='NEWPORT CIRCUIT'
  readonly gates:RaceGate[]=[]
  readonly group=new THREE.Group()
  /** How far from the RACING LINE a run may stray before it cancels.
   *  Published because `scripts/world-runtime-checks.mjs` has to put
   *  the car outside it to test that straying works, and a second copy
   *  of the number in a harness is a harness that goes green when the
   *  island shrinks under it. 77 on a 266 m island; it was 110. */
  readonly strayRadius=77
  readonly startPosition=new THREE.Vector3()
  startRotation=0
  reached=0
  private countdown=3
  private lastBeat=4
  private previous=new THREE.Vector3()
  private hasPrevious=false
  private recoveries=0
  private splits:number[]=[]
  private target!:THREE.Mesh
  private targetMaterial!:THREE.MeshBasicMaterial
  private lights:THREE.Mesh[]=[]
  private gateMaterials:THREE.MeshBasicMaterial[]=[]
  private lastHud=-1
  private clockStart=0
  private countdownStart=0
  private pausedAt:number|null=null
  private obstacles:Obstacle[]=[]
  /** Instances whose matrix still needs writing while the body sleeps. */
  private obstacleDirty=new Set<Obstacle>()
  /** The Armco: dynamic now, so its matrices follow the bodies.
   *  `dirty` is the one written by a reset — Rapier puts a barrier
   *  back to sleep in the same call, and a sleep-gated writer would
   *  leave it drawn where it was knocked to. */
  private trackside:{mesh:THREE.InstancedMesh;bodies:Physical[];dirty:Set<number>}|null=null
  private lastBlast=-99
  private lastBlastSound=-99
  private readonly samplePosition=new THREE.Vector3()
  private readonly sampleQuaternion=new THREE.Quaternion()
  private readonly sampleMatrix=new THREE.Matrix4()
  private readonly sampleScale=new THREE.Vector3(1,1,1)
  readonly curve=new THREE.CatmullRomCurve3(CIRCUIT.points.map(([x,z])=>new THREE.Vector3(x+CIRCUIT.x,0,z+CIRCUIT.z)),true,'centripetal')
  /** Checkpoints per lap. Read from the data: the old track had twelve
   *  hard-coded in eleven places, and this one is 634 m with two
   *  hairpins and a tight esses — twelve gates would be one every 53 m
   *  and would leave the esses uncovered entirely. */
  private readonly gateCount=CIRCUIT.gates

  constructor(game:Game,bin:Bin){super(game,bin);this.abandonRadius=1000}
  build():void {
    this.buildTrack()
    const walls=this.buildTyreWalls()
    this.buildTrackside(walls)
    /* THE KERB, not a number. The posts, the number boards and the
       gantry beam were written as a literal 7 and a literal 15, which
       were `14/2` and `14 + 1` on the 380 x 285 island. The track is
       10 m wide now, so the posts stood two metres out in the run-off
       and the beam overhung both of them. */
    const kerb=CIRCUIT.width/2
    for(let i=0;i<this.gateCount;i++) {
      const c=this.curve.getPointAt(i/this.gateCount),t=this.curve.getTangentAt(i/this.gateCount)
      c.y=this.game.terrain.colliderHeightAt(c.x,c.z)+0.07
      const n=new THREE.Vector2(t.x,t.z).normalize(),side=new THREE.Vector2(-n.y,n.x)
      // The 7 here is NOT the half-width the two below were: it is how
      // far back ALONG the lap a recovery puts the car, a car-length
      // distance that owes nothing to how wide the track is.
      const rotation=Math.atan2(-n.y,n.x),p=c.clone().add(new THREE.Vector3(-n.x*7,1.5,-n.y*7))
      p.y=this.game.terrain.colliderHeightAt(p.x,p.z)+1.6
            /*
        THE GATE IS WIDER THAN THE TARMAC.

        `width/2` made the detection window exactly the racing surface,
        so a car that ran onto the run-off at one corner missed that
        checkpoint — and because detection is strictly sequential, as it
        must be, the rest of the lap then counted for nothing. A driver
        who has already lost time going wide does not also need the lap
        cancelled for it.

        Six metres of shoulder either side is still not a shortcut, but
        the reason has changed and the old one is now false. This lap
        touches itself: the south run and the return west out of the
        esses pass 12.6 m apart centre to centre, which on an 11 m gate
        half-width would put one plane across the other carriageway.
        MEASURED on the current centreline: the pinch falls BETWEEN two
        gates, and no gate plane reaches a stretch of the same track
        more than 45 m of arc away. Re-check that if the drawing is
        ever re-traced — the old comment claimed sixty metres of
        separation, which stopped being true two rescales ago.
      */
      this.gates.push({index:i,centre:c,normal:n,rotation,halfWidth:CIRCUIT.width/2+6,
        a:new THREE.Vector2(c.x,c.z).addScaledVector(side,-CIRCUIT.width/2),b:new THREE.Vector2(c.x,c.z).addScaledVector(side,CIRCUIT.width/2),
        respawn:{position:p,rotation}})
      const material=this.game.materials.own(new THREE.MeshBasicMaterial({color:0x6d8270}))
      this.gateMaterials.push(material)
      for(const s of [-1,1])this.box([0.42,i===0?7:4.8,0.42],[c.x+side.x*kerb*s,c.y+(i===0?3.5:2.4),c.z+side.y*kerb*s],material)
      if(i===0) {
        this.startPosition.copy(p);this.startRotation=rotation
        const beam=this.box([0.7,1.6,CIRCUIT.width+1],[c.x,c.y+6.6,c.z],this.game.materials.get('ink'))
        beam.rotation.y=rotation
        this.label('NEWPORT CIRCUIT',c.clone().add(new THREE.Vector3(0,7.9,0)),9,rotation+Math.PI/2)
        this.buildLightTree(c,side,rotation)
      }else this.label(String(i).padStart(2,'0'),c.clone().add(new THREE.Vector3(side.x*kerb,4.7,side.y*kerb)),2,rotation+Math.PI/2)
    }
    this.buildGrandstand()
    this.buildObstacles()
    const geometry=new THREE.PlaneGeometry(CIRCUIT.width,4.5)
    this.bin.add(()=>geometry.dispose())
    this.targetMaterial=this.game.materials.own(new THREE.MeshBasicMaterial({color:0x7cdcaf,transparent:true,opacity:0.25,side:THREE.DoubleSide,depthWrite:false}))
    this.target=new THREE.Mesh(geometry,this.targetMaterial);this.target.visible=false;this.group.add(this.target)
    this.game.renderer.scene.add(this.group);this.bin.object3D(this.group)
    const fixed=()=>this.fixedStep()
    const idle=()=>{
      if(this.state==='idle'||this.state==='ready')this.state=this.game.player.position.distanceTo(this.startPosition)<18?'ready':'idle'
      if(this.running)this.targetMaterial.opacity=0.21+Math.sin(this.game.ticker.elapsedScaled*3)*0.045
      // Fuses burn and the Armco moves whether or not a race is on.
      this.updateFurniture()
    }
    this.game.ticker.events.on('fixed',fixed,9);this.game.ticker.events.on('tick',idle,14)
    const visibility=()=>this.syncPause(performance.now())
    document.addEventListener('visibilitychange',visibility)
    this.bin.add(()=>document.removeEventListener('visibilitychange',visibility))
    this.bin.add(()=>{this.game.ticker.events.off('fixed',fixed);this.game.ticker.events.off('tick',idle)})
  }
  private box(size:[number,number,number],p:[number,number,number],material:THREE.Material):THREE.Mesh {
    const geo=new THREE.BoxGeometry(...size);this.bin.add(()=>geo.dispose())
    const mesh=new THREE.Mesh(geo,material);mesh.position.set(...p);this.group.add(mesh);return mesh
  }
  private label(text:string,p:THREE.Vector3,width:number,yaw:number):void {
    const {texture,aspect}=textTexture({text,size:128,color:'#f4f0df',background:'#24352e'})
    this.bin.add(()=>texture.dispose())
    const geo=new THREE.PlaneGeometry(width,width/aspect);this.bin.add(()=>geo.dispose())
    const mesh=new THREE.Mesh(geo,this.game.materials.own(new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide})))
    mesh.position.copy(p);mesh.rotation.y=yaw;this.group.add(mesh)
  }
  private buildTrack():void {
    const points=this.curve.getSpacedPoints(240),positions:number[]=[],uvs:number[]=[],indices:number[]=[]
    const curbs:THREE.BufferGeometry[][]=[[],[]],arrows:THREE.BufferGeometry[]=[]
    for(let i=0;i<=240;i++) {
      const p=points[i],t=this.curve.getTangentAt(i/240),side=new THREE.Vector3(-t.z,0,t.x)
      for(const sign of [-1,1]) {
        const x=p.x+side.x*CIRCUIT.width/2*sign,z=p.z+side.z*CIRCUIT.width/2*sign
        positions.push(x,this.game.terrain.colliderHeightAt(x,z)+0.055,z);uvs.push(sign<0?0:1,i/12)
      }
      if(i<240)indices.push(i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2)
      if(i%2===0&&i<240)for(const sign of [-1,1]) {
        const x=p.x+side.x*(CIRCUIT.width/2+0.5)*sign,z=p.z+side.z*(CIRCUIT.width/2+0.5)*sign
        const geo=new THREE.BoxGeometry(2,0.13,0.9)
        geo.rotateY(Math.atan2(-t.z,t.x));geo.translate(x,this.game.terrain.colliderHeightAt(x,z)+0.08,z)
        curbs[(i/2)%2].push(geo)
      }
      if(i%12===5) {
        const shape=new THREE.Shape();shape.moveTo(-1.2,-0.8);shape.lineTo(1.3,0);shape.lineTo(-1.2,0.8);shape.lineTo(-0.5,0);shape.closePath()
        const geo=new THREE.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);geo.rotateY(Math.atan2(-t.z,t.x));geo.translate(p.x,this.game.terrain.colliderHeightAt(p.x,p.z)+0.085,p.z);arrows.push(geo)
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals()
    // The permanent ribbon follows the heightfield. Nothing disables the ground.
    // Asphalt, the same greys the roads are painted in. This ribbon used
    // to be a sage `#48534e`, which read as painted concrete over the
    // tarmac the terrain paints underneath it — two different surfaces
    // claiming the same ground.
    const mesh=new THREE.Mesh(geo,this.game.materials.tinted('#4b4a4e',0.95,0));mesh.receiveShadow=true;this.group.add(mesh);this.bin.add(()=>geo.dispose())
    for(const [i,pieces] of [...curbs,arrows].entries()) {
      const merged=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());if(!merged)continue
      this.bin.add(()=>merged.dispose());this.group.add(new THREE.Mesh(merged,this.game.materials.tinted(i===1?'#e07749':'#f1ead3',0.8,0)))
    }
    /* THE START GRID, twenty tiles across ten metres of tarmac. It
       was twelve tiles at a one-metre pitch — twelve metres of
       chequer on a track that is now ten wide, so the outer column
       on each side sat on the grass. Merged into two geometries as
       well: twenty-four loose boxes were twenty-four draw calls for
       a chequerboard. */
    const c=this.curve.getPointAt(0),t=this.curve.getTangentAt(0),side=new THREE.Vector3(-t.z,0,t.x)
    const yaw=Math.atan2(-t.z,t.x),tiles:THREE.BufferGeometry[][]=[[],[]]
    for(let row=0;row<2;row++)for(let i=0;i<CIRCUIT.width;i++) {
      const p=c.clone().addScaledVector(side,i-(CIRCUIT.width-1)/2).addScaledVector(t,row-0.5)
      const tile=new THREE.BoxGeometry(1,0.04,1)
      tile.rotateY(yaw);tile.translate(p.x,this.game.terrain.colliderHeightAt(p.x,p.z)+0.08,p.z)
      tiles[(row+i)%2].push(tile)
    }
    for(const [i,pieces] of tiles.entries()) {
      const merged=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());if(!merged)continue
      this.bin.add(()=>merged.dispose());this.group.add(new THREE.Mesh(merged,this.game.materials.get(i?'ink':'chalk')))
    }
  }

  /* ------------------------------------------------------------
     THE FIVE LIGHTS.

     Three unlabelled boxes on the gantry beam used to carry the
     countdown, six and a half metres up and edge-on to a driver
     sitting on the grid. This is the same three handles plus two,
     stacked on their own mast at the kerb where they are read: the
     countdown drives whatever is in `this.lights`, so nothing about
     `fixedStep` or `reset` changes. Five is what a start light tree
     has, and `beat` runs 3 -> 2 -> 1 -> 0, so `i >= beat - 1` fills
     it from the bottom and the whole column goes green on zero.

     No collider. Nothing else on this gantry has one either, and a
     6.6 m mast standing 6.6 m from the racing line is exactly the
     sort of thing the respawn audit relocates a spawn to avoid.
     ------------------------------------------------------------ */
  private buildLightTree(c:THREE.Vector3,side:THREE.Vector2,rotation:number):void {
    // NEGATIVE: the pit side. `road-landing-racestart` comes in on the
    // other one and meets the track a few metres past the line, so a
    // mast at +6.6 m would be standing in the middle of it.
    const out=-(CIRCUIT.width/2+1.6)
    const x=c.x+side.x*out,z=c.z+side.y*out,base=this.game.terrain.colliderHeightAt(x,z)
    const mast=this.box([0.26,6.4,0.26],[x,base+3.2,z],this.game.materials.get('graphite'))
    mast.rotation.y=rotation
    const housing=this.box([1.1,2.8,0.34],[x,base+4.47,z],this.game.materials.get('ink'))
    housing.rotation.y=rotation
    for(let l=0;l<5;l++) {
      const light=this.box([0.44,0.42,0.42],[x,base+3.35+l*0.56,z],this.game.materials.own(new THREE.MeshBasicMaterial({color:0x332f2a})))
      light.rotation.y=rotation
      this.lights.push(light)
    }
  }
  /**
   * Is this piece of trackside ground real ground?
   *
   * Everything here is deliberately INSIDE the circuit's own zone —
   * `allow: ['circuit']` — because trackside furniture is the one
   * thing that belongs in the corridor. Everything else is asked
   * honestly, and the answers were worth having: at a 10 m offset the
   * old barrier ring put eight pieces of Armco in the SEA on the west
   * and south runs, two on the ACHIEVEMENTS plate, one in the river
   * shore road, one in lake-west and one on top of the `landing-about`
   * board. None of that could ever fail a harness, because
   * `Physics.obstacleAt` excludes dynamic bodies and the layout
   * validator only sees declared footprints.
   */
  private trackFurnitureUsable(x:number,z:number):boolean {
    return blockedBy(x,z,{clearance:1.2,coastMargin:4,allow:['circuit'],
      margin:{road:0.5,respawn:1,plate:0.5}})===null
  }
  private buildTrackside(walls:{arc:number;span:number}[]):void {
    const length=this.curve.getLength()
    /* TEN METRES OFF THE LINE — five metres of run-off past the kerb,
       which is what the number was chosen to be when the track was
       14 m wide and `10` happened to equal `width/2 + 5`. Written
       down now so the two move together. */
    const offset=CIRCUIT.width/2+5
    const points=this.curve.getSpacedPoints(360),positions:THREE.Vector3[]=[],angles:number[]=[]
    /** Which way is away from the track, per barrier. Half of them are
     *  mirrored to the infield, so it is not a property of the lap. */
    const outwards:THREE.Vector3[]=[]
    const rejected:Record<string,number>={}
    for(let i=8;i<360;i+=13) {
      const arc=i/360*length
      // A tyre wall already owns the outside of the hairpins, at the
      // same offset. One barrier per wall used to stand inside it.
      if(walls.some(w=>Math.min(Math.abs(w.arc-arc),length-Math.abs(w.arc-arc))<w.span+3)){rejected.tyres=(rejected.tyres??0)+1;continue}
      if(Math.abs(((i/360)-CIRCUIT.jumpAt+1.5)%1-0.5)<0.035){rejected.jump=(rejected.jump??0)+1;continue}
      const p=points[i],t=this.curve.getTangentAt(i/360),side=new THREE.Vector3(-t.z,0,t.x)
      // Outboard first, inboard second. Half this lap runs within
      // twenty metres of the coast, so a barrier whose outboard side
      // is water goes on the infield rather than being dropped.
      // MEASURED: of twenty-eight slots the ground test rejects
      // sixteen outboard placements, and mirroring recovers ten of
      // them — twenty barriers instead of the twenty-four that were
      // there before, none of them in the sea.
      let at:THREE.Vector3|null=null,away:THREE.Vector3|null=null
      for(const s of [1,-1]) {
        const candidate=p.clone().addScaledVector(side,offset*s)
        /* THE LAP DOUBLES BACK. A barrier sits `offset` metres from
           its OWN stretch, so any threshold at or above `offset`
           rejects every barrier on the circuit — which is why this is
           just under it rather than the 11 m the rescale audit
           suggested. What it is really catching is the pinch where
           the south run and the return out of the esses pass 12.6 m
           apart: a 10 m offset there lands 2.6 m from the other
           carriageway, in the middle of it.
           The guard this replaces tested `hypot(at.x-238, at.z+196)`,
           a point from a world twice this size — it excluded nothing,
           anywhere, and had not since the island was rescaled. */
        if(points.some(q=>q.distanceToSquared(candidate)<(offset-0.6)**2)){rejected.doubling=(rejected.doubling??0)+1;continue}
        if(!this.trackFurnitureUsable(candidate.x,candidate.z)){rejected.ground=(rejected.ground??0)+1;continue}
        at=candidate;away=side.clone().multiplyScalar(s);break
      }
      if(!at||!away)continue
      at.y=this.game.terrain.colliderHeightAt(at.x,at.z)+.4
      positions.push(at);angles.push(Math.atan2(-t.z,t.x));outwards.push(away)
    }
    if(process.env.NODE_ENV==='development') {
      // Silence is how the last scatter shipped 117 of 270 props and
      // nobody knew which sets had vanished.
      console.info(`[circuit] ${positions.length} trackside barriers, rejected ${JSON.stringify(rejected)}`)
    }
    const geometry=new THREE.BoxGeometry(3.6,.65,.6),material=this.game.materials.tinted('#d8d8c2',.9,0)
    const barriers=new THREE.InstancedMesh(geometry,material,positions.length),dummy=new THREE.Object3D()
    barriers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const bodies:Physical[]=[],masts:THREE.BufferGeometry[]=[],flags:THREE.BufferGeometry[][]=[[],[]]
    positions.forEach((p,i)=>{
      dummy.position.copy(p);dummy.rotation.set(0,angles[i],0);dummy.updateMatrix();barriers.setMatrixAt(i,dummy.matrix)
      /*
        ARMCO THAT MOVES.

        These were `type: 'fixed'`, so clipping one at racing speed
        stopped a 2.5 kg car dead against a 3.6 m block of scenery —
        the single worst thing on the lap. Nine kilos is the number
        the props audit arrived at for "costs you time but is not a
        wall": three and a half times the chassis, so a glancing hit
        shifts it a metre and scrubs most of your speed, and a square
        hit at nineteen metres a second knocks it over instead of
        writing the run off.

        They start asleep and Rapier leaves them asleep, so the twenty
        of them cost one matrix write each at boot and nothing after.
      */
      bodies.push(this.game.physics.add({type:'dynamic',category:'object',position:p,rotation:dummy.quaternion,
        mass:9,friction:.7,restitution:.05,linearDamping:.9,angularDamping:1.4,sleeping:true,contactThreshold:18,
        colliders:[{shape:'cuboid',parameters:[1.8,.325,.3]}]}))
      if(i%4===0) {
        /* MARSHAL POST. The mast used to stand at the barrier's own
           x/z; now that the barrier can be shoved out from under it,
           it steps a metre back into the run-off and reads as its own
           post — which is what it always was, since it has never had
           a collider. Merged, too: fourteen loose masts and flags
           were fourteen draw calls. */
        const back=p.clone().addScaledVector(outwards[i],1.1)
        const mast=chamferedBox(.15,5,.15,.03);mast.translate(back.x,p.y+2.1,back.z);masts.push(mast)
        const cabin=chamferedBox(1.15,1.05,.85,.08);cabin.rotateY(angles[i]);cabin.translate(back.x,p.y+.5,back.z);masts.push(cabin)
        const flag=chamferedBox(1.9,1.1,.035,.012);flag.rotateY(angles[i]);flag.translate(back.x+1,p.y+4.3,back.z)
        flags[i%8?0:1].push(flag)
      }
    })
    barriers.castShadow=true;this.group.add(barriers);this.bin.add(()=>geometry.dispose())
    this.trackside={mesh:barriers,bodies,dirty:new Set()}
    this.mergeInto(masts,this.game.materials.get('metal'))
    this.mergeInto(flags[0],this.game.materials.tinted('#709b70',.8,0))
    this.mergeInto(flags[1],this.game.materials.tinted('#cf8b59',.8,0))
    const coneGeometry=new THREE.ConeGeometry(.38,1,8),cones=new THREE.InstancedMesh(coneGeometry,this.game.materials.get('accent'),8)
    /*
      THE PIT LANE, laid out from the START LINE and along its own
      tangent. These used to be written as `CIRCUIT.x - 7 + i * 2.3`,
      which was an offset from the circuit's LOCAL-TO-WORLD ORIGIN and
      only landed in the infield by coincidence of that offset. The
      circuit is authored in world coordinates now, so that origin is
      (0, 0) — the middle of the LANDING, fifty-seven metres from the
      start line and directly on top of the spawn.
    */
    // Read off the CURVE, not off `this.gates` — `buildTrackside` runs
    // BEFORE the gate loop, so the gates do not exist yet.
    const lineAt=this.curve.getPointAt(0)
    const lineTangent=this.curve.getTangentAt(0)
    const along=new THREE.Vector2(lineTangent.x,lineTangent.z).normalize()
    const across=new THREE.Vector2(-along.y,along.x)
    const lineRotation=Math.atan2(-along.y,along.x)
    const pit=(t:number,side:number)=>({
      x:lineAt.x+along.x*t+across.x*side,
      z:lineAt.z+along.y*t+across.y*side,
    })
    /*
      THIRTEEN METRES IN, NOT SIXTEEN, AND NO PIT BOXES BEHIND THEM.

      The infield at the start line is a five-metre strip between the
      circuit corridor and lake-west-0. Sixteen and eighteen metres
      were measured on a 14 m track and a 380 m island: on this one
      every cone from t = -9 to t = +6 and the PIT / RESET board stood
      IN the lake. `width/2 + 8` is the far edge of the strip, checked
      against the layout registry rather than guessed.

      That strip is also why there are no pit garages here, which the
      dressing brief asked for: a three-bay block needs five metres of
      depth and there are three.
    */
    const lane=CIRCUIT.width/2+8
    for(let i=0;i<8;i++){
      const at=pit(-9+i*2.3,-lane)
      dummy.position.set(at.x,this.game.terrain.colliderHeightAt(at.x,at.z)+.5,at.z)
      dummy.rotation.set(0,0,0);dummy.updateMatrix();cones.setMatrixAt(i,dummy.matrix)
    }
    this.group.add(cones);this.bin.add(()=>coneGeometry.dispose())
    {
      const at=pit(-1,-lane)
      this.label('PIT / RESET',new THREE.Vector3(at.x,this.game.terrain.colliderHeightAt(at.x,at.z)+4,at.z),9,lineRotation+Math.PI/2)
    }
    /* THE JUMP is authored in `ramps` as `ramp-circuit-jump`, not built
       here. The world already has a ramp builder that gets the mesh,
       the convex hull and the vermilion lip right, and a second one
       written from the track's tangent got the rotation convention
       backwards and left a slab hanging in the air. */
  }

  /* ------------------------------------------------------------
     READING THE LAP

     Nothing below writes down a fraction of the circuit. `RACE_LINE`
     is REGENERATED by `scripts/mapcal/emit-ts.mjs` every time the
     drawing is re-traced, and `relax()` changes the SHAPE of the line
     rather than just its size — the last pass moved the whole thing
     and took the lap from 951 m to 633. A fraction hard-coded here is
     a crate in a hairpin one regeneration later.

     So the corners and the straights are MEASURED instead: the radius
     of the arc through a fourteen-metre window (five car lengths) at
     one sample per metre. On today's centreline the runs above 45 m
     of radius are exactly three — 228-313 m (the west run, past the
     TNT quarry), 341-430 m (the south run, with the jump in the
     middle of it) and 463-480 m (the drop out of the sweeper into the
     esses) — and the three tightest corners are at 34 m, 514 m and
     585 m of the lap.
     ------------------------------------------------------------ */
  private profile:{radius:number[];turn:number[];step:number;count:number}|null=null
  private lapCurvature():{radius:number[];turn:number[];step:number;count:number} {
    if(this.profile)return this.profile
    const length=this.curve.getLength(),count=Math.max(64,Math.round(length)),step=length/count
    const points=this.curve.getSpacedPoints(count),heading:number[]=[]
    for(let i=0;i<count;i++){const a=points[i],b=points[(i+1)%count];heading.push(Math.atan2(b.z-a.z,b.x-a.x))}
    const window=Math.max(2,Math.round(14/step)),radius:number[]=[],turn:number[]=[]
    for(let i=0;i<count;i++) {
      let d=heading[(i+window)%count]-heading[i]
      while(d>Math.PI)d-=Math.PI*2
      while(d<-Math.PI)d+=Math.PI*2
      turn.push(d);radius.push(Math.abs(d)<1e-6?Infinity:(window*step)/Math.abs(d))
    }
    this.profile={radius,turn,step,count}
    return this.profile
  }
  /** Point, outward normal and yaw at a distance ALONG the lap. */
  private lapAt(arc:number):{point:THREE.Vector3;side:THREE.Vector3;yaw:number} {
    const u=(((arc/this.curve.getLength())%1)+1)%1
    const point=this.curve.getPointAt(u),t=this.curve.getTangentAt(u)
    return {point,side:new THREE.Vector3(-t.z,0,t.x),yaw:Math.atan2(-t.z,t.x)}
  }
  /** Stretches of at least `minLength` metres that never turn tighter
   *  than `minRadius`, as arc distances from the start line. */
  private lapRuns(minRadius:number,minLength:number):{from:number;to:number}[] {
    const {radius,step,count}=this.lapCurvature()
    // Begin the walk at a CORNER, or a run spanning the start line is
    // reported as two short ones and neither survives the filter.
    let origin=0
    while(origin<count&&radius[origin]>minRadius)origin++
    const runs:{from:number;to:number}[]=[]
    let open=-1
    for(let k=0;k<count;k++) {
      const i=(origin+k)%count
      if(radius[i]>minRadius){if(open<0)open=k}
      else if(open>=0){runs.push({from:(origin+open)*step,to:(origin+k-1)*step});open=-1}
    }
    if(open>=0)runs.push({from:(origin+open)*step,to:(origin+count-1)*step})
    return runs.filter(r=>r.to-r.from>=minLength)
  }
  /** The shortest gap from a run to a point on the lap, wrapped. */
  private lapGap(run:{from:number;to:number},arc:number):number {
    const length=this.curve.getLength()
    let best=Infinity
    for(const a of [arc-length,arc,arc+length])best=Math.min(best,Math.abs(Math.max(run.from,Math.min(run.to,a))-a))
    return best
  }
  private nearestArc(x:number,z:number):number {
    const length=this.curve.getLength(),count=Math.max(64,Math.round(length))
    const points=this.curve.getSpacedPoints(count)
    let best=0,distance=Infinity
    for(let i=0;i<count;i++) {
      const d=(points[i].x-x)**2+(points[i].z-z)**2
      if(d<distance){distance=d;best=i}
    }
    return best/count*length
  }
  /** One merged mesh from many small geometries. Every piece has to
   *  come from the same family — `chamferedBox` returns a hull with
   *  position and normal only, `BoxGeometry` also carries uv, and
   *  `mergeGeometries` refuses the mixture. */
  private mergeInto(pieces:THREE.BufferGeometry[],material:THREE.Material):void {
    if(pieces.length===0)return
    const merged=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());if(!merged)return
    this.bin.add(()=>merged.dispose())
    const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;this.group.add(mesh)
  }

  /* ------------------------------------------------------------
     THE GRANDSTAND, on the outside of the last corner, looking down
     the pit straight at the line — which is the only place on this
     lap that has room for one.

     The dressing brief asked for it on the west straight. There is
     nowhere to put it there: measured at 16, 20 and 24 m off that
     centreline, the inland side is the TNT quarry's pad and then
     lake-west-0, and the seaward side is past the coastline at
     twenty. The pocket here is 13 m deep between the corridor and the
     road in from the LANDING, and the whole footprint is checked
     against the layout registry before a single terrace is built.
     ------------------------------------------------------------ */
  private buildGrandstand():void {
    const offset=CIRCUIT.width/2+10,arc=this.curve.getLength()-18,half=6
    // Sampled across the WHOLE footprint the collider will occupy, not
    // just its centre: the pocket is 13 m deep and the block is 5.
    for(let d=-half;d<=half+0.01;d+=3)for(const depth of [-3,0,3]) {
      const {point,side}=this.lapAt(arc+d)
      const q=point.addScaledVector(side,offset+depth)
      if(this.trackFurnitureUsable(q.x,q.z))continue
      if(process.env.NODE_ENV==='development')console.info('[circuit] no room for a grandstand at the last corner')
      return
    }
    const {point,side,yaw}=this.lapAt(arc)
    const base=point.addScaledVector(side,offset)
    base.y=this.game.terrain.colliderHeightAt(base.x,base.z)
    const back=new THREE.Vector3(side.x,0,side.z)
    const terraces:THREE.BufferGeometry[]=[],crowd:THREE.BufferGeometry[][]=[[],[]]
    for(let row=0;row<4;row++) {
      const at=base.clone().addScaledVector(back,row*1.15-1.7)
      const step=chamferedBox(half*2,0.75+row*0.85,1.2,0.06)
      step.rotateY(yaw);step.translate(at.x,base.y+(0.75+row*0.85)/2,at.z)
      terraces.push(step)
      // Thirty-two cubes of crowd in two colours. Flat-shaded 0.42 m
      // boxes read as people at the thirty metres this is seen from,
      // and cost two draw calls between them.
      for(let seat=0;seat<8;seat++) {
        const along=(seat-3.5)*(half*2/8)
        const person=chamferedBox(0.42,0.5,0.36,0.05)
        person.rotateY(yaw)
        person.translate(at.x+Math.cos(yaw)*along,base.y+0.75+row*0.85+0.25,at.z-Math.sin(yaw)*along)
        crowd[(row+seat)%2].push(person)
      }
    }
    this.mergeInto(terraces,this.game.materials.get('concrete'))
    this.mergeInto(crowd[0],this.game.materials.get('paperDark'))
    this.mergeInto(crowd[1],this.game.materials.tinted('#8a6f52',0.9,0))
    // One collider for the block. It is fifteen metres off the racing
    // line, five past the Armco, and the autopilot abandons a run at
    // eighteen — nothing following the line can reach it.
    // Centred on `base` and no deeper than the ground that was
    // sampled above: a collider that reaches past its own clearance
    // test is a collider nobody has checked.
    this.game.physics.add({type:'fixed',category:'object',
      position:{x:base.x,y:base.y+1.4,z:base.z},
      rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,0)),
      colliders:[{shape:'cuboid',parameters:[half,1.4,2.6]}]})
    this.label('NEWPORT',base.clone().add(new THREE.Vector3(0,5.4,0)),7,yaw+Math.PI/2)
  }

  /* ------------------------------------------------------------
     TYRE WALLS on the outside of the three tightest corners, at the
     same ten metres as the Armco — which is what a tyre wall is FOR,
     so the barrier that would have stood there is skipped rather than
     stacked inside it.

     Static, and deliberately so: a corner needs something that does
     not give. Ten metres is five metres of run-off past the kerb, and
     the autopilot aborts a run at eighteen metres off the line, so
     nothing that follows the racing line can reach one.

     ONE COLLIDER PER RUN OF FOUR TYRES, not one per tyre. Twenty-six
     tyres a wall at one collider each would be seventy-eight bodies
     for three corners, and Rapier would be resolving contacts between
     tyres that are welded to the ground.
     ------------------------------------------------------------ */
  private buildTyreWalls():{arc:number;span:number}[] {
    const {radius,turn,step,count}=this.lapCurvature()
    const length=this.curve.getLength(),offset=CIRCUIT.width/2+5,span=7,pitch=1.15
    const candidates:{arc:number;radius:number;out:number}[]=[]
    for(let i=0;i<count;i++)if(radius[i]<17)candidates.push({arc:i*step,radius:radius[i],out:turn[i]>0?-1:1})
    candidates.sort((a,b)=>a.radius-b.radius)
    const walls:{arc:number;span:number;out:number}[]=[]
    for(const c of candidates) {
      if(walls.length===3)break
      if(walls.some(w=>Math.min(Math.abs(w.arc-c.arc),length-Math.abs(w.arc-c.arc))<30))continue
      // The WHOLE run has to be on real ground, not just its middle:
      // two of the tightest corners on this lap hang over the coast.
      let clear=true
      for(let d=-span;d<=span+0.01&&clear;d+=pitch) {
        const {point,side}=this.lapAt(c.arc+d)
        const q=point.addScaledVector(side,offset*c.out)
        clear=this.trackFurnitureUsable(q.x,q.z)
      }
      if(clear)walls.push({arc:c.arc,span,out:c.out})
    }
    if(walls.length===0)return []
    const steps=Math.floor((span*2)/pitch)+1
    const geometry=wheelGeometry(0.62,0.42,10)
    // `wheelGeometry` lies the cylinder on Z for a car wheel. A tyre
    // in a wall lies FLAT, so it goes back upright again.
    geometry.rotateX(Math.PI/2)
    const tyres=new THREE.InstancedMesh(geometry,this.game.materials.get('ink'),walls.length*steps*2)
    const dummy=new THREE.Object3D()
    let index=0
    for(const wall of walls) {
      const bases:THREE.Vector3[]=[]
      for(let s=0;s<steps;s++) {
        const arc=wall.arc-span+s*pitch
        const {point,side,yaw}=this.lapAt(arc)
        const at=point.addScaledVector(side,offset*wall.out)
        at.y=this.game.terrain.colliderHeightAt(at.x,at.z)
        bases.push(at)
        for(let row=0;row<2;row++) {
          dummy.position.set(at.x,at.y+0.22+row*0.42,at.z)
          dummy.rotation.set(0,yaw+row*0.4,0);dummy.updateMatrix()
          tyres.setMatrixAt(index++,dummy.matrix)
        }
      }
      for(let s=0;s<bases.length;s+=4) {
        const run=bases.slice(s,s+4),mid=run[Math.floor(run.length/2)]
        const centre=run.reduce((v,p)=>v.add(p),new THREE.Vector3()).multiplyScalar(1/run.length)
        const {yaw}=this.lapAt(wall.arc-span+(s+run.length/2-0.5)*pitch)
        this.game.physics.add({type:'fixed',category:'object',
          position:{x:centre.x,y:mid.y+0.42,z:centre.z},
          rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,0)),
          colliders:[{shape:'cuboid',parameters:[run.length*pitch/2+0.2,0.42,0.62]}]})
      }
    }
    tyres.count=index;tyres.castShadow=true
    this.group.add(tyres);this.bin.add(()=>geometry.dispose())
    return walls.map((w)=>({arc:w.arc,span:w.span}))
  }

  /* ------------------------------------------------------------
     THE OBSTACLES.

     TNT on the west run, timber on the approach to the esses, and the
     two sites are FOUND rather than written down (see READING THE LAP
     above). The crates go on whichever straight the TNT quarry
     actually stands beside, because that is the fiction — the stack
     has spilled onto the circuit — and because the quarry is the one
     landmark on the lap that names itself in the content layer.

     The timber goes on the longest straight that is neither that one
     nor the one carrying the jump. Today that is the drop out of the
     sweeper, and it is the right place for a chicane for a reason
     that is not aesthetic: the autopilot's own speed target falls to
     7-10 m/s there because it can see the esses coming, against 12-19
     on the two long runs. A slalom is something you thread slowly.
     ------------------------------------------------------------ */
  private buildObstacles():void {
    const runs=this.lapRuns(45,16)
    const quarry=PLAY_SPOTS.find((spot)=>spot.id==='tnt')
    if(runs.length===0||!quarry) {
      if(process.env.NODE_ENV==='development')console.warn('[circuit] no straight long enough for obstacles')
      return
    }
    const quarryArc=this.nearestArc(quarry.x,quarry.z)
    const crateRun=runs.find((r)=>quarryArc>=r.from&&quarryArc<=r.to)
      ??runs.slice().sort((a,b)=>this.lapGap(a,quarryArc)-this.lapGap(b,quarryArc))[0]

    /*
      THE FIELD: [metres along the lap from the quarry's own point on
      it, which side of the centreline, tier].

      Laid mostly UPSTREAM of the quarry so the car meets the spill
      before it passes the stack it came from. The lateral offset is
      the corridor plus half a crate, so the inner face lands exactly
      on 2.8 m and the outer at 4.4 — inside the 4.79 m where a gate
      post stands. Rows alternate: one crate leaves 7.9 m of clear
      track, a facing pair leaves 5.6.
    */
    const FIELD:[number,number,number][]=[
      [-40,-1,0],[-40,-1,1],[-40,1,0],
      [-29,1,0],[-29,1,1],
      [-18,-1,0],[-18,1,0],
      [-8,-1,0],[-8,-1,1],
      [2,1,0],[2,1,1],[2,-1,0],
    ]
    const SIDE=1.6
    // BoxGeometry, not `chamferedBox`: the hull carries no uv, and the
    // whole point of a TNT crate is that it says TNT on the side.
    const crateGeometry=new THREE.BoxGeometry(SIDE,SIDE,SIDE)
    const {texture}=textTexture({text:'TNT',size:96,weight:800,letterSpacing:0.14,padding:78,
      color:'#f0e4c4',background:'#b34535'})
    this.bin.add(()=>texture.dispose())
    const crates=new THREE.InstancedMesh(crateGeometry,
      this.game.materials.own(new THREE.MeshStandardMaterial({map:texture,roughness:0.84,flatShading:true})),
      FIELD.length)
    crates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);crates.castShadow=true;crates.count=0
    this.group.add(crates);this.bin.add(()=>crateGeometry.dispose())
    for(const [along,hand,tier] of FIELD) {
      const arc=Math.max(crateRun.from+6,Math.min(crateRun.to-6,quarryArc+along))
      const {point,side,yaw}=this.lapAt(arc)
      const at=point.addScaledVector(side,hand*(CORRIDOR+SIDE/2))
      // Two centimetres of air between the tiers: stacked flush, the
      // top crate started the frame inside the bottom one and Rapier
      // launched the pair.
      at.y=this.game.terrain.colliderHeightAt(at.x,at.z)+0.09+SIDE/2+tier*(SIDE+0.02)
      // 0.8 kg against a 2.5 kg chassis. The quarry's crates are 0.85
      // and the car bulldozes those, which is the point: a crate that
      // survives contact at racing speed is a wall with a label on it.
      this.placeObstacle('tnt',crates,at,yaw,{half:[SIDE/2,SIDE/2,SIDE/2],mass:0.8,friction:0.5,threshold:8})
    }

    const length=this.curve.getLength(),jumpArc=CIRCUIT.jumpAt*length
    const slalomRun=runs.filter((r)=>r!==crateRun&&this.lapGap(r,jumpArc)>24&&this.lapGap(r,0)>24)
      .sort((a,b)=>(b.to-b.from)-(a.to-a.from))[0]
    if(!slalomRun) {
      if(process.env.NODE_ENV==='development')console.warn('[circuit] no straight left for the timber slalom')
      return
    }
    /*
      TIMBER, and it breaks.

      2.6 m long, offset by the corridor plus its own half-length and
      a tenth of a metre: the inner end is at 2.9 and the outer at
      5.5, which overhangs the kerb on purpose so it reads as a
      barrier rather than a plank on the tarmac. Alternate sides leave
      7.9 m of track each time, and the car has to move about four
      metres across in six to take them cleanly.

      Six kilos is the whole design. A 2.5 kg car into a 6 kg barrier
      loses most of its speed in the contact — that is the "costs you
      time" — and then the barrier BREAKS rather than sitting there as
      something to beach on, because a race that can be ended by one
      touch is a race nobody finishes.
    */
    const BARRIERS=4,HALF=1.3,gateSpacing=length/this.gateCount
    const timberGeometry=mergeGeometries([
      (()=>{const g=chamferedBox(0.16,0.95,0.16,0.03);g.translate(-1.2,0,0);return g})(),
      (()=>{const g=chamferedBox(0.16,0.95,0.16,0.03);g.translate(1.2,0,0);return g})(),
      (()=>{const g=chamferedBox(2.6,0.26,0.13,0.03);g.translate(0,-0.2,0);return g})(),
      (()=>{const g=chamferedBox(2.6,0.26,0.13,0.03);g.translate(0,0.24,0);return g})(),
    ])
    const timber=new THREE.InstancedMesh(timberGeometry,this.game.materials.get('timber'),BARRIERS)
    timber.instanceMatrix.setUsage(THREE.DynamicDrawUsage);timber.castShadow=true;timber.count=0
    this.group.add(timber);this.bin.add(()=>timberGeometry.dispose())
    const usable=slalomRun.to-slalomRun.from-6
    for(let i=0;i<BARRIERS;i++) {
      let arc=slalomRun.from+3+usable*(i/(BARRIERS-1))
      // A gate post is 0.42 m of solid box at the kerb, and a barrier
      // reaching 5.5 m out would be spawned inside one.
      const nearestGate=Math.round(arc/gateSpacing)*gateSpacing
      if(Math.abs(arc-nearestGate)<3)arc=nearestGate+(arc>=nearestGate?3:-3)
      const {point,side,yaw}=this.lapAt(arc)
      const at=point.addScaledVector(side,(i%2?1:-1)*(CORRIDOR+HALF+0.1))
      at.y=this.game.terrain.colliderHeightAt(at.x,at.z)+0.55
      // ACROSS the track, not along it. `yaw` puts a body's local +X
      // down the tangent — which is what the Armco wants and the
      // opposite of what a chicane wants; laid the Armco way these
      // were four kerbstones that nobody had to steer around.
      this.placeObstacle('timber',timber,at,yaw+Math.PI/2,{half:[HALF,0.48,0.12],mass:6,friction:0.7,threshold:10})
    }
    if(process.env.NODE_ENV==='development') {
      console.info(`[circuit] ${FIELD.length} TNT crates at ${crateRun.from.toFixed(0)}-${crateRun.to.toFixed(0)} m, `
        +`${BARRIERS} timber barriers at ${slalomRun.from.toFixed(0)}-${slalomRun.to.toFixed(0)} m of a ${length.toFixed(0)} m lap`)
    }
  }
  private placeObstacle(kind:'tnt'|'timber',mesh:THREE.InstancedMesh,at:THREE.Vector3,yaw:number,
    spec:{half:[number,number,number];mass:number;friction:number;threshold:number}):void {
    const index=mesh.count
    const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,0))
    const physical=this.game.physics.add({type:'dynamic',category:'object',position:at,rotation,
      mass:spec.mass,friction:spec.friction,restitution:0.06,linearDamping:0.3,angularDamping:0.7,
      contactThreshold:spec.threshold,colliders:[{shape:'cuboid',parameters:spec.half}]})
    // Written NOW, not on the first tick. An InstancedMesh whose count
    // has grown past its written matrices draws the new instances at
    // the identity — twelve crates in the middle of the LANDING for
    // one frame at every boot.
    this.sampleMatrix.compose(at,rotation,this.sampleScale)
    mesh.setMatrixAt(index,this.sampleMatrix);mesh.instanceMatrix.needsUpdate=true
    const obstacle:Obstacle={kind,mesh,index,physical,fuse:-1,gone:false,goneAt:-1,armedAt:2}
    // Assigned after the body exists so the handler can close over the
    // obstacle. `contactThreshold` is what arms the contact events, so
    // a late handler still receives them — the same trick the TNT
    // quarry uses for exactly this reason.
    physical.onCollision=(force,p)=>this.hitObstacle(obstacle,force,p)
    this.obstacles.push(obstacle)
    mesh.count=index+1
    this.obstacleDirty.add(obstacle)
  }
  private hitObstacle(obstacle:Obstacle,force:number,at:{x:number;y:number;z:number}):void {
    if(obstacle.gone||this.game.ticker.elapsed<obstacle.armedAt)return
    if(obstacle.kind==='timber') {
      /* SPEED, not force. Rapier reports whatever the contact
         resolves to, and a 6 kg barrier leaned on by a stationary
         car can report more than a fast clip of a 0.8 kg crate — so
         a force threshold makes the planks give at a standstill and
         hold at speed, which is backwards. What actually decides is
         how fast the car was going, and that is a number this can
         just read. Five metres a second is a third of racing pace:
         below it the barrier is shoved and you lose the time, above
         it the timber goes. */
      const v=this.game.vehicle.chassis.physical.body.linvel()
      if(Math.hypot(v.x,v.z)>5)this.breakObstacle(obstacle,at)
      return
    }
    // 42 is the quarry's own number for "hit hard enough to light a
    // fuse", measured on a crate of the same mass. Matching it means
    // the two sets of TNT on this island behave the same way.
    if(force>42&&obstacle.fuse<0)obstacle.fuse=0.45
  }
  private breakObstacle(obstacle:Obstacle,at:{x:number;y:number;z:number}):void {
    if(obstacle.gone)return
    obstacle.gone=true;obstacle.fuse=-1;obstacle.goneAt=this.game.ticker.elapsed
    obstacle.physical.body.setEnabled(false)
    this.obstacleDirty.add(obstacle)
    const where=new THREE.Vector3(at.x,at.y,at.z)
    if(obstacle.kind==='timber') {
      this.game.particles.burst(where,10,'debris');this.game.particles.burst(where,4,'dust')
      this.game.audio.impact(46)
      return
    }
    /*
      THE QUARRY'S BLAST IS TOO BIG FOR A RACE.

      `Playground.explode` pushes everything within ten metres at
      `mass * 8`, which is eight metres a second of delta-v on the
      chassis — fine standing in a quarry, and a rolled car on the
      west run at nineteen. Seven metres and 2.6 for the car is a
      shove that costs a second and leaves it pointing the right way;
      everything else still gets the full six, because crates flying
      is the entire show.

      The per-chassis cooldown is not decoration either: a stack of
      three chains in under a fifth of a second, and three impulses in
      three frames put the car in the sea.
    */
    const blast=7
    for(const physical of this.game.physics.physicals) {
      if(physical.static||!physical.body.isEnabled()||physical===obstacle.physical)continue
      const delta=physical.current.position.clone().sub(where),distance=delta.length()
      if(distance>blast)continue
      const chassis=physical===this.game.vehicle.chassis.physical
      if(chassis) {
        if(this.game.ticker.elapsed-this.lastBlast<0.35)continue
        this.lastBlast=this.game.ticker.elapsed
      }
      delta.y=Math.max(1,delta.y)
      delta.normalize().multiplyScalar((1-distance/blast)*physical.body.mass()*(chassis?2.6:6))
      physical.body.applyImpulse(delta,true)
    }
    for(const other of this.obstacles) {
      if(other===obstacle||other.gone||other.kind!=='tnt'||other.fuse>=0)continue
      const distance=other.physical.current.position.distanceTo(where)
      if(distance<blast*0.8)other.fuse=0.12+distance*0.05
    }
    this.game.particles.burst(where,10,'debris')
    this.game.particles.burst(where,12,'smoke')
    this.game.particles.burst(where,8,'spark')
    this.game.ecology?.burst(where,2)
    const proximity=Math.max(0,1-this.game.player.position.distanceTo(where)/65)
    if(proximity>0&&this.game.ticker.elapsed-this.lastBlastSound>0.1) {
      this.lastBlastSound=this.game.ticker.elapsed
      this.game.audio.environment('explosion',proximity)
      if(!this.game.reducedMotion)this.game.view.kick(proximity*0.22)
    }
  }
  private rack(obstacle:Obstacle):void {
    this.game.physics.reset(obstacle.physical)
    obstacle.gone=false;obstacle.fuse=-1;obstacle.goneAt=-1
    obstacle.armedAt=this.game.ticker.elapsed+2
    this.obstacleDirty.add(obstacle)
  }
  /** Every obstacle back on the track, and every shoved barrier back
   *  on its patch of run-off. Bound to the race reset, so a second
   *  attempt is the same lap as the first. */
  private rackObstacles():void {
    for(const obstacle of this.obstacles)this.rack(obstacle)
    if(!this.trackside)return
    // `reset` re-sleeps anything created asleep, so putting twenty
    // barriers back costs twenty matrix writes and then nothing.
    this.trackside.bodies.forEach((body,i)=>{this.game.physics.reset(body);this.trackside?.dirty.add(i)})
    this.updateFurniture()
  }
  private updateFurniture():void {
    const alpha=this.game.ticker.alpha
    if(this.trackside) {
      // The Armco is asleep until something hits it, and Rapier keeps
      // it that way — twenty bodies, one matrix write each at boot.
      const {mesh,bodies,dirty}=this.trackside
      let wrote=false
      for(let i=0;i<bodies.length;i++) {
        const sleeping=bodies[i].body.isSleeping()
        if(sleeping&&!dirty.has(i))continue
        this.game.physics.sample(bodies[i],alpha,this.samplePosition,this.sampleQuaternion)
        this.sampleMatrix.compose(this.samplePosition,this.sampleQuaternion,this.sampleScale)
        mesh.setMatrixAt(i,this.sampleMatrix);wrote=true
        if(sleeping)dirty.delete(i);else dirty.add(i)
      }
      if(wrote)mesh.instanceMatrix.needsUpdate=true
    }
    if(this.obstacles.length===0)return
    const now=this.game.ticker.elapsed,delta=this.game.ticker.delta
    const touched=new Set<THREE.InstancedMesh>()
    for(const obstacle of this.obstacles) {
      if(obstacle.fuse>=0) {
        obstacle.fuse-=delta
        if(obstacle.fuse<=0)this.breakObstacle(obstacle,obstacle.physical.current.position)
      }
      if(obstacle.gone) {
        /* RE-RACKING. A straight that is clear after one pass has
           obstacles once. The race reset puts them all back, but free
           roam has no reset, so a broken one comes back ten seconds
           later — and only once the car is sixty metres away, because
           a crate that reappears in the mirror is worse than a
           straight without one. */
        const ready=!this.running&&now-obstacle.goneAt>10
          &&this.game.player.position.distanceTo(obstacle.physical.current.position)>60
        if(!ready) {
          if(!this.obstacleDirty.has(obstacle))continue
          // Scaled to nothing rather than hidden: an InstancedMesh has
          // no per-instance visibility, and shortening `count` would
          // renumber every instance after it.
          this.sampleMatrix.makeScale(0,0,0)
          obstacle.mesh.setMatrixAt(obstacle.index,this.sampleMatrix)
          this.obstacleDirty.delete(obstacle);touched.add(obstacle.mesh)
          continue
        }
        // Fall through: `rack` clears `gone`, and the write below puts
        // the crate back at full size in the same tick rather than
        // leaving it at zero scale for one more frame.
        this.rack(obstacle)
      }
      const sleeping=obstacle.physical.body.isSleeping()
      if(sleeping&&!this.obstacleDirty.has(obstacle))continue
      this.game.physics.sample(obstacle.physical,alpha,this.samplePosition,this.sampleQuaternion)
      this.sampleMatrix.compose(this.samplePosition,this.sampleQuaternion,this.sampleScale)
      obstacle.mesh.setMatrixAt(obstacle.index,this.sampleMatrix);touched.add(obstacle.mesh)
      if(sleeping)this.obstacleDirty.delete(obstacle)
      else this.obstacleDirty.add(obstacle)
    }
    for(const mesh of touched)mesh.instanceMatrix.needsUpdate=true
  }

  start():boolean {
    if(this.running)return true
    this.state=RaceState.RESETTING;this.reset();this.prepareAttempt()
    this.state=RaceState.COUNTDOWN;this.countdown=3;this.lastBeat=4
    this.countdownStart=performance.now();this.clockStart=0
    this.game.inputs.setFilters([]);this.game.player.setState('locked')
    this.game.vehicle.moveTo(this.startPosition,this.startRotation)
    this.previous.copy(this.startPosition);this.hasPrevious=true;this.origin.copy(this.startPosition)
    this.setTarget(0);this.publish();this.events.trigger('start');return true
  }
  protected reset():void {
    if(this.pausedAt!==null)this.game.vehicle.chassis.physical.body.setEnabled(true)
    this.pausedAt=null
    this.elapsed=0;this.reached=0;this.splits=[];this.recoveries=0;this.lastHud=-1;this.hasPrevious=false
    if(this.target)this.target.visible=false
    // Every crate and every barrier, back where it started. `reset` is
    // called on start AND on cancel, so an abandoned attempt does not
    // leave the next one an empty straight.
    this.rackObstacles()
    for(const m of this.gateMaterials)m.color.set('#6d8270')
    for(const l of this.lights)(l.material as THREE.MeshBasicMaterial).color.set('#332f2a')
    this.game.player.setState('default')
  }
  cancel(reason:'player'|'strayed'|'respawn'='player'):void {
    this.prepareAttempt();this.state=RaceState.RESETTING;this.reset();this.state=RaceState.IDLE
    this.game.store.getState().setMinigame(null);this.events.trigger('cancel',[reason])
  }
  update():void{if(this.running)this.publish()}
  protected tick():void{ /* Detection runs after each physics step. */ }
  private syncPause(now:number):boolean {
    if(!this.running)return false
    const pause=this.game.store.getState().overlay!==null||document.hidden
    if(pause&&this.pausedAt===null){this.pausedAt=now;this.game.vehicle.chassis.physical.body.setEnabled(false)}
    else if(!pause&&this.pausedAt!==null){
      const duration=now-this.pausedAt;this.clockStart+=duration;this.countdownStart+=duration;this.pausedAt=null
      this.game.vehicle.chassis.physical.body.setEnabled(true);this.previous.copy(this.game.player.position);this.hasPrevious=false
    }
    return pause
  }
  private fixedStep():void {
    if(!this.running)return
    const now=performance.now()
    if(this.syncPause(now))return
    const p=this.game.player.position
    /*
      STRAYED, measured off the RACING LINE. It used to be a 200 m
      radius around the circuit's local origin, which worked only while
      that origin happened to sit in the middle of the track. On a
      634 m lap authored in world coordinates the origin is off the
      circuit entirely, and the south corner is 130 m from it — one bad
      line away from cancelling a clean race.
    */
    if(lineDistance(p.x,p.z,CIRCUIT_TRACK)>this.strayRadius){this.cancel('strayed');return}
    if(this.state===RaceState.COUNTDOWN) {
      this.countdown=Math.max(0,3-(now-this.countdownStart)/1000)
      const beat=Math.max(0,Math.ceil(this.countdown))
      if(beat!==this.lastBeat) {
        this.lastBeat=beat;this.game.audio.blip(beat===0?1.7:0.75)
        this.lights.forEach((l,i)=>(l.material as THREE.MeshBasicMaterial).color.set(beat===0?'#82db9a':i>=beat-1?'#ef714d':'#332f2a'))
      }
      if(this.countdown<=0){this.state=RaceState.RACING;this.elapsed=0;this.clockStart=now;this.previous.copy(p);this.game.player.setState('default')}
      return
    }
    const before=this.elapsed;this.elapsed=(now-this.clockStart)/1000
    const delta=this.elapsed-before
    if(p.y<this.game.terrain.colliderHeightAt(p.x,p.z)-3){this.recover();return}
    // A teleport is not a driven sweep. Boost travels <3m per fixed step.
    if(this.hasPrevious&&this.previous.distanceToSquared(p)<144) {
      const gate=this.gates[this.reached%this.gateCount],fraction=crossGate(this.previous,p,gate)
      if(fraction!==null) {
        this.reached++;this.splits.push(before+fraction*delta)
        this.gateMaterials[gate.index].color.set('#c7d1bd');this.game.audio.blip(1+(this.reached%this.gateCount)*0.04)
        // The first crossing launches lap 1; the final crossing ends lap 3.
        if(this.reached===CIRCUIT.laps*this.gateCount+1){this.elapsed=before+fraction*delta;this.completeRace()}
        else this.setTarget(this.reached%this.gateCount)
      }
    }
    this.previous.copy(p);this.hasPrevious=true
  }
  private setTarget(index:number):void {
    const gate=this.gates[index];this.target.visible=true;this.target.position.copy(gate.centre).y+=2.25
    this.target.rotation.y=gate.rotation+Math.PI/2;this.gateMaterials[index].color.set('#75dca3')
  }
  recover():boolean {
    if(!this.running)return false
    const index=this.reached===0?0:(this.reached-1)%this.gateCount,gate=this.gates[index]
    const p=gate.centre.clone().add(new THREE.Vector3(gate.normal.x*(this.reached?3:-7),0,gate.normal.y*(this.reached?3:-7)))
    p.y=this.game.terrain.colliderHeightAt(p.x,p.z)+1.6
    this.game.vehicle.moveTo(p,gate.rotation);this.game.player.position.copy(p)
    this.previous.copy(p);this.hasPrevious=false;this.recoveries++;this.game.tracks.reset();return true
  }
  private completeRace():void {
    this.target.visible=false
    const newBest=this.bestTime===null||this.elapsed<this.bestTime
    this.game.achievements.set('circuit',1)
    if(this.elapsed<CIRCUIT.laps*CIRCUIT.targetLapSeconds)this.game.achievements.set('speedDemon',1)
    if(this.recoveries===0)this.game.achievements.set('perfectRun',1)

    // THE LEADERBOARD. Ten entries, fastest first, with the date each
    // was set — the old version kept five bare numbers and showed none
    // of them. `at` is stamped here rather than in `Save`, because the
    // time a run was set is a fact about the run.
    const progress=this.game.save.data.progress
    const run={time:this.elapsed,at:Date.now()}
    progress.raceHistory=[...progress.raceHistory,this.elapsed].sort((a,b)=>a-b).slice(0,5)
    progress.raceBoard=[...progress.raceBoard,run].sort((a,b)=>a.time-b.time).slice(0,10)
    this.game.save.schedule()

    this.game.audio.play('achievement')
    // `finish` arms the result card's dismissal; `prepareAttempt` used
    // to be called straight after and cancelled it in the same frame,
    // so the card either never appeared or never left. The race's end
    // screen is dismissed by the player, so neither is wanted here.
    this.finish(this.elapsed)
    this.game.store.getState().setMinigame({
      id:this.id,title:this.title,lines:[],time:null,best:this.bestTime,progress:1,
      result:{
        headline:'FINISH',
        time:raceTime(this.elapsed),
        newBest,
        board:progress.raceBoard.map((entry)=>({
          time:raceTime(entry.time),at:entry.at,
          you:Math.abs(entry.time-run.time)<1e-6,
        })),
      },
    })
  }
  protected publish():void {
    if(!this.running)return
    const step=Math.floor(this.elapsed*20)+Math.ceil(this.countdown)*100000
    if(step===this.lastHud)return
    this.lastHud=step;super.publish()
  }
  protected lines():string[] {
    if(this.state===RaceState.COUNTDOWN)return [String(Math.ceil(this.countdown)),`${CIRCUIT.laps===1?'ONE LAP':`${CIRCUIT.laps} LAPS`} · FOLLOW THE GREEN GATE`]
    const checkpoint=this.reached%this.gateCount
    const lap='LAP '+Math.min(CIRCUIT.laps,Math.floor(Math.max(0,this.reached-1)/this.gateCount)+1)+'/'+CIRCUIT.laps
    return [this.elapsed<0.9?'GO':raceTime(this.elapsed),
      (CIRCUIT.laps>1?lap+' · ':'')+(checkpoint===0?'FINISH LINE':'CHECKPOINT '+checkpoint+'/'+(this.gateCount-1)),
      this.bestTime===null?'SET YOUR FIRST TIME':'BEST '+raceTime(this.bestTime),'R · LAST CHECKPOINT']
  }
  protected progress():number{return this.reached/(CIRCUIT.laps*this.gateCount+1)}
  get sectorTimes():number[]{return this.splits.slice()}
}
