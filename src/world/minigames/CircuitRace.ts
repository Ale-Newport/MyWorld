import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Minigame } from './Minigame'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { textTexture } from '../world/materials'
import { CIRCUIT } from '@/content/world-environment'

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
export class CircuitRace extends Minigame {
  readonly id='circuit' as const
  readonly title='NEWPORT CIRCUIT'
  readonly gates:RaceGate[]=[]
  readonly group=new THREE.Group()
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
  readonly curve=new THREE.CatmullRomCurve3(CIRCUIT.points.map(([x,z])=>new THREE.Vector3(x+CIRCUIT.x,0,z+CIRCUIT.z)),true,'centripetal')

  constructor(game:Game,bin:Bin){super(game,bin);this.abandonRadius=1000}
  build():void {
    this.buildTrack()
    this.buildTrackside()
    for(let i=0;i<12;i++) {
      const c=this.curve.getPointAt(i/12),t=this.curve.getTangentAt(i/12)
      c.y=this.game.terrain.colliderHeightAt(c.x,c.z)+0.07
      const n=new THREE.Vector2(t.x,t.z).normalize(),side=new THREE.Vector2(-n.y,n.x)
      const rotation=Math.atan2(-n.y,n.x),p=c.clone().add(new THREE.Vector3(-n.x*7,1.5,-n.y*7))
      p.y=this.game.terrain.colliderHeightAt(p.x,p.z)+1.6
      this.gates.push({index:i,centre:c,normal:n,rotation,halfWidth:CIRCUIT.width/2,
        a:new THREE.Vector2(c.x,c.z).addScaledVector(side,-CIRCUIT.width/2),b:new THREE.Vector2(c.x,c.z).addScaledVector(side,CIRCUIT.width/2),
        respawn:{position:p,rotation}})
      const material=this.game.materials.own(new THREE.MeshBasicMaterial({color:0x6d8270}))
      this.gateMaterials.push(material)
      for(const s of [-1,1])this.box([0.42,i===0?7:4.8,0.42],[c.x+side.x*7*s,c.y+(i===0?3.5:2.4),c.z+side.y*7*s],material)
      if(i===0) {
        this.startPosition.copy(p);this.startRotation=rotation
        const beam=this.box([0.7,1.6,15],[c.x,c.y+6.6,c.z],this.game.materials.get('ink'))
        beam.rotation.y=rotation
        this.label('NEWPORT CIRCUIT',c.clone().add(new THREE.Vector3(0,7.9,0)),9,rotation+Math.PI/2)
        for(let l=0;l<3;l++) {
          const light=this.box([0.6,0.55,0.65],[c.x+side.x*(l-1)*1.4,c.y+5.5,c.z+side.y*(l-1)*1.4],this.game.materials.own(new THREE.MeshBasicMaterial({color:0x332f2a})))
          this.lights.push(light)
        }
      }else this.label(String(i).padStart(2,'0'),c.clone().add(new THREE.Vector3(side.x*7,4.7,side.y*7)),2,rotation+Math.PI/2)
    }
    const geometry=new THREE.PlaneGeometry(CIRCUIT.width,4.5)
    this.bin.add(()=>geometry.dispose())
    this.targetMaterial=this.game.materials.own(new THREE.MeshBasicMaterial({color:0x7cdcaf,transparent:true,opacity:0.25,side:THREE.DoubleSide,depthWrite:false}))
    this.target=new THREE.Mesh(geometry,this.targetMaterial);this.target.visible=false;this.group.add(this.target)
    this.game.renderer.scene.add(this.group);this.bin.object3D(this.group)
    const fixed=()=>this.fixedStep()
    const idle=()=>{
      if(this.state==='idle'||this.state==='ready')this.state=this.game.player.position.distanceTo(this.startPosition)<18?'ready':'idle'
      if(this.running)this.targetMaterial.opacity=0.21+Math.sin(this.game.ticker.elapsedScaled*3)*0.045
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
    const mesh=new THREE.Mesh(geo,this.game.materials.tinted('#48534e',0.96,0));mesh.receiveShadow=true;this.group.add(mesh);this.bin.add(()=>geo.dispose())
    for(const [i,pieces] of [...curbs,arrows].entries()) {
      const merged=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());if(!merged)continue
      this.bin.add(()=>merged.dispose());this.group.add(new THREE.Mesh(merged,this.game.materials.tinted(i===1?'#e07749':'#f1ead3',0.8,0)))
    }
    const c=this.curve.getPointAt(0),t=this.curve.getTangentAt(0),side=new THREE.Vector3(-t.z,0,t.x)
    for(let row=0;row<2;row++)for(let i=0;i<12;i++) {
      const p=c.clone().addScaledVector(side,i-5.5).addScaledVector(t,row-0.5)
      const tile=this.box([1,0.04,1],[p.x,this.game.terrain.colliderHeightAt(p.x,p.z)+0.08,p.z],this.game.materials.get((row+i)%2?'ink':'chalk'))
      tile.rotation.y=Math.atan2(-t.z,t.x)
    }
  }
  private buildTrackside():void {
    const points=this.curve.getSpacedPoints(360),positions:THREE.Vector3[]=[],angles:number[]=[]
    for(let i=8;i<360;i+=13) {
      const p=points[i],t=this.curve.getTangentAt(i/360),side=new THREE.Vector3(-t.z,0,t.x),at=p.clone().addScaledVector(side,10)
      // Keep the established stunt-ramp run-up open, including its shoulders.
      if(Math.hypot(at.x-238,at.z+196)<36||points.some(q=>q.distanceToSquared(at)<8.5**2))continue
      at.y=this.game.terrain.colliderHeightAt(at.x,at.z)+.4;positions.push(at);angles.push(Math.atan2(-t.z,t.x))
    }
    const geometry=new THREE.BoxGeometry(3.6,.65,.6),material=this.game.materials.tinted('#d8d8c2',.9,0)
    const barriers=new THREE.InstancedMesh(geometry,material,positions.length),dummy=new THREE.Object3D()
    positions.forEach((p,i)=>{
      dummy.position.copy(p);dummy.rotation.set(0,angles[i],0);dummy.updateMatrix();barriers.setMatrixAt(i,dummy.matrix)
      this.game.physics.add({type:'fixed',category:'object',position:p,rotation:dummy.quaternion,colliders:[{shape:'cuboid',parameters:[1.8,.325,.3]}]})
      if(i%4===0) {
        this.box([.15,5,.15],[p.x,p.y+2.1,p.z],this.game.materials.get('metal'))
        const flag=this.box([1.9,1.1,.035],[p.x+1,p.y+4.3,p.z],this.game.materials.tinted(i%8?'#709b70':'#cf8b59',.8,0));flag.rotation.y=angles[i]
      }
    })
    barriers.castShadow=true;this.group.add(barriers);this.bin.add(()=>geometry.dispose())
    const coneGeometry=new THREE.ConeGeometry(.38,1,8),cones=new THREE.InstancedMesh(coneGeometry,this.game.materials.get('accent'),8)
    for(let i=0;i<8;i++){dummy.position.set(CIRCUIT.x-7+i*2.3,this.game.terrain.colliderHeightAt(CIRCUIT.x-7+i*2.3,CIRCUIT.z+34)+.5,CIRCUIT.z+34);dummy.rotation.set(0,0,0);dummy.updateMatrix();cones.setMatrixAt(i,dummy.matrix)}
    this.group.add(cones);this.bin.add(()=>coneGeometry.dispose())
    this.label('PIT / RESET',new THREE.Vector3(CIRCUIT.x,4,CIRCUIT.z+32),9,0)
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
    if(Math.hypot(p.x-CIRCUIT.x,p.z-CIRCUIT.z)>200){this.cancel('strayed');return}
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
      const gate=this.gates[this.reached%12],fraction=crossGate(this.previous,p,gate)
      if(fraction!==null) {
        this.reached++;this.splits.push(before+fraction*delta)
        this.gateMaterials[gate.index].color.set('#c7d1bd');this.game.audio.blip(1+(this.reached%12)*0.04)
        // The first crossing launches lap 1; the final crossing ends lap 3.
        if(this.reached===CIRCUIT.laps*12+1){this.elapsed=before+fraction*delta;this.completeRace()}
        else this.setTarget(this.reached%12)
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
    const index=this.reached===0?0:(this.reached-1)%12,gate=this.gates[index]
    const p=gate.centre.clone().add(new THREE.Vector3(gate.normal.x*(this.reached?3:-7),0,gate.normal.y*(this.reached?3:-7)))
    p.y=this.game.terrain.colliderHeightAt(p.x,p.z)+1.6
    this.game.vehicle.moveTo(p,gate.rotation);this.game.player.position.copy(p)
    this.previous.copy(p);this.hasPrevious=false;this.recoveries++;this.game.tracks.reset();return true
  }
  private completeRace():void {
    this.target.visible=false
    const newBest=this.bestTime===null||this.elapsed<this.bestTime
    this.game.achievements.set('circuit',1)
    if(this.elapsed<60)this.game.achievements.set('speedDemon',1)
    if(this.recoveries===0)this.game.achievements.set('perfectRun',1)
    const progress=this.game.save.data.progress
    progress.raceHistory=[...progress.raceHistory,this.elapsed].sort((a,b)=>a-b).slice(0,5)
    this.game.audio.play('achievement');this.finish(this.elapsed);this.prepareAttempt()
    this.game.store.getState().setMinigame({id:this.id,title:this.title,lines:['FINISH',raceTime(this.elapsed),newBest?'NEW PERSONAL BEST':'BEST '+raceTime(this.bestTime??this.elapsed)],time:null,best:this.bestTime,progress:1})
  }
  protected publish():void {
    if(!this.running)return
    const step=Math.floor(this.elapsed*20)+Math.ceil(this.countdown)*100000
    if(step===this.lastHud)return
    this.lastHud=step;super.publish()
  }
  protected lines():string[] {
    if(this.state===RaceState.COUNTDOWN)return [String(Math.ceil(this.countdown)),'3 LAPS · FOLLOW THE GREEN GATE']
    return [this.elapsed<0.9?'GO':raceTime(this.elapsed),
      'LAP '+Math.min(3,Math.floor(Math.max(0,this.reached-1)/12)+1)+'/3 · '+(this.reached%12===0?'FINISH LINE':'CHECKPOINT '+this.reached%12+'/11'),
      this.bestTime===null?'SET YOUR FIRST TIME':'BEST '+raceTime(this.bestTime),'R · LAST CHECKPOINT']
  }
  protected progress():number{return this.reached/(CIRCUIT.laps*12+1)}
  get sectorTimes():number[]{return this.splits.slice()}
}
