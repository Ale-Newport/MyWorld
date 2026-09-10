import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { LAKES, LAKE_BODIES, RIVER, BRIDGES, OCEAN_LEVEL, coastInset, inlandWater } from '@/content/world-environment'

/** One ellipse, as a GLSL predicate on the world-space point `p`.
 *  A lake body is a UNION of these — the drawn lakes are blobby and
 *  five overlapping transparent planes at one level is five times the
 *  z-fighting, so each body gets one plane that discards outside all
 *  of its ellipses. */
const ellipseTest = (e: { x: number; z: number; rx: number; rz: number }) =>
  `length((p-vec2(${e.x.toFixed(1)},${e.z.toFixed(1)}))/vec2(${e.rx.toFixed(1)},${e.rz.toFixed(1)}))<1.`

/** WebGL water using world-space waves and terrain depth. The shore-depth and
 * wind ideas come from folio-2025 WaterSurface (MIT); GLSL and geometry are
 * original. No reflection framebuffer or per-frame texture allocation. */
export class Water {
  readonly group = new THREE.Group()
  readonly surfaces: THREE.Mesh[] = []
  private time = { value: 0 }
  private wind = { value: .2 }
  private night = { value: 0 }
  private detail = { value: 1 }
  private rain = { value: 0 }
  private wake = { value: new THREE.Vector4(0, 0, 0, 0) }
  private submerged = 0
  private splashAt = 0

  constructor(private game: Game, bin: Bin) {
    const surface = (geometry: THREE.BufferGeometry, level: number, flow: number, body?:typeof LAKE_BODIES[number]) => {
      const position = geometry.getAttribute('position')
      const depth = new Float32Array(position.count)
      for (let i = 0; i < position.count; i++) depth[i] = Math.max(0, level - game.world.terrain.colliderHeightAt(position.getX(i), position.getZ(i)))
      geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depth, 1))
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: this.time, uWind: this.wind, uNight: this.night, uDetail: this.detail, uRain: this.rain, uWake: this.wake, uFlow: { value: flow } },
        vertexShader: `
          attribute float waterDepth;
          uniform float uTime; uniform float uWind; uniform float uFlow;
          varying vec3 vWorld; varying float vDepth;
          void main() {
            vec3 p=position; vDepth=waterDepth;
            float wave=sin(p.x*.35+uTime*1.2)+sin(p.z*.49-uTime*1.7)+sin((p.x+p.z)*.19+uTime);
            float amplitude=uFlow>.9?.022:(uFlow>.2?.09:.025);
            p.y+=wave*(amplitude+uWind*.035)*smoothstep(0.,2.,waterDepth);
            vWorld=(modelMatrix*vec4(p,1.)).xyz;
            gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
          }`,
        fragmentShader: `
          uniform float uTime; uniform float uWind; uniform float uFlow; uniform float uNight; uniform float uDetail; uniform float uRain; uniform vec4 uWake;
          varying vec3 vWorld; varying float vDepth;
          float noise(vec2 p) { return sin(p.x*1.7+sin(p.y*1.3))*sin(p.y*1.9+sin(p.x*.6)); }
          void main() {
            if(vDepth<.02) discard;
            vec2 p=vWorld.xz;
            ${body ? `if(!(${body.ellipses.map(e=>ellipseTest(e)).join('||')}))discard;` : ''}
            if(uFlow>.9&&(${LAKES.map(ellipseTest).join('||')}))discard;
            float t=uTime;
            float n=uDetail>.5?noise(p*.7+vec2(t*.15,t*uFlow*.6)):sin(p.x+p.y+t*.5)*.3;
            vec3 normal=normalize(vec3(cos(p.x*.35+t*1.2)*.09+n*.06,1.,cos(p.y*.49-t*1.7)*.12));
            vec3 eye=normalize(cameraPosition-vWorld);
            float fresnel=pow(1.-max(dot(eye,normal),0.),3.);
            vec3 col=mix(vec3(.31,.68,.58),vec3(.055,.28,.32),smoothstep(.1,6.,vDepth));
            col=mix(col,vec3(.69,.81,.76),fresnel*.8);
            float glint=uDetail>.5?pow(max(dot(reflect(normalize(vec3(-.4,-.8,-.2)),normal),eye),0.),95.):0.;
            col+=vec3(.95,.88,.6)*glint*(.3+uWind);
            float shore=(1.-smoothstep(.05,1.4,vDepth))*(.48+.52*sin(t*1.7-vDepth*8.+n));
            float ripples=pow(max(0.,sin(length(p-uWake.xy)*5.-(t-uWake.z)*9.)),12.)*exp(-length(p-uWake.xy)*.2)*exp(-max(0.,t-uWake.z)*1.7)*uWake.w;
            float streak=uDetail>.5?pow(max(0.,n),16.)*(.25+uRain*.4):0.;
            col=mix(col,vec3(.88,.96,.82),clamp(shore*.8+ripples+streak,0.,.85));
            col*=1.-uNight*.62;
            gl_FragColor=vec4(col,mix(.5,.95,smoothstep(0.,2.,vDepth)));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
      const mesh = new THREE.Mesh(geometry, material); this.group.add(mesh); this.surfaces.push(mesh)
    }
    const ocean = new THREE.PlaneGeometry(1600, 1600, 128, 128); ocean.rotateX(-Math.PI / 2); ocean.translate(0, OCEAN_LEVEL, 0)
    surface(ocean, OCEAN_LEVEL, .3)
    // Lake grids and river quads share the same terrain depth calculation.
    // One grid per BODY, over the union's bounding box.
    for (const body of LAKE_BODIES) {
      let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity
      for(const e of body.ellipses){x0=Math.min(x0,e.x-e.rx);x1=Math.max(x1,e.x+e.rx);z0=Math.min(z0,e.z-e.rz);z1=Math.max(z1,e.z+e.rz)}
      const pad=2, width=x1-x0+pad*2, depth=z1-z0+pad*2
      const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width/1.6), Math.ceil(depth/1.6))
      geometry.rotateX(-Math.PI / 2); geometry.translate((x0+x1)/2, body.level, (z0+z1)/2)
      surface(geometry, body.level, .1, body)
    }
    const vertices: number[] = []
    // Shared mitered banks avoid transparent overlaps at bends. Sampling across
    // the channel is essential: bank-only depth samples would erase its centre.
    const banks=RIVER.points.map((p,i)=>{
      const a=RIVER.points[Math.max(0,i-1)],b=RIVER.points[Math.min(RIVER.points.length-1,i+1)]
      const before=new THREE.Vector2(-(p[1]-a[1]),p[0]-a[0]).normalize()
      const after=new THREE.Vector2(-(b[1]-p[1]),b[0]-p[0]).normalize()
      if(i===0)before.copy(after);if(i===RIVER.points.length-1)after.copy(before)
      return before.clone().add(after).normalize().multiplyScalar(7/Math.max(.75,before.clone().add(after).normalize().dot(after)))
    })
    for (let i = 1; i < RIVER.points.length; i++) {
      const a = RIVER.points[i-1], b = RIVER.points[i], dx=b[0]-a[0], dz=b[1]-a[1], length=Math.hypot(dx,dz)
      const steps=Math.ceil(length/2)
      const point=(t:number,side:number)=>[a[0]+dx*t+THREE.MathUtils.lerp(banks[i-1].x,banks[i].x,t)*side,RIVER.level,a[1]+dz*t+THREE.MathUtils.lerp(banks[i-1].y,banks[i].y,t)*side]
      for(let s=0;s<steps;s++) {
        const t=s/steps, u=(s+1)/steps
        for(let c=0;c<10;c++) {
          const left=c/5-1,right=(c+1)/5-1,p=point(t,left),q=point(t,right),r=point(u,right),v=point(u,left)
          vertices.push(...p,...q,...r,...p,...r,...v)
        }
      }
    }
    const river = new THREE.BufferGeometry(); river.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); river.computeVertexNormals(); surface(river,RIVER.level,1)
    this.buildBridges()
    game.physics.waterAt = (x,z) => { const w=inlandWater(x,z); return w && w.edge>0 ? w.level : null }
    game.particles.waterLevelAt=(x,z)=>game.physics.waterAt?.(x,z)??OCEAN_LEVEL
    game.renderer.scene.add(this.group); bin.object3D(this.group)
    const tick=()=>this.update(); game.ticker.events.on('tick',tick,12)
    bin.add(()=>{game.ticker.events.off('tick',tick);game.physics.waterAt=null;game.particles.waterLevelAt=null})
  }

  private buildBridges():void {
    /*
      Built along the bridge's own axis and then yawed into place, so a
      crossing on any bearing works. Everything here used to be written
      in world X — deck, railings, planks and colliders — which is why
      BRIDGES had no rotation field: a bridge that was not due east had
      no way to be expressed.
    */
    for(const bridge of BRIDGES) {
      const wood = new THREE.MeshStandardMaterial({color:'#a8895c',roughness:.85})
      const railing = new THREE.MeshStandardMaterial({color:'#6d6250',roughness:.75})
      const beams:THREE.BufferGeometry[]=[]
      const box=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);beams.push(g)}
      const group=new THREE.Group()
      group.position.set(bridge.x,0,bridge.z)
      group.rotation.y=-bridge.rotation
      this.group.add(group)
      const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-bridge.rotation,0))
      /** Deck-local (along, across) to world. */
      const toWorld=(along:number,across:number)=>({
        x:bridge.x+Math.cos(bridge.rotation)*along-Math.sin(bridge.rotation)*across,
        z:bridge.z+Math.sin(bridge.rotation)*along+Math.cos(bridge.rotation)*across,
      })

      const deck=new THREE.Mesh(new THREE.BoxGeometry(bridge.length,.45,bridge.width),wood)
      deck.position.set(0,bridge.level-.225,0);deck.receiveShadow=true;group.add(deck)
      this.game.physics.add({
        type:'fixed',category:'floor',friction:1,
        position:{x:bridge.x,y:bridge.level-.225,z:bridge.z},
        rotation:quaternion,
        colliders:[{shape:'cuboid',parameters:[bridge.length/2,.225,bridge.width/2]}],
      })
      for(const sign of [-1,1]) {
        const across=sign*(bridge.width/2+.1)
        box(bridge.length,.2,.25,0,bridge.level+1.7,across)
        for(let a=-bridge.length/2+1;a<bridge.length/2;a+=3) box(.24,2,.24,a,bridge.level+.7,across)
        const at=toWorld(0,across)
        this.game.physics.add({
          type:'fixed',category:'object',
          position:{x:at.x,y:bridge.level+.9,z:at.z},
          rotation:quaternion,
          colliders:[{shape:'cuboid',parameters:[bridge.length/2,1,.15]}],
        })
      }
      if(bridge.kind==='wood') for(let a=-bridge.length/2;a<bridge.length/2;a+=.8)box(.055,.012,bridge.width,a,bridge.level+.207,0)
      // Piers, so a forty-metre deck is not floating over open water.
      if(bridge.length>26) for(const a of [-bridge.length*.28,bridge.length*.28]) {
        box(1.4,bridge.level+7,1.4,a,(bridge.level-7)/2,0)
      }
      const mesh=new THREE.Mesh(mergeGeometries(beams),railing);beams.forEach(g=>g.dispose());mesh.castShadow=true;group.add(mesh)
    }
  }


  private update():void {
    const game=this.game,p=game.player.position,now=game.ticker.elapsed,dt=Math.min(.05,game.ticker.delta)
    this.time.value=now;this.wind.value=game.weather.windStrength;this.night.value=game.lighting.nightFactor
    this.detail.value=game.quality.level==='low'?0:1;this.rain.value=game.weather.rain
    const water=inlandWater(p.x,p.z),level=water&&water.edge>0?water.level:OCEAN_LEVEL
    const immersed=p.y<level+.45||game.vehicle.wheels.items.some(w=>w.inContact&&w.contactPoint&&w.contactPoint.y<level+.06)
    if(immersed && game.vehicle.xzSpeed>.8 && now>this.splashAt) {
      this.splashAt=now+.13;this.wake.value.set(p.x,p.z,now,1)
      const wetWheels=game.vehicle.wheels.items.filter(w=>w.inContact&&w.contactPoint&&w.contactPoint.y<level+.06)
      for(const wheel of wetWheels)game.particles.burst(new THREE.Vector3(wheel.contactPoint!.x,level+.15,wheel.contactPoint!.z),2,'splash')
      if(!wetWheels.length)game.particles.burst(new THREE.Vector3(p.x,level+.15,p.z),4,'splash')
      game.audio.environment('splash',Math.min(.5,game.vehicle.xzSpeed*.04))
    }
    // SWAMPED, not merely wet. The old threshold was 0.45 m under the
    // surface for 1.2 s, which fired in water the car could plainly
    // drive out of — including everywhere in the river. A metre under
    // for two seconds means the car is actually in trouble, and the
    // shallows are somewhere you can play.
    if(p.y<level-1.1) this.submerged+=dt;else this.submerged=Math.max(0,this.submerged-dt*2)
    if(this.submerged>2) {
      this.submerged=0
      if(game.minigames.current?.id==='circuit')game.minigames.current.recover()
      else {game.player.respawn();game.audio.play('land',.5)}
    }
    if(water)game.audio.environment('water',Math.max(.1,1-Math.abs(water.edge)/12)*.5)
    else if(coastInset(p.x,p.z)<14)game.audio.environment('water',Math.min(.5,(14-coastInset(p.x,p.z))/40))
  }
}
