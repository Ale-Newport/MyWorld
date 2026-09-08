import * as THREE from 'three'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { Physical, ColliderDescription } from '../physics/Physics'
import { textGeometry } from './Type3D'
import { ALPHABET, GLYPH_WIDTH } from './alphabet'
import { textTexture } from './materials'
import { PLAY_SPOTS } from '@/content/world-environment'

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
  readonly chips: Actor[] = []
  readonly cargo: Actor
  readonly altar = new THREE.Vector3()

  /** Where a set piece stands. The geography owns the position; this
   *  file owns what is built on it. Hard-coding a coordinate here is
   *  how the altar, the quarry and the chip shop ended up scattered
   *  across a map that had moved out from under them. */
  private static spot(id: (typeof PLAY_SPOTS)[number]['id']): { x: number; z: number; radius: number } {
    const found = PLAY_SPOTS.find((s) => s.id === id)
    if (!found) throw new Error(`[world] no play spot '${id}'`)
    return found
  }
  private cabin!: Actor
  private chipCursor = 0
  private chipActive = new Set<number>()
  private chipCooldown = 0
  private lastImpact = 0
  private exploded = 0
  private flash: THREE.Mesh
  private beam: THREE.Mesh
  private machine: THREE.Group
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
    const altarSpot=Playground.spot('deployment')
    this.altar.set(altarSpot.x,0,altarSpot.z)
    const y=game.world.terrain.colliderHeightAt(this.altar.x,this.altar.z)
    this.altar.y=y
    const platform=new THREE.Mesh(new THREE.CylinderGeometry(5,6,.35,8),new THREE.MeshStandardMaterial({color:'#8aa897',metalness:.25,roughness:.65}))
    platform.position.copy(this.altar).add(new THREE.Vector3(0,.12,0));this.group.add(platform)
    // A nearly flush altar pad has no step to beach a delivery package.
    this.cargo=this.box(new THREE.Vector3(this.altar.x+13,y+1.1,this.altar.z+5),new THREE.Vector3(2,2,2),'#cab57f',1.1)
    this.label('RELEASE',this.cargo.mesh,new THREE.Vector3(0,.1,1.01),1.9,.6)
    this.beam=new THREE.Mesh(new THREE.CylinderGeometry(3,4,32,24,1,true),new THREE.MeshBasicMaterial({color:'#b8eac5',transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}))
    this.beam.position.copy(this.altar).add(new THREE.Vector3(0,16,0));this.group.add(this.beam)
    this.label('DEPLOYMENT ALTAR',this.group,new THREE.Vector3(this.altar.x,y+6,this.altar.z-5),14,2)
    this.buildDispenser()
    this.buildCabin()
    this.machine=this.buildTimeMachine()
    game.renderer.scene.add(this.group);bin.object3D(this.group)
    const tick=()=>this.update();game.ticker.events.on('tick',tick,12);bin.add(()=>game.ticker.events.off('tick',tick))
  }

  label(text:string,parent:THREE.Object3D,at:THREE.Vector3,width:number,height:number):THREE.Mesh {
    const [first,...sublines]=text.split('\n')
    const {texture:map}=textTexture({text:first,sublines,size:256,color:'#eee9d7',background:'#2e423b'})
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}))
    mesh.position.copy(at);parent.add(mesh);return mesh
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
    const handle=this.game.world.landmarks.get('hub-name');if(!handle)return
    const origin=handle.group.position,rotation=handle.group.quaternion
    for(const [row,line] of ['ALEJANDRO','NEWPORT'].entries()) {
      const layout=textGeometry(line,{size:5.2,weight:.16,depth:1.5});layout.geometry.dispose()
      for(const letter of layout.letters) {
        const geometry=textGeometry(letter.char,{size:5.2,weight:.16,depth:1.5}).geometry
        geometry.translate(0,-2.6,-.75)
        geometry.computeBoundingBox()
        let bottom=geometry.boundingBox!.min.y
        const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:row===0?'#33473d':'#657c5b',roughness:.65,metalness:.12}))
        const colliders:ColliderDescription[]=[]
        // Stroke colliders preserve open counters in A/D/O/P/R.
        for(const stroke of ALPHABET[letter.char])for(let i=1;i<stroke.length;i++) {
          const a=stroke[i-1],b=stroke[i],dx=(b[0]-a[0])*5.2,dy=(b[1]-a[1])*5.2
          const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.atan2(dy,dx))
          const length=Math.hypot(dx,dy)
          bottom=Math.min(bottom,(a[1]+b[1])*2.6-2.6-Math.abs(dy/length)*(length/2+.05)-Math.abs(dx/length)*.416)
          colliders.push({shape:'cuboid',parameters:[Math.hypot(dx,dy)/2+.05,.416,.75],position:{x:((a[0]+b[0])/2-GLYPH_WIDTH/2)*5.2,y:(a[1]+b[1])*2.6-2.6,z:0},quaternion:q})
        }
        const at=new THREE.Vector3(letter.x+letter.width/2,-bottom+.025,row*-7.5+.75).applyQuaternion(rotation).add(origin)
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
      const x=quarry.x-15.2+(i%9)*3.8,z=quarry.z-2.6+Math.floor(i/9)*5.3,y=this.game.world.terrain.colliderHeightAt(x,z)+1.06
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

  private buildDispenser():void {
    const shop=Playground.spot('chipRelay')
    const sx=shop.x,sz=shop.z
    const y=this.game.world.terrain.colliderHeightAt(sx,sz)
    const oven=new THREE.Mesh(new THREE.BoxGeometry(6,5,4),new THREE.MeshStandardMaterial({color:'#627f69',roughness:.7}));oven.position.set(sx-9,y+2.5,sz);this.group.add(oven)
    this.game.physics.add({type:'fixed',category:'object',position:oven.position,colliders:[{shape:'cuboid',parameters:[3,2.5,2]}]})
    this.label('CHIP SHOP',oven,new THREE.Vector3(0,1,2.02),5,1.1)
    this.label('[ DISPENSE ]',oven,new THREE.Vector3(0,-.7,2.03),3.8,1)
    for(let i=0;i<12;i++) {
      const chip=this.box(new THREE.Vector3(sx-9,y+1,sz+4),new THREE.Vector3(.7,.2,.9),'#d5b465',.08)
      chip.physical.body.setEnabled(false);chip.mesh.visible=false;this.chips.push(chip)
    }
    this.game.interactions.add({id:'chip-shop',position:new THREE.Vector3(sx-9,y,sz+3.5),radius:6,label:'DISPENSE A CHIP',sublabel:'Collect the falling silicon snacks.',onInteract:()=>this.dispense()})
  }

  dispense():void {
    if(this.game.ticker.elapsed<this.chipCooldown)return
    this.chipCooldown=this.game.ticker.elapsed+.5
    const index=this.chipCursor++%this.chips.length,chip=this.chips[index]
    this.game.physics.reset(chip.physical);chip.physical.body.applyImpulse({x:(Math.random()-.5)*.1,y:.2,z:.18},true);chip.mesh.visible=true;this.chipActive.add(index);this.game.audio.blip(.9)
  }

  private buildCabin():void {
    const hut=Playground.spot('cabin'),x=hut.x,z=hut.z,y=this.game.world.terrain.colliderHeightAt(x,z)
    this.cabin=this.box(new THREE.Vector3(x,y+2,z),new THREE.Vector3(3.2,4,3.2),'#668d80',1.5)
    this.label('OUT OF\nOFFICE',this.cabin.mesh,new THREE.Vector3(0,.3,1.61),2.6,2)
    const roof=new THREE.Mesh(new THREE.ConeGeometry(2.8,1.2,4),new THREE.MeshStandardMaterial({color:'#c7bf9e'}));roof.position.y=2.5;roof.rotation.y=Math.PI/4;this.cabin.mesh.add(roof)
    this.game.interactions.add({id:'reset-cabin',position:new THREE.Vector3(x+6,y,z+3),radius:5,label:'UPRIGHT THE CABIN',onInteract:()=>this.game.physics.reset(this.cabin.physical)})
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
      this.machineUntil=this.game.ticker.elapsed+5;this.machinePhase=this.game.lighting.phase;this.machineDuration=this.game.lighting.duration;this.machineTarget=(this.machinePhase+.35)%1;this.timeActive=true;this.game.lighting.duration=0;this.game.audio.play('interact')
      this.game.achievements.set('timeMachine',1)
      this.game.recordSecret('timeMachine')
    }})
    return group
  }

  deploymentPulse():void { (this.beam.material as THREE.MeshBasicMaterial).opacity=.3;this.game.particles.burst(this.altar.clone().add(new THREE.Vector3(0,2,0)),35,'confetti');this.game.audio.play('achievement') }

  reset():void {
    for(const actor of this.actors)this.game.physics.reset(actor.physical)
    this.resetName();this.resetTnt();this.chipActive.clear()
    for(const chip of this.chips){chip.physical.body.setEnabled(false);chip.mesh.visible=false}
    this.timeActive=false;this.machineUntil=0
    if(this.machineDuration)this.game.lighting.duration=this.machineDuration
    ;(this.beam.material as THREE.MeshBasicMaterial).opacity=0
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
    const beam=this.beam.material as THREE.MeshBasicMaterial;beam.opacity=Math.max(0,beam.opacity-dt*.035)
    for(const index of this.chipActive) {
      const chip=this.chips[index]
      if(chip.physical.current.position.distanceTo(p)<2.8){this.chipActive.delete(index);chip.mesh.visible=false;chip.physical.body.setEnabled(false);this.stats.collected++;this.game.achievements.add('chips',1);this.game.audio.blip(1.8)}
    }
    const q=this.cabin.physical.current.quaternion
    if(1-2*(q.x*q.x+q.z*q.z)<.4){this.game.achievements.set('cabin',1);this.game.recordSecret('cabin')}
    if(this.timeActive) {
      const t=Math.max(0,Math.min(1,1-(this.machineUntil-now)/5)),ease=t*t*(3-2*t)
      this.game.lighting.phase=(this.machinePhase+ease*.35)%1
      this.machine.children.slice(1,4).forEach((ring,i)=>{ring.rotation.x=now*(i+1);ring.rotation.y=now*.7+i})
      if(t>=1){this.timeActive=false;this.game.lighting.phase=this.machineTarget;this.game.lighting.duration=this.machineDuration;this.game.particles.burst(this.machine.position.clone().add(new THREE.Vector3(0,4,0)),30,'confetti')}
    }
  }
}
