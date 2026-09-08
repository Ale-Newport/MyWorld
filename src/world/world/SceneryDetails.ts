import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'

/** Small, authored places to stop: lake benches, a woodland picnic clearing,
 * quarry fence and readable directions from the hub. Three merged materials. */
export function buildSceneryDetails(game:Game,bin:Bin):void {
  const group=new THREE.Group(),wood:THREE.BufferGeometry[]=[],metal:THREE.BufferGeometry[]=[],lights:THREE.BufferGeometry[]=[]
  const box=(out:THREE.BufferGeometry[],x:number,y:number,z:number,w:number,h:number,d:number)=>{const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);out.push(g)}
  const benches=[[-310,79],[-259,87],[-240,31],[98,277],[139,276],[83,214]]
  for(const [x,z] of benches) {
    const y=game.terrain.colliderHeightAt(x,z)
    for(let plank=0;plank<3;plank++)box(wood,x,y+.72,z+(plank-1)*.35,3.9,.18,.29)
    box(wood,x,y+1.5,z-.55,3.9,.8,.16)
    for(const dx of [-1.5,1.5])box(metal,x+dx,y+.4,z,.15,.8,1)
    // Solid seating only, never colliders for ornamental plank seams.
    game.physics.add({type:'fixed',category:'object',position:{x,y:y+.7,z},colliders:[{shape:'cuboid',parameters:[2,.6,.6]}]})
    box(metal,x+3,y+2.4,z-1,.14,4.8,.14);box(lights,x+3,y+4.65,z-1,.65,.65,.65)
  }
  for(let i=0;i<10;i++) {
    const x=255+i*4,z=76,y=game.terrain.colliderHeightAt(x,z)
    box(wood,x,y+1,z,.25,2,.25)
    if(i<9){box(wood,x+2,y+.7,z,4,.16,.16);box(wood,x+2,y+1.5,z,4,.16,.16)}
  }
  for(const [x,z,text] of [[-49,22,'← BOWLING'],[51,44,'TNT QUARRY →'],[-56,-51,'RIVER + WOODLAND ←']] as const) {
    const y=game.terrain.colliderHeightAt(x,z)
    for(const dx of [-3.1,3.1])box(metal,x+dx,y+2,z,.15,4,.15)
    game.playground.label(text,group,new THREE.Vector3(x,y+4,z),8,1.4)
  }
  for(const [pieces,color,emissive] of [[wood,'#9f875f',false],[metal,'#536955',false],[lights,'#e7cc83',true]] as const) {
    const geometry=mergeGeometries([...pieces]);pieces.forEach(g=>g.dispose())
    const material=new THREE.MeshStandardMaterial({color,roughness:.86,emissive:emissive?color:'#000000',emissiveIntensity:emissive?.75:0})
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=!emissive;mesh.receiveShadow=true;group.add(mesh)
  }
  game.renderer.scene.add(group);bin.object3D(group)
}
