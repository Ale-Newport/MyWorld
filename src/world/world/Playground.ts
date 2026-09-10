import * as THREE from 'three'
import type { Game } from '../Game'
import { DAYLIGHT_RANGE } from './Lighting'
import type { Bin } from '../core/Disposal'
import type { Physical, ColliderDescription } from '../physics/Physics'
import { textGeometry } from './Type3D'
import { ALPHABET, GLYPH_WIDTH } from './alphabet'
import { signLabel } from './materials'
import { PLAY_SPOTS } from '@/content/world-environment'
import { LETTERS } from '@/content/world-layout'

export type Actor = { physical: Physical; mesh: THREE.Object3D }
export type Explosive = Actor & { fuse: number; exploded: boolean; armedAt: number }
/** Physical attractions use original models and the same Rapier body factory as
 * existing props. Bounded dispenser, tipping cabin and staggered TNT chains are
 * adaptations of folio-2025 CookieArea, ToiletArea and ExplosiveCrates (MIT). */
export class Playground {
  readonly group = new THREE.Group()
  readonly letters: (Actor & { down: boolean; char: string })[] = []
  readonly crates: Explosive[] = []
  readonly actors: Actor[] = []

  /** Where a set piece stands. The geography owns the position; this
   *  file owns what is built on it. Hard-coding a coordinate here is
   *  how the altar, the quarry and the chip shop ended up scattered
   *  across a map that had moved out from under them. */
  private static spot(id: (typeof PLAY_SPOTS)[number]['id']): { x: number; z: number; radius: number } {
    const found = PLAY_SPOTS.find((s) => s.id === id)
    if (!found) throw new Error(`[world] no play spot '${id}'`)
    return found
  }
  private lastImpact = 0
  private exploded = 0
  private flash: THREE.Mesh
  private machine: THREE.Group
  private blackHole: THREE.Group
  private pullUntil = 0
  private machineUntil = 0
  private machineTarget = .5
  private machinePhase = 0
  private machineDuration = 0
  private timeActive = false
  private lastTntSound = 0
  readonly stats = { exploded: 0, collected: 0 }

  constructor(private game: Game, bin: Bin) {
    this.buildName()
    this.buildTnt()
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffdc8a', transparent: true, opacity: 0, depthWrite: false }))
    this.flash.visible=false;this.group.add(this.flash)
    this.machine=this.buildTimeMachine()
    this.blackHole=this.buildBlackHole()
    game.renderer.scene.add(this.group);bin.object3D(this.group)
    const tick=()=>this.update();game.ticker.events.on('tick',tick,12);bin.add(()=>game.ticker.events.off('tick',tick))
  }

  /** Kept as a method because half the world calls it that way; the
   *  implementation is `signLabel`, which needs no Playground. */
  label(text:string,parent:THREE.Object3D,at:THREE.Vector3,width:number,height:number):THREE.Mesh {
    return signLabel(text,parent,at,width,height)
  }

  box(at:THREE.Vector3,size:THREE.Vector3,colour:string,mass:number,colliders?:ColliderDescription[]):Actor {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z),new THREE.MeshStandardMaterial({color:colour,roughness:.78}))
    const physical=this.game.physics.add({type:'dynamic',position:at,mass,linearDamping:.2,angularDamping:.4,friction:.58,restitution:.12,colliders:colliders??[{shape:'cuboid',parameters:[size.x/2,size.y/2,size.z/2]}],onCollision:(force,p)=>this.impact(force,p)})
    mesh.position.copy(at);mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh)
    const actor={mesh,physical};this.actors.push(actor);return actor
  }

  private impact(force:number,p:{x:number;y:number;z:number}):void {
    const now=this.game.ticker.elapsed
    if(force<28||now-this.lastImpact<.16||this.game.player.position.distanceTo(new THREE.Vector3(p.x,p.y,p.z))>40)return
    this.lastImpact=now;this.game.audio.impact(Math.min(85,force));this.game.particles.burst(new THREE.Vector3(p.x,p.y,p.z),4,'dust')
  }

  private buildName():void {
    /*
      SIZE LIVES IN `world-layout`, not here.

      It used to be the literal 5.2 written twice in this method, with
      a third copy as the 7.5 m row pitch and a fourth baked into the
      collider half-extents — while `hub-name` carried a `scale` field
      that the builder ignored. So the letters could not be resized
      without editing four numbers in lockstep, and nothing else in the
      world (the terrain that flattens under them, the ecology that
      keeps off them, the map that draws them) could know how big they
      were.

      They are now 3.9 m, which is 75% of what they were: still the
      largest thing at the hub and still a playground of sixteen
      movable letters, but no longer filling the frame from every
      approach.
    */
    // `landing-name`, not `hub-name`: the district was renamed with the
    // island and this lookup fails SILENTLY — the whole physical name
    // simply did not build, and nothing said so.
    const handle=this.game.world.landmarks.get('landing-name');if(!handle)return
    const SIZE=LETTERS.size, HALF=SIZE/2, PITCH=LETTERS.rowPitch
    const origin=handle.group.position,rotation=handle.group.quaternion
    for(const [row,line] of ['ALEJANDRO','NEWPORT'].entries()) {
      const layout=textGeometry(line,{size:SIZE,weight:.16,depth:1.5});layout.geometry.dispose()
      for(const letter of layout.letters) {
        const geometry=textGeometry(letter.char,{size:SIZE,weight:.16,depth:1.5}).geometry
        geometry.translate(0,-HALF,-.75)
        geometry.computeBoundingBox()
        let bottom=geometry.boundingBox!.min.y
        const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:row===0?'#33473d':'#657c5b',roughness:.65,metalness:.12}))
        const colliders:ColliderDescription[]=[]
        // Stroke colliders preserve open counters in A/D/O/P/R.
        for(const stroke of ALPHABET[letter.char])for(let i=1;i<stroke.length;i++) {
          const a=stroke[i-1],b=stroke[i],dx=(b[0]-a[0])*SIZE,dy=(b[1]-a[1])*SIZE
          const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.atan2(dy,dx))
          const length=Math.hypot(dx,dy)
          bottom=Math.min(bottom,(a[1]+b[1])*HALF-HALF-Math.abs(dy/length)*(length/2+.05)-Math.abs(dx/length)*.416)
          colliders.push({shape:'cuboid',parameters:[Math.hypot(dx,dy)/2+.05,.416,.75],position:{x:((a[0]+b[0])/2-GLYPH_WIDTH/2)*SIZE,y:(a[1]+b[1])*HALF-HALF,z:0},quaternion:q})
        }
        const at=new THREE.Vector3(letter.x+letter.width/2,-bottom+.025,row*-PITCH+.75).applyQuaternion(rotation).add(origin)
        const physical=this.game.physics.add({type:'dynamic',position:at,rotation,mass:3.5,sleeping:true,friction:.62,restitution:.08,linearDamping:.22,angularDamping:.4,colliders,onCollision:(f,p)=>this.impact(f,p)})
        mesh.position.copy(at);mesh.quaternion.copy(rotation);mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh)
        const actor={mesh,physical,down:false,char:letter.char};this.letters.push(actor);this.actors.push(actor)
      }
    }
    this.game.interactions.add({id:'reset-name',position:new THREE.Vector3(origin.x+26,origin.y,origin.z+5),radius:7,label:'RESTORE THE NAME',sublabel:'Sixteen movable letters. Knock them all over.',onInteract:()=>this.resetName()})
    this.label('NAME DROP / RESET',this.group,new THREE.Vector3(origin.x+26,origin.y+4,origin.z+5),8,1.4)
  }

  resetName():void {for(const letter of this.letters){this.game.physics.reset(letter.physical);letter.down=false}}

  private buildTnt():void {
    const quarry=Playground.spot('tnt')
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#b34535';ctx.fillRect(0,0,128,128)
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){ctx.fillStyle=(x+y)%3===0?'#a33b30':'#c7533f';ctx.fillRect(x*16+2,y*16+2,12,12)}
    ctx.fillStyle='#e5d9b6';ctx.fillRect(0,43,128,43);ctx.fillStyle='#3a3027';ctx.font='bold 32px monospace';ctx.textAlign='center';ctx.fillText('TNT',64,76)
    const map=new THREE.CanvasTexture(canvas);map.magFilter=THREE.NearestFilter;map.minFilter=THREE.NearestFilter;map.colorSpace=THREE.SRGBColorSpace
    const material=new THREE.MeshStandardMaterial({map,roughness:.83})
    for(let i=0;i<18;i++) {
      // THREE ABREAST, SIX DEEP, along the verge. Nine abreast made a
      // thirty-metre row on a twenty-metre strip of land: its west end
      // stood on the racing line and its east end was in the lake.
      const x=quarry.x+(i%3-1)*3.8,z=quarry.z+(Math.floor(i/3)-2.5)*4.2,y=this.game.world.terrain.colliderHeightAt(x,z)+1.06
      const actor=this.box(new THREE.Vector3(x,y,z),new THREE.Vector3(2.1,2.1,2.1),'#bb4d36',.85)
      ;((actor.mesh as THREE.Mesh).material as THREE.Material).dispose();(actor.mesh as THREE.Mesh).material=material
      const crate:Explosive={...actor,fuse:-1,exploded:false,armedAt:2}
      crate.physical.onCollision=(force,p)=>{this.impact(force,p);if(force>42&&this.game.ticker.elapsed>crate.armedAt&&!crate.exploded&&crate.fuse<0)crate.fuse=.5}
      this.crates.push(crate)
    }
    this.label('TNT QUARRY',this.group,new THREE.Vector3(quarry.x,this.game.world.terrain.colliderHeightAt(quarry.x,quarry.z)+7,quarry.z+15),15,2.5)
    this.game.interactions.add({id:'reset-tnt',position:new THREE.Vector3(quarry.x,this.game.world.terrain.colliderHeightAt(quarry.x,quarry.z+21),quarry.z+21),radius:7,label:'RESTOCK TNT',sublabel:'Push to stack. Hit hard to light a fuse.',onInteract:()=>this.resetTnt()})
  }

  resetTnt():void {
    this.exploded=0;this.stats.exploded=0
    for(const crate of this.crates){crate.fuse=-1;crate.exploded=false;crate.armedAt=this.game.ticker.elapsed+2;crate.mesh.visible=true;crate.mesh.scale.setScalar(1);this.game.physics.reset(crate.physical)}
    if(this.flash)this.flash.visible=false
  }

  private explode(crate:Explosive):void {
    if(crate.exploded)return
    crate.exploded=true;crate.fuse=-1;crate.mesh.visible=false;crate.physical.body.setEnabled(false)
    const at=crate.physical.current.position.clone();this.stats.exploded=++this.exploded
    for(const physical of this.game.physics.physicals) {
      if(physical.static||!physical.body.isEnabled()||physical===crate.physical)continue
      const delta=physical.current.position.clone().sub(at),distance=delta.length()
      if(distance>10)continue
      delta.y=Math.max(1.2,delta.y);delta.normalize().multiplyScalar((1-distance/10)*physical.body.mass()*8)
      physical.body.applyImpulse(delta,true)
    }
    for(const other of this.crates)if(!other.exploded&&other.fuse<0&&other.physical.current.position.distanceTo(at)<6.3)other.fuse=.16+other.physical.current.position.distanceTo(at)*.025
    this.game.particles.burst(at,10,'debris');this.game.particles.burst(at,12,'smoke');this.game.particles.burst(at,8,'spark')
    this.game.ecology?.burst(at,2)
    this.flash.position.copy(at);this.flash.scale.setScalar(4);this.flash.visible=true;(this.flash.material as THREE.MeshBasicMaterial).opacity=.7
    const proximity=Math.max(0,1-this.game.player.position.distanceTo(at)/65)
    if(proximity&&this.game.ticker.elapsed-this.lastTntSound>.1){this.lastTntSound=this.game.ticker.elapsed;this.game.audio.environment('explosion',proximity);if(!this.game.reducedMotion)this.game.view.kick(proximity*.3)}
  }

  private buildTimeMachine():THREE.Group {
    const machine=Playground.spot('timeMachine')
    const group=new THREE.Group(),y=this.game.world.terrain.colliderHeightAt(machine.x,machine.z);group.position.set(machine.x,y,machine.z);this.group.add(group)
    const base=new THREE.Mesh(new THREE.CylinderGeometry(4.5,5,.5,12),new THREE.MeshStandardMaterial({color:'#8d8e7b'}));group.add(base)
    const material=new THREE.MeshStandardMaterial({color:'#c2b974',emissive:'#8f7528',emissiveIntensity:.15,metalness:.45,roughness:.4})
    for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(4.5+i*.25,.12,6,48),material);ring.position.y=4.5;ring.rotation.y=i*Math.PI/3;group.add(ring)}
    this.label('TIME MACHINE',group,new THREE.Vector3(0,10,0),12,2)
    this.game.interactions.add({id:'time-machine',position:group.position.clone(),radius:7,label:'JUMP TO THE NEXT COMMIT',sublabel:'Watch the island move through time.',onInteract:()=>{
      if(this.timeActive)return
      this.machineUntil=this.game.ticker.elapsed+5;this.machinePhase=this.game.lighting.phase;this.machineDuration=this.game.lighting.duration
      // Sweeps the sun from one end of the daylight range to the
      // other and back. It used to jump the clock forward through
      // dusk, which was the one thing on the island that could still
      // turn the lights off.
      this.machineTarget=this.machinePhase<=(DAYLIGHT_RANGE.from+DAYLIGHT_RANGE.to)/2?DAYLIGHT_RANGE.to:DAYLIGHT_RANGE.from
      this.timeActive=true;this.game.lighting.duration=0;this.game.audio.play('interact')
      this.game.achievements.set('timeMachine',1)
      this.game.recordSecret('timeMachine')
    }})
    return group
  }

  /* ------------------------------------------------------------
     THE BLACK HOLE

     Inside the circuit's north loop, which is the whole point: you
     go around it every lap and never touch it. The pull is an
     INTERACTION, not a field — a force that reached the racing
     surface would be a physics bug wearing a costume — so it lasts
     four seconds, only from the prompt, and only inside the ring.
     ------------------------------------------------------------ */
  private buildBlackHole():THREE.Group {
    const spot=Playground.spot('blackHole')
    const group=new THREE.Group(),y=this.game.world.terrain.colliderHeightAt(spot.x,spot.z)
    group.position.set(spot.x,y,spot.z);this.group.add(group)
    // The event horizon: a black sphere with no specular at all, so it
    // reads as absence rather than as a dark ball.
    const core=new THREE.Mesh(new THREE.SphereGeometry(3.4,32,24),new THREE.MeshBasicMaterial({color:'#07070a'}))
    core.position.y=5.2;group.add(core)
    // The accretion disc: three flat rings, each turning at its own
    // rate, brighter towards the middle.
    const disc:THREE.Mesh[]=[]
    for(let i=0;i<3;i++) {
      const ring=new THREE.Mesh(
        new THREE.RingGeometry(4.4+i*2.1,6.1+i*2.1,64),
        new THREE.MeshBasicMaterial({color:i===0?'#f0a95c':i===1?'#c96f4a':'#7d5590',transparent:true,opacity:.78-i*.16,side:THREE.DoubleSide}),
      )
      ring.rotation.x=-Math.PI/2+ (i-1)*.09
      ring.position.y=5.2
      group.add(ring);disc.push(ring)
    }
    // The lip of the crater, so the ground says something is here.
    const rim=new THREE.Mesh(new THREE.TorusGeometry(spot.radius-2,.5,6,64),new THREE.MeshStandardMaterial({color:'#3b3b45',roughness:.9}))
    rim.rotation.x=-Math.PI/2;rim.position.y=.35;group.add(rim)
    this.label('BLACK HOLE',group,new THREE.Vector3(0,12,0),13,2)
    group.userData.disc=disc
    this.game.interactions.add({
      id:'black-hole',position:group.position.clone(),radius:spot.radius-1,
      label:'FALL IN',sublabel:'Four seconds of somebody else\'s gravity. The pull stops at the rim.',
      onInteract:()=>{
        this.pullUntil=this.game.ticker.elapsed+4
        this.game.audio.play('interact')
        this.game.achievements.set('blackHole',1)
        this.game.recordSecret('blackHole')
      },
    })
    return group
  }

  reset():void {
    for(const actor of this.actors)this.game.physics.reset(actor.physical)
    this.resetName();this.resetTnt()
    this.timeActive=false;this.machineUntil=0;this.pullUntil=0
    if(this.machineDuration)this.game.lighting.duration=this.machineDuration
  }

  private update():void {
    const dt=Math.min(.05,this.game.ticker.delta),now=this.game.ticker.elapsed,p=this.game.player.position
    for(const spot of PLAY_SPOTS)if(Math.hypot(p.x-spot.x,p.z-spot.z)<spot.radius+10&&!this.game.save.data.progress.landmarks.includes(`play-${spot.id}`)){this.game.save.data.progress.landmarks.push(`play-${spot.id}`);this.game.save.schedule()}
    for(const actor of this.actors)if(actor.mesh.visible)this.game.physics.sample(actor.physical,this.game.ticker.alpha,actor.mesh.position,actor.mesh.quaternion)
    let down=0
    for(const letter of this.letters){const q=letter.physical.current.quaternion;if(1-2*(q.x*q.x+q.z*q.z)<.45)letter.down=true;if(letter.down)down++}
    this.game.achievements.set('nameDrop',down)
    for(const crate of this.crates)if(crate.fuse>=0&&!crate.exploded) {
      crate.fuse-=dt;crate.mesh.scale.setScalar(1+Math.sin(now*40)*.025)
      if(now>(crate.mesh.userData.sparkAt??0)){crate.mesh.userData.sparkAt=now+.13;this.game.particles.burst(crate.physical.current.position.clone().add(new THREE.Vector3(0,1.2,0)),2,'spark')}
      if(crate.fuse<=0)this.explode(crate)
    }
    if(this.flash.visible){const m=this.flash.material as THREE.MeshBasicMaterial;m.opacity=Math.max(0,m.opacity-dt*4);this.flash.scale.multiplyScalar(1+dt*4);if(m.opacity===0)this.flash.visible=false}
    // The accretion disc always turns; the pull only when asked for.
    for(const [i,ring] of (this.blackHole.userData.disc as THREE.Mesh[]).entries())ring.rotation.z=now*(.5+i*.35)*(i%2?-1:1)
    if(now<this.pullUntil) {
      const dx=this.blackHole.position.x-p.x,dz=this.blackHole.position.z-p.z
      const distance=Math.hypot(dx,dz)
      if(distance>1.2&&distance<40) {
        // Falls off with distance, capped, and applied as an impulse on
        // the chassis rather than a teleport — the car keeps its own
        // handling all the way in, which is what makes it fun.
        const chassis=this.game.vehicle.chassis
        const strength=Math.min(1,26/(distance*distance))*22*chassis.mass*dt
        chassis.physical.body.applyImpulse({x:(dx/distance)*strength,y:0,z:(dz/distance)*strength},true)
        if(now>(this.blackHole.userData.sparkAt??0)){this.blackHole.userData.sparkAt=now+.1;this.game.particles.burst(p.clone(),2,'spark')}
      }
    }
    if(this.timeActive) {
      /*
        `setPhase`, not `phase =`.

        Assigning the field moved the sun for exactly as long as the
        sweep held `duration` at zero: `Lighting.update` recomputes
        `phase` from its `daylight` accumulator, and `daylight` never
        moved — so the moment the sweep ended and the duration came
        back, the sun snapped to where it had started and the whole
        journey through time undid itself in one frame. `setPhase`
        exists for this and says so: it moves the accumulator too.
      */
      const t=Math.max(0,Math.min(1,1-(this.machineUntil-now)/5)),ease=t*t*(3-2*t)
      this.game.lighting.setPhase(this.machinePhase+(this.machineTarget-this.machinePhase)*ease)
      this.machine.children.slice(1,4).forEach((ring,i)=>{ring.rotation.x=now*(i+1);ring.rotation.y=now*.7+i})
      if(t>=1){this.timeActive=false;this.game.lighting.setPhase(this.machineTarget);this.game.lighting.duration=this.machineDuration;this.game.particles.burst(this.machine.position.clone().add(new THREE.Vector3(0,4,0)),30,'confetti')}
    }
  }
}
