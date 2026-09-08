import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { LAKES, RIVER, WATERFALL, BRIDGES, OCEAN_LEVEL, inlandWater } from '@/content/world-environment'

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
  private fallAt = 0

  constructor(private game: Game, bin: Bin) {
    const surface = (geometry: THREE.BufferGeometry, level: number, flow: number, lake?:typeof LAKES[number]) => {
      const position = geometry.getAttribute('position')
      const depth = new Float32Array(position.count)
      for (let i = 0; i < position.count; i++) depth[i] = Math.max(0, level - game.world.terrain.colliderHeightAt(position.getX(i), position.getZ(i)))
      geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depth, 1))
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: this.time, uWind: this.wind, uNight: this.night, uDetail: this.detail, uRain: this.rain, uWake: this.wake, uFlow: { value: flow }, uLake:{value:lake?new THREE.Vector4(lake.x,lake.z,lake.rx,lake.rz):new THREE.Vector4()} },
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
          uniform float uTime; uniform float uWind; uniform float uFlow; uniform float uNight; uniform float uDetail; uniform float uRain; uniform vec4 uWake; uniform vec4 uLake;
          varying vec3 vWorld; varying float vDepth;
          float noise(vec2 p) { return sin(p.x*1.7+sin(p.y*1.3))*sin(p.y*1.9+sin(p.x*.6)); }
          void main() {
            if(vDepth<.02) discard;
            vec2 p=vWorld.xz;
            if(uLake.z>0.&&length((p-uLake.xy)/uLake.zw)>1.)discard;
            if(uFlow>.9&&(${LAKES.map(lake=>`length((p-vec2(${lake.x.toFixed(1)},${lake.z.toFixed(1)}))/vec2(${lake.rx.toFixed(1)},${lake.rz.toFixed(1)}))<1.`).join('||')}))discard;
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
    for (const lake of LAKES) {
      const geometry = new THREE.PlaneGeometry(lake.rx * 2.3, lake.rz * 2.3, 48, 40)
      geometry.rotateX(-Math.PI / 2); geometry.translate(lake.x, lake.level, lake.z)
      surface(geometry, lake.level, .1,lake)
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
    this.buildWaterfall()
    game.physics.waterAt = (x,z) => { const w=inlandWater(x,z); return w && w.edge>0 ? w.level : null }
    game.particles.waterLevelAt=(x,z)=>game.physics.waterAt?.(x,z)??OCEAN_LEVEL
    game.renderer.scene.add(this.group); bin.object3D(this.group)
    const tick=()=>this.update(); game.ticker.events.on('tick',tick,12)
    bin.add(()=>{game.ticker.events.off('tick',tick);game.physics.waterAt=null;game.particles.waterLevelAt=null})
  }

  private buildBridges():void {
    for(const bridge of BRIDGES) {
      const wood = new THREE.MeshStandardMaterial({color:bridge.kind==='modern'?'#d8d9c8':'#a8895c',roughness:.85})
      const railing = new THREE.MeshStandardMaterial({color:bridge.kind==='modern'?'#49675a':'#6d6250',roughness:.75})
      const beams:THREE.BufferGeometry[]=[]
      const box=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);beams.push(g)}
      const deck=new THREE.Mesh(new THREE.BoxGeometry(bridge.length,.45,bridge.width),wood)
      deck.position.set(bridge.x,.275,bridge.z);deck.receiveShadow=true;this.group.add(deck)
      this.game.physics.add({type:'fixed',category:'floor',position:deck.position,friction:1,colliders:[{shape:'cuboid',parameters:[bridge.length/2,.225,bridge.width/2]}]})
      for(const sign of [-1,1]) {
        const z=bridge.z+sign*(bridge.width/2+.1)
        box(bridge.length,.2,.25,bridge.x,2,z)
        for(let x=-bridge.length/2+1;x<bridge.length/2;x+=3) box(.24,2,.24,bridge.x+x,1,z)
        this.game.physics.add({type:'fixed',category:'object',position:{x:bridge.x,y:1.2,z},colliders:[{shape:'cuboid',parameters:[bridge.length/2,1,.15]}]})
      }
      if(bridge.kind==='wood') for(let x=-bridge.length/2;x<bridge.length/2;x+=.8)box(.055,.012,bridge.width,bridge.x+x,.507,bridge.z)
      const mesh=new THREE.Mesh(mergeGeometries(beams),railing);beams.forEach(g=>g.dispose());mesh.castShadow=true;this.group.add(mesh)
    }
  }

  private buildWaterfall():void {
    const f=WATERFALL
    const material=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,uniforms:{uTime:this.time},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform float uTime;varying vec2 vUv;void main(){float streak=sin(vUv.x*87.+sin(vUv.x*32.)+uTime*.3)*.12+sin(vUv.y*28.+uTime*9.)*.08;float edge=smoothstep(0.,.1,vUv.x)*smoothstep(0.,.1,1.-vUv.x);gl_FragColor=vec4(vec3(.61,.86,.78)+streak,edge*.88);#include <colorspace_fragment>}`.replace(';#include',';\n#include')})
    const curtain=new THREE.Mesh(new THREE.PlaneGeometry(f.width,f.top-f.bottom,12,8),material)
    curtain.position.set(f.x,(f.top+f.bottom)/2,f.z);this.group.add(curtain)
    const stone=new THREE.MeshStandardMaterial({color:'#737f6c',roughness:1,flatShading:true})
    const pieces:THREE.BufferGeometry[]=[]
    for(let i=0;i<11;i++) {const g=new THREE.IcosahedronGeometry(1,0);g.scale(2.5+(i%3),3+(i%4),2);g.translate(f.x+(i-5)*2.1, i>2&&i<8?4:1,f.z-2.8);pieces.push(g)}
    const mesh=new THREE.Mesh(mergeGeometries(pieces),stone);pieces.forEach(g=>g.dispose());mesh.castShadow=true;this.group.add(mesh)
    // The grotto remains accessible from the sides behind the curtain.
    this.game.interactions.add({id:'waterfall-secret',position:new THREE.Vector3(f.x,0,f.z-7),radius:4,label:'THE QUIET COMMIT',sublabel:'A small space behind the noise.',onInteract:()=>{this.game.achievements.set('waterfall',1);this.game.recordSecret('waterfall');this.game.audio.play('achievement')}})
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
    if(p.y<level-.45) this.submerged+=dt;else this.submerged=0
    if(this.submerged>1.2) {
      this.submerged=0
      if(game.minigames.current?.id==='circuit')game.minigames.current.recover()
      else {game.player.respawn();game.audio.play('land',.5)}
    }
    if(now>this.fallAt&&p.distanceTo(new THREE.Vector3(WATERFALL.x,0,WATERFALL.z))<85) {
      this.fallAt=now+.2;game.particles.burst(new THREE.Vector3(WATERFALL.x+(Math.random()-.5)*8,-.4,WATERFALL.z+1),6,'splash')
    }
    if(water)game.audio.environment('water',Math.max(.1,1-Math.abs(water.edge)/12)*.5)
    else if(Math.hypot(p.x,p.z)>335)game.audio.environment('water',Math.min(.5,(Math.hypot(p.x,p.z)-335)/70))
  }
}
