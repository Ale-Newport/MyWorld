import * as THREE from 'three'
import { Minigame } from './Minigame'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { Actor } from '../world/Playground'
import type { MinigameId } from '@/content/world'
import { PLAY_SPOTS, RELAY_POINTS, RIVER } from '@/content/world-environment'
import { pushClear } from '@/content/world-layout'
import { textTexture } from '../world/materials'

type ChallengeId='debugDash'|'riverRun'|'chipRelay'|'domino'|'deployment'
const TITLES:Record<ChallengeId,string>={debugDash:'DEBUG DASH',riverRun:'RIVER RUN',chipRelay:'CHIP RELAY',domino:'TNT DOMINO',deployment:'DEPLOYMENT ALTAR'}
const RULES:Record<ChallengeId,string>={debugDash:'Topple eight red failures. Keep the green builds upright.',riverRun:'Follow six beacons up the gorge to the waterfall.',chipRelay:'Collect a chip. Return it to the cache. Repeat three times.',domino:'Hit a TNT crate hard enough to take most of the field with it.',deployment:'Push the release package into the altar and let it settle.'}
/** How many of the eighteen crates a winning chain has to reach. A
 *  chain that has to take ALL of them cannot survive one crate being
 *  blown out of formation before its neighbour's fuse lights, and the
 *  only way that run can end is a thirty-second timeout. */
const DOMINO_SHARE=0.8
/** Seconds of 3-2-1 before each challenge's clock starts. */
const LEAD_IN=3

/** Original challenges share lifecycle and signage. Each scores its own
 * physical event: tilt, crossings, a collection relay, explosions or delivery. */
export class IslandChallenge extends Minigame {
  readonly id:MinigameId
  readonly title:string
  readonly group=new THREE.Group()
  readonly startPosition=new THREE.Vector3()
  readonly targets:THREE.Vector3[]=[]
  readonly blocks:(Actor&{safe:boolean;down:boolean})[]=[]
  reached=0
  carrying=false
  private targetMeshes:THREE.Mesh[]=[]
  private settled=0
  private previous=new THREE.Vector3()
  private activeTarget=new THREE.MeshBasicMaterial({color:'#b7da8d',transparent:true,opacity:.75,side:THREE.DoubleSide})
  private idleTarget=new THREE.MeshBasicMaterial({color:'#94a78b',transparent:true,opacity:.25,side:THREE.DoubleSide})
  private limit=0
  private faces:{mesh:THREE.Mesh;fail:THREE.Texture}[]=[]
  private passTexture:THREE.Texture|null=null

  constructor(game:Game,bin:Bin,private kind:ChallengeId){super(game,bin);this.id=kind;this.title=TITLES[kind];this.abandonRadius=kind==='riverRun'?190:90;this.leadIn=LEAD_IN}
  /** Crates, beacons, chips or blocks needed to win. */
  private get goal():number {return this.kind==='debugDash'?8:this.kind==='riverRun'?6:this.kind==='chipRelay'?3:this.kind==='domino'?Math.ceil(this.game.playground.crates.length*DOMINO_SHARE):1}
  build():void {
    // TNT DOMINO is played at the TNT QUARRY: the venue and the
    // challenge have different names, and the quarry declares which
    // challenge it hosts rather than being listed twice.
    const spot=PLAY_SPOTS.find(p=>p.id===this.kind||('game' in p&&p.game===this.kind))!
    this.startPosition.set(spot.x,this.game.terrain.colliderHeightAt(spot.x,spot.z)+1.6,spot.z+spot.radius*.65)
    if(this.kind==='debugDash') {
      this.limit=45
      // Beside the yard, not in it. At `spot.z + radius*0.65` the
      // entrance stood 15 cm from the back row of blocks, with a 7 m
      // prompt disc swallowing the whole row and the title sign planted
      // over the top of them.
      this.startPosition.set(spot.x+16,this.game.terrain.colliderHeightAt(spot.x+16,spot.z)+1.6,spot.z)
      this.passTexture=textTexture({text:'PASS',size:256,color:'#eee9d7',background:'#2e423b'}).texture
      this.bin.add(()=>this.passTexture?.dispose())
      for(let i=0;i<12;i++) {
        const safe=i%3===2,x=spot.x+(i%3-1)*9,z=spot.z+Math.floor(i/3)*7-10.5,y=this.game.terrain.colliderHeightAt(x,z)
        const actor=this.game.playground.box(new THREE.Vector3(x,y+1.45,z),new THREE.Vector3(2,2.8,1.2),safe?'#709d73':'#bf664c',.55)
        const face=this.game.playground.label(safe?'PASS':'FAIL',actor.mesh,new THREE.Vector3(0,.1,.61),1.9,.7)
        const fail=(face.material as THREE.MeshBasicMaterial).map!
        this.faces.push({mesh:face,fail});this.bin.add(()=>fail.dispose())
        this.blocks.push({...actor,safe,down:false})
      }
    } else if(this.kind==='riverRun') {
      // Up the gorge from the hub end to the falls. The beacons are
      // DERIVED from the river's own polyline rather than written out
      // beside it — six literals used to sit 9-12 m east of the
      // centreline under a comment claiming they were on it, and two of
      // them were snapped to a hard-coded y = 0.5 that only matched the
      // bridge deck by luck.
      this.limit=95
      const bank=RIVER.points.slice(0,6).map(([x,z])=>{
        // East bank, then pushed further east until the ground is free:
        // the tarn and the plunge pool both reach across the nominal
        // offset, and a beacon in four metres of water is not a gate.
        const away=pushClear(x+RIVER.width*1.4,z,x,z,{clearance:4,allow:['plate','district','road','ramp','forest','play','letters','bridge']},2,24)
        return [away.x,away.z] as const
      })
      // The entrance is the far end of the course, on land: the old one
      // was computed from the waterfall and landed inside COLD TARN.
      const mouth=pushClear(bank[0][0]+8,bank[0][1]+4,RIVER.points[0][0],RIVER.points[0][1],{clearance:6,allow:['plate','district','road','ramp','forest','play','letters','bridge']},2,30)
      this.startPosition.set(mouth.x,this.game.terrain.colliderHeightAt(mouth.x,mouth.z)+2,mouth.z)
      for(const [x,z] of bank)this.addTarget(x,z,5)
      // Driven from the hub end, so the falls are the finish.
      this.targets.reverse();this.targetMeshes.reverse()
    } else if(this.kind==='chipRelay') {
      this.limit=70
      this.startPosition.set(spot.x,this.game.terrain.colliderHeightAt(spot.x,spot.z)+1.6,spot.z)
      for(const [x,z] of RELAY_POINTS)this.addTarget(x,z,3)
      const ring=new THREE.Mesh(new THREE.RingGeometry(4.5,5.4,40),new THREE.MeshBasicMaterial({color:'#d1ad69',side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(spot.x,this.game.terrain.colliderHeightAt(spot.x,spot.z)+.12,spot.z);this.group.add(ring)
      this.game.playground.label('CACHE',this.group,new THREE.Vector3(spot.x,this.game.terrain.colliderHeightAt(spot.x,spot.z)+5,spot.z),6,1.5)
    } else if(this.kind==='domino') {
      // Lined up with the near row, not down the gap between the two.
      // Started in the middle the car threads the quarry at speed and
      // touches nothing, which makes "hit a crate hard enough" a game
      // you cannot win by driving at it.
      this.limit=30
      const lane=spot.z-2.6
      this.startPosition.set(spot.x-20,this.game.terrain.colliderHeightAt(spot.x-20,lane)+1.6,lane)
    }
    else {this.limit=90;this.startPosition.copy(this.game.playground.altar).add(new THREE.Vector3(21,2,7))}
    this.game.playground.label(this.title,this.group,this.startPosition.clone().add(new THREE.Vector3(0,5,0)),this.kind==='deployment'?13:10,1.8)
    this.game.renderer.scene.add(this.group);this.bin.object3D(this.group)
    this.game.interactions.add({id:`challenge-${this.kind}`,position:this.startPosition.clone(),radius:7,label:`PLAY ${this.title}`,sublabel:RULES[this.kind],onInteract:()=>this.game.minigames.start(this.id)})
    const idle=()=>{for(let i=0;i<this.targetMeshes.length;i++){const mesh=this.targetMeshes[i];mesh.rotation.y=this.game.ticker.elapsed*.6;mesh.position.y=this.targets[i].y+2.7+Math.sin(this.game.ticker.elapsed*1.8+i)*.25;mesh.material=this.running&&!this.carrying&&i===this.reached?this.activeTarget:this.idleTarget}}
    this.game.ticker.events.on('tick',idle,12);this.bin.add(()=>{this.game.ticker.events.off('tick',idle);this.activeTarget.dispose();this.idleTarget.dispose()})
  }
  private addTarget(x:number,z:number,radius:number):void {
    const p=new THREE.Vector3(x,this.game.terrain.colliderHeightAt(x,z),z)
    this.targets.push(p)
    const mesh=new THREE.Mesh(this.kind==='chipRelay'?new THREE.OctahedronGeometry(1.3):new THREE.TorusGeometry(radius,.18,6,36),this.idleTarget)
    mesh.position.copy(p).add(new THREE.Vector3(0,2.7,0));this.group.add(mesh);this.targetMeshes.push(mesh)
    this.game.playground.label(String(this.targets.length).padStart(2,'0'),this.group,p.clone().add(new THREE.Vector3(radius+1,4,0)),2,1.4)
  }
  start():boolean {if(this.running)return true;const ok=super.start();this.origin.copy(this.startPosition);this.previous.copy(this.game.player.position);this.game.audio?.blip(.75);return ok}
  protected reset():void {
    this.reached=0;this.carrying=false;this.settled=0
    for(const [i,block] of this.blocks.entries()){this.game.physics.reset(block.physical);block.down=false;(block.mesh as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>).material.color.set(block.safe?'#709d73':'#bf664c');(this.faces[i].mesh.material as THREE.MeshBasicMaterial).map=this.faces[i].fail}
    for(const mesh of this.targetMeshes)mesh.visible=true
    if(this.kind==='domino')this.game.playground.resetTnt()
    if(this.kind==='deployment')this.game.physics.reset(this.game.playground.cargo.physical)
  }
  protected tick(delta:number):void {
    // `elapsed` is real seconds now — the manager used to hand every
    // mini-game the world clock, which runs at 2x, and this file was the
    // only one that divided it back out again.
    const seconds=this.elapsed,p=this.game.player.position
    if(seconds>this.limit){this.game.audio?.play('fail');this.fail('TIME UP • TRY AGAIN');return}
    if(this.kind==='debugDash') {
      for(const [i,block] of this.blocks.entries()) {
        const q=block.physical.current.quaternion
        if(1-2*(q.x*q.x+q.z*q.z)<.6||block.physical.current.position.distanceTo(new THREE.Vector3().copy(block.physical.initialState.position))>1.5)block.down=true
        if(block.safe&&block.down){this.game.audio?.play('fail');this.fail('GREEN BUILD HIT • RETRY');return}
        if(!block.safe&&block.down){this.game.achievements.set('debugger',`yard-${i}`);(block.mesh as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>).material.color.set('#709d73');(this.faces[i].mesh.material as THREE.MeshBasicMaterial).map=this.passTexture}
      }
      this.reached=this.blocks.filter(b=>!b.safe&&b.down).length
      if(this.reached>=this.goal)this.complete(seconds)
    } else if(this.kind==='riverRun') {
      const target=this.targets[this.reached]
      if(target&&this.crossed(target,5.7)){this.reached++;this.game.audio.blip(1+this.reached*.1);if(this.reached>=this.targets.length)this.complete(seconds)}
    } else if(this.kind==='chipRelay') {
      if(!this.carrying&&this.targets[this.reached]&&this.crossed(this.targets[this.reached],3.5)){this.carrying=true;this.targetMeshes[this.reached].visible=false;this.game.audio.blip(1.5)}
      else if(this.carrying&&Math.hypot(p.x-this.startPosition.x,p.z-this.startPosition.z)<5.1&&Math.abs(p.y-this.startPosition.y)<4){this.carrying=false;this.reached++;this.game.audio.blip(1+this.reached*.2);this.game.particles.burst(p,8,'confetti');if(this.reached>=this.goal)this.complete(seconds)}
    } else if(this.kind==='domino') {
      this.reached=this.game.playground.crates.filter(c=>c.exploded).length
      if(this.reached>=this.goal)this.complete(seconds)
    } else {
      const cargo=this.game.playground.cargo.physical,pos=cargo.current.position,altar=this.game.playground.altar,v=cargo.body.linvel()
      if(Math.hypot(pos.x-altar.x,pos.z-altar.z)<4&&Math.abs(pos.y-altar.y)<2&&Math.hypot(v.x,v.y,v.z)<.65)this.settled+=delta;else this.settled=0
      this.reached=this.settled>=1?1:0
      if(this.reached){this.game.playground.deploymentPulse();this.complete(seconds)}
    }
    this.previous.copy(p)
  }
  private crossed(at:THREE.Vector3,radius:number):boolean {
    const p=this.game.player.position,dx=p.x-this.previous.x,dz=p.z-this.previous.z,length=dx*dx+dz*dz
    if(length>400)return false
    const t=length?Math.max(0,Math.min(1,((at.x-this.previous.x)*dx+(at.z-this.previous.z)*dz)/length)):1
    return Math.hypot(this.previous.x+dx*t-at.x,this.previous.z+dz*t-at.z)<radius&&Math.abs(p.y-at.y)<4
  }
  private complete(seconds:number):void {
    // No `prepareAttempt()` here. It used to be called one statement
    // after `finish()`, which killed the timer that returns the game to
    // idle on the very frame it was created — so every win left the
    // card welded to the HUD and the state machine stuck on 'finished'.
    this.game.achievements.set(this.kind,1)
    this.game.audio.play('achievement');this.game.audio.blip(1.9)
    this.game.particles.burst(this.game.player.position,30,'confetti')
    this.game.view.kick(.3)
    this.finish(seconds)
  }
  protected briefing():string {return RULES[this.kind]}
  protected lines():string[] {
    if(this.state==='countdown')return [Math.ceil(this.leadInLeft).toFixed(0),`${this.limit}s ON THE CLOCK`,RULES[this.kind]]
    const left=Math.max(0,this.limit-this.elapsed).toFixed(1)
    return [`${left}s LEFT • ${this.reached} / ${this.goal}`,this.carrying?'CHIP ON BOARD → RETURN TO CACHE':RULES[this.kind],'ESC TO LEAVE']
  }
  protected progress():number {return Math.min(1,this.reached/this.goal)}
}
