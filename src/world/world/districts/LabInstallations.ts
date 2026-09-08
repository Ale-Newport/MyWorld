import * as THREE from 'three'
import type { Game } from '../../Game'
import type { Bin } from '../../core/Disposal'
import { seeded } from '../../core/maths'

/** Original, live laboratory extensions: a reversible gravity well, a
 * vehicle-reactive particle instrument and a regenerating voxel hologram.
 * They supplement the existing retrieval, three-body and keyframe systems. */
export class LabInstallations {
  readonly group=new THREE.Group()
  readonly centres=[new THREE.Vector3(-78,0,-229),new THREE.Vector3(-75,0,-169),new THREE.Vector3(67,0,-197)]
  private fields:THREE.InstancedMesh[]=[]
  private clouds:{angle:number;radius:number;height:number;speed:number}[][]=[]
  private polar=1
  private tempo=1
  private seed=1
  private generated:number[]=[]
  private heights:number[]=[]
  private scratch=new THREE.Object3D()
  private nextUpdate=0

  constructor(private game:Game,bin:Bin) {
    const random=seeded(44722),count=game.quality.count(700,180)
    this.centres.forEach(c=>c.y=game.terrain.colliderHeightAt(c.x,c.z))
    const point=new THREE.IcosahedronGeometry(.13,0)
    for(let field=0;field<2;field++) {
      const mesh=new THREE.InstancedMesh(point,new THREE.MeshBasicMaterial({color:field===0?'#acd69d':'#e0b477'}),count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false
      this.fields.push(mesh);this.group.add(mesh)
      this.clouds.push(Array.from({length:count},()=>({angle:random()*Math.PI*2,radius:2+random()*9,height:random()*7,speed:.2+random()*.6})))
    }
    const cube=new THREE.BoxGeometry(.75,1,.75)
    const terrain=new THREE.InstancedMesh(cube,new THREE.MeshStandardMaterial({color:'#8bb8a0',emissive:'#3b6c56',emissiveIntensity:.3,transparent:true,opacity:.75,roughness:.8}),144)
    terrain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);terrain.frustumCulled=false;this.fields.push(terrain);this.group.add(terrain)
    this.heights=Array(144).fill(.2);this.regenerate()
    const titles=['GRAVITY WELL','PARTICLE INSTRUMENT','PROCEDURAL TERRAIN']
    this.centres.forEach((centre,index)=>{
      const ring=new THREE.Mesh(new THREE.RingGeometry(11.6,12,64),new THREE.MeshBasicMaterial({color:'#75987b',side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(centre).y+=.08;this.group.add(ring)
      game.playground.label(titles[index],this.group,centre.clone().add(new THREE.Vector3(0,9,0)),13,1.6)
      game.interactions.add({id:`lab-live-${index}`,position:centre.clone(),radius:13,label:index===0?'REVERSE GRAVITY':index===1?'CHANGE THE FREQUENCY':'REGENERATE THE TERRAIN',sublabel:index===0?'Attraction becomes repulsion.':index===1?'Drive through the field to scatter it.':'A new seed, the same rules.',onInteract:()=>{
        if(index===0)this.polar*=-1
        else if(index===1)this.tempo=this.tempo===1?2.5:this.tempo===2.5?.45:1
        else {this.seed++;this.regenerate()}
        game.achievements.set('labPlay',String(index));game.audio.blip(.6+index*.4)
      }})
    })
    const core=new THREE.Mesh(new THREE.SphereGeometry(1.3,20,16),new THREE.MeshStandardMaterial({color:'#233c32',metalness:.6,roughness:.2}));core.position.copy(this.centres[0]).y+=4;this.group.add(core)
    const horizon=new THREE.Mesh(new THREE.TorusGeometry(2,.09,8,64),new THREE.MeshBasicMaterial({color:'#d1b36c'}));horizon.rotation.x=1.2;core.add(horizon)
    game.renderer.scene.add(this.group);bin.object3D(this.group)
    const tick=()=>this.update();game.ticker.events.on('tick',tick,12);bin.add(()=>game.ticker.events.off('tick',tick))
  }
  regenerate():void {
    const r=seeded(this.seed*377)
    const phase=r()*9
    this.generated=Array.from({length:144},(_,i)=>.35+Math.max(0,Math.sin((i%12)*.6+phase)+Math.cos(Math.floor(i/12)*.51+phase*.7))*2.1)
  }
  private update():void {
    const now=this.game.ticker.elapsed,dt=this.game.ticker.delta,p=this.game.player.position
    if(now<this.nextUpdate)return
    this.nextUpdate=now+(this.game.quality.level==='low'?1/24:1/45)
    this.fields.forEach((mesh,index)=>{
      const centre=this.centres[index],distance=centre.distanceTo(p)
      mesh.visible=distance<130;if(!mesh.visible)return
      if(index<2) {
        this.clouds[index].forEach((particle,i)=>{
          const a=particle.angle+now*particle.speed*(index===0?this.polar:this.tempo)
          const radius=index===0?particle.radius*(this.polar===1?1:.75+Math.sin(now*.5+particle.radius)*.45):particle.radius
          this.scratch.position.set(centre.x+Math.cos(a)*radius,centre.y+(index===0?4+Math.sin(a*2)*.3:1+particle.height+Math.sin(a*3)*.5),centre.z+Math.sin(a)*radius)
          const dx=this.scratch.position.x-p.x,dz=this.scratch.position.z-p.z,near=Math.max(0,1-Math.hypot(dx,dz)/5)
          this.scratch.position.x+=dx*near;this.scratch.position.z+=dz*near;this.scratch.position.y+=near*2
          this.scratch.rotation.set(a,a*.5,0);this.scratch.scale.setScalar(index===0?.65+particle.radius*.06:1)
          this.scratch.updateMatrix();mesh.setMatrixAt(i,this.scratch.matrix)
        })
      } else for(let i=0;i<144;i++) {
        this.heights[i]+=(this.generated[i]-this.heights[i])*Math.min(1,dt*7)
        const height=this.heights[i];this.scratch.position.set(centre.x+(i%12-5.5)*.95,centre.y+1+height/2,centre.z+(Math.floor(i/12)-5.5)*.95);this.scratch.rotation.set(0,0,0);this.scratch.scale.set(1,height,1);this.scratch.updateMatrix();mesh.setMatrixAt(i,this.scratch.matrix)
      }
      mesh.instanceMatrix.needsUpdate=true
    })
  }
}
