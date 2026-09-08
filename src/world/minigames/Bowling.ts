import * as THREE from 'three'
import { Minigame } from './Minigame'
import { PLAY_SPOTS } from '@/content/world-environment'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { Actor } from '../world/Playground'

/** Ten actual pins and a physical ball, following the down-vector/settle/reset
 * pattern of folio-2025 BowlingArea (MIT). Original lane, rules and artwork. */
export class Bowling extends Minigame {
  readonly id='bowling' as const
  readonly title='NEWPORT LANES'
  readonly group=new THREE.Group()
  readonly pins:(Actor&{down:boolean})[]=[]
  readonly startPosition=new THREE.Vector3()
  /** The venue's origin. Everything below is an offset from it, so the
   *  lane cannot end up parked on another district's respawn. */
  private readonly at={x:0,z:0}
  ball!:Actor
  throwNumber=1
  down=0
  private rolling=false
  private rollTime=0
  private settled=0
  private awaiting=false
  private canvas!:HTMLCanvasElement
  private texture!:THREE.CanvasTexture
  private screenText=''
  private impactAt=0
  private floorY=0

  constructor(game:Game,bin:Bin){super(game,bin);this.abandonRadius=95}
  build():void {
    const spot=PLAY_SPOTS.find(p=>p.id==='bowling')!
    this.at.x=spot.x;this.at.z=spot.z
    const ox=this.at.x,oz=this.at.z
    this.floorY=this.game.terrain.colliderHeightAt(ox,oz-4)+.06
    this.startPosition.set(ox,this.floorY+1.6,oz+20)
    const wood=new THREE.MeshStandardMaterial({color:'#ccaa74',roughness:.65})
    const lane=new THREE.Mesh(new THREE.BoxGeometry(11,.12,42),wood);lane.position.set(ox,this.floorY,oz-1);lane.receiveShadow=true;this.group.add(lane)
    this.game.physics.add({type:'fixed',category:'floor',position:lane.position,friction:.65,colliders:[{shape:'cuboid',parameters:[5.5,.06,21]}]})
    const edge=new THREE.MeshStandardMaterial({color:'#5b7060',roughness:.85})
    for(const x of [ox-6,ox+6]) {
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.45,.55,38),edge);rail.position.set(x,this.floorY+.3,oz-4);this.group.add(rail)
      this.game.physics.add({type:'fixed',category:'object',position:rail.position,colliders:[{shape:'cuboid',parameters:[.225,.275,19]}]})
    }
    for(let i=0;i<13;i++) {
      const line=new THREE.Mesh(new THREE.BoxGeometry(.025,.01,42),edge);line.position.set(ox-5.2+i*.87,this.floorY+.067,oz-1);this.group.add(line)
    }
    const stripe=new THREE.Mesh(new THREE.BoxGeometry(11,.02,.16),edge);stripe.position.set(ox,this.floorY+.08,oz+10);this.group.add(stripe)
    const white=new THREE.MeshStandardMaterial({color:'#f5eed9',roughness:.48}),red=new THREE.MeshStandardMaterial({color:'#bd654c',roughness:.6})
    const bodyGeometry=new THREE.LatheGeometry([new THREE.Vector2(.32,0),new THREE.Vector2(.49,.3),new THREE.Vector2(.5,.75),new THREE.Vector2(.36,1.1),new THREE.Vector2(.2,1.5),new THREE.Vector2(.24,1.9),new THREE.Vector2(.36,2.1),new THREE.Vector2(.33,2.32),new THREE.Vector2(0,2.45)],12)
    bodyGeometry.translate(0,-1.2,0)
    const stripeGeometry=new THREE.CylinderGeometry(.225,.25,.14,12)
    for(let row=0;row<4;row++)for(let col=0;col<=row;col++) {
      const at=new THREE.Vector3(ox+(col-row/2)*1.28,this.floorY+1.3,oz-12-row*1.24)
      const mesh=new THREE.Group();mesh.add(new THREE.Mesh(bodyGeometry,white));const band=new THREE.Mesh(stripeGeometry,red);band.position.y=.35;mesh.add(band)
      const physical=this.game.physics.add({type:'dynamic',position:at,mass:.19,friction:.5,restitution:.25,linearDamping:.15,angularDamping:.22,colliders:[{shape:'capsule',parameters:[.45,.42],position:{x:0,y:-.32,z:0}},{shape:'ball',parameters:[.32],position:{x:0,y:.9,z:0}}],onCollision:(force)=>{if(force>20&&this.game.ticker.elapsed-this.impactAt>.11&&this.game.player.position.distanceTo(at)<60){this.impactAt=this.game.ticker.elapsed;this.game.audio.impact(Math.min(60,force))}}})
      mesh.position.copy(at);mesh.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true});this.group.add(mesh);this.pins.push({physical,mesh,down:false})
    }
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(1.15,20,14),new THREE.MeshStandardMaterial({color:'#547c68',metalness:.25,roughness:.3}));mesh.position.set(ox,this.floorY+1.3,oz+12);mesh.castShadow=true;this.group.add(mesh)
    const physical=this.game.physics.add({type:'dynamic',position:mesh.position,mass:1.35,friction:.55,restitution:.18,linearDamping:.07,angularDamping:.08,colliders:[{shape:'ball',parameters:[1.15]}]});physical.body.enableCcd(true);this.ball={physical,mesh}
    // Three recessed-looking finger marks distinguish it from an arbitrary sphere.
    const holeGeo=new THREE.SphereGeometry(.12,8,6),holeMat=new THREE.MeshBasicMaterial({color:'#233c30'})
    for(let i=0;i<3;i++){const hole=new THREE.Mesh(holeGeo,holeMat);hole.position.set((i-1)*.3,.95,.55);mesh.add(hole)}
    this.canvas=document.createElement('canvas');this.canvas.width=768;this.canvas.height=256;this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(16,5.33),new THREE.MeshBasicMaterial({map:this.texture,side:THREE.DoubleSide}));screen.position.set(ox,this.floorY+7,oz-20);this.group.add(screen)
    this.game.renderer.scene.add(this.group);this.bin.object3D(this.group)
    this.game.interactions.add({id:'bowling-start',position:this.startPosition.clone(),radius:8,label:'BOWL A FRAME',sublabel:'Push the ball. Ten pins. Two throws.',onInteract:()=>{if(this.awaiting)this.nextThrow();else if(!this.running)this.game.minigames.start(this.id)}})
    const tick=()=>{
      for(const actor of [...this.pins,this.ball])this.game.physics.sample(actor.physical,this.game.ticker.alpha,actor.mesh.position,actor.mesh.quaternion)
      if(!this.running&&this.state!=='finished')this.screen('NEWPORT LANES','PUSH THE BALL • ENTER TO PLAY')
    }
    this.game.ticker.events.on('tick',tick,12);this.bin.add(()=>this.game.ticker.events.off('tick',tick))
    this.screen('NEWPORT LANES','PUSH THE BALL • ENTER TO PLAY')
  }

  start():boolean {
    if(this.running){if(this.awaiting)this.nextThrow();return true}
    super.start();this.origin.copy(this.startPosition)
    this.game.vehicle.moveTo(this.startPosition,Math.PI/2)
    this.screen('FRAME 01','PUSH THE BALL • TWO THROWS');return true
  }
  protected reset():void {
    this.throwNumber=1;this.down=0;this.rolling=false;this.rollTime=0;this.settled=0;this.awaiting=false
    for(const pin of this.pins){pin.down=false;pin.mesh.visible=true;this.game.physics.reset(pin.physical)}
    if(this.ball)this.game.physics.reset(this.ball.physical)
    this.game.interactions.setLabel('bowling-start','BOWL A FRAME','Push the ball. Ten pins. Two throws.')
  }
  nextThrow():void {
    if(!this.awaiting)return
    this.awaiting=false;this.throwNumber=2;this.rolling=false;this.rollTime=0;this.settled=0
    for(const pin of this.pins)if(pin.down){pin.mesh.visible=false;pin.physical.body.setEnabled(false)}
    this.game.physics.reset(this.ball.physical);this.game.vehicle.moveTo(this.startPosition,Math.PI/2);this.game.audio.blip()
    this.game.interactions.setLabel('bowling-start','SECOND THROW','Clear the remaining pins for a spare.')
  }
  protected tick(delta:number):void {
    const p=this.ball.physical.current.position
    if(!this.rolling&&!this.awaiting&&p.distanceTo(new THREE.Vector3(-79,this.floorY+1.3,21))>1.5){this.rolling=true;this.rollTime=0}
    for(const pin of this.pins){const q=pin.physical.current.quaternion;if(1-2*(q.x*q.x+q.z*q.z)<.5||pin.physical.current.position.y<this.floorY-.3)pin.down=true}
    this.down=this.pins.filter(pin=>pin.down).length
    if(this.rolling) {
      this.game.audio.environment('rolling',Math.max(0,1-p.distanceTo(this.game.player.position)/55)*.5)
      const dt=delta/this.game.ticker.defaultScale;this.rollTime+=dt
      const moving=this.pins.some(pin=>{const v=pin.physical.body.linvel(),w=pin.physical.body.angvel();return Math.hypot(v.x,v.y,v.z)> .22||Math.hypot(w.x,w.y,w.z)>.3})
      if(this.rollTime>1.5&&!moving)this.settled+=dt;else this.settled=0
      const v=this.ball.physical.body.linvel(),slow=Math.hypot(v.x,v.y,v.z)<.25
      if((this.settled>1.1&&(p.z<-1||slow))||this.rollTime>10||p.z<-20||Math.abs(p.x+79)>14)this.resolveThrow()
    }
    if(this.running)this.screen(this.awaiting?'ONE MORE THROW':`THROW ${this.throwNumber} / 2`,`${this.down} / 10 PINS${this.rolling?' • ROLLING…':this.awaiting?' • RETURN + ENTER':' • PUSH THE BALL'}`)
  }
  private resolveThrow():void {
    this.rolling=false
    if(this.down===10||this.throwNumber===2) {
      const result=this.down===10?(this.throwNumber===1?'STRIKE!':'SPARE!'):`${this.down} / 10 PINS`
      this.game.achievements.set('bowling',1)
      if(this.down===10){this.game.achievements.set(this.throwNumber===1?'strike':'spare',1);this.game.particles.burst(new THREE.Vector3(-79,this.floorY+4,-3),45,'confetti');this.game.audio.play('achievement')}
      this.finish(this.elapsed/this.game.ticker.defaultScale);this.prepareAttempt()
      this.game.store.getState().setMinigame({id:this.id,title:this.title,lines:[result,'FRAME COMPLETE • PLAY AGAIN'],time:null,best:this.bestTime,progress:1})
      this.screen(result,'FRAME COMPLETE • ENTER TO RESTART')
    } else {
      this.awaiting=true;this.game.audio.blip(.8)
      this.game.interactions.setLabel('bowling-start','SECOND THROW','Press Enter here to return the ball.')
    }
  }
  protected lines():string[]{return [this.awaiting?'SECOND THROW READY':`THROW ${this.throwNumber} / 2`,`${this.down} / 10 PINS`,this.awaiting?'Return to the start and press Enter.':'Push the ball down the lane.']}
  protected progress():number{return this.down/10}
  private screen(title:string,subtitle:string):void {
    const key=title+subtitle+this.down;if(key===this.screenText)return;this.screenText=key
    const c=this.canvas.getContext('2d')!;c.fillStyle='#243d32';c.fillRect(0,0,768,256);c.textAlign='center';c.fillStyle='#eae4c6';c.font='bold 48px monospace';c.fillText(title,384,66);c.font='20px monospace';c.fillText(subtitle,384,110)
    for(let i=0;i<10;i++){c.beginPath();c.arc(96+i*64,177,17,0,Math.PI*2);c.fillStyle=this.pins[i]?.down?'#d18f54':'#8ea78d';c.fill();if(this.pins[i]?.down){c.strokeStyle='#f7edcc';c.lineWidth=3;c.beginPath();c.moveTo(86+i*64,167);c.lineTo(106+i*64,187);c.moveTo(106+i*64,167);c.lineTo(86+i*64,187);c.stroke()}}
    this.texture.needsUpdate=true
  }
}
