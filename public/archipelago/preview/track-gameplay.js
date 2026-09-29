import * as THREE from 'three';
import {Circuit} from './portfolio/world2/interactions/Circuit.js';
import {Prompts} from './portfolio/world2/interactions/Prompts.js';
import {Bin} from './portfolio/world/core/Disposal.js';
import {Tweens} from './portfolio/world/core/Tween.js';
import {definitionFromObject,sampleRoad} from './roads/road-system.js';
import {root as assetRoot,box,cylinder,torus,mat} from './assets/kit.js';

const START=.015,FIRST_GATE=.04,GATE_COUNT=12;
const visible=node=>{for(let n=node;n;n=n.parent)if(!n.visible||n.userData.deleted)return false;return true;};
function raceRoad(root){let found;root.traverse(n=>{if(!found&&visible(n)&&!n.userData.proceduralDerived&&(n.userData.road_network==='race'||n.userData.roadDefinition?.type==='race'))found=n;});return found;}
function curveFor(road){const definition=definitionFromObject(road);if(definition.points.length<3)return null;return {definition,curve:sampleRoad(definition).curve};}
function localAnchor(curve,t,lateral=0,elevation=0){const point=curve.getPointAt(t),direction=curve.getTangentAt(t);direction.y=0;direction.normalize();const normal=new THREE.Vector3(-direction.z,0,direction.x),yaw=Math.atan2(-direction.x,-direction.z);point.addScaledVector(normal,lateral);point.y+=elevation;return new THREE.Matrix4().compose(point,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(1,1,1));}
function projectSurface(road,definition,worldPoint){if(!definition.conformToTerrain)return worldPoint;const surface=road.isMesh?road:road.children.find(n=>n.userData.roadPart==='Road surface');if(!surface)return worldPoint;surface.updateWorldMatrix(true,false);const ray=new THREE.Raycaster(worldPoint.clone().add(new THREE.Vector3(0,1000,0)),new THREE.Vector3(0,-1,0),0,2000),hit=ray.intersectObject(surface,false)[0];if(hit)worldPoint.y=hit.point.y;return worldPoint;}
function syncAnchor(node,curve,definition){const {t,lateral=0,elevation=0}=node.userData.trackAnchor;node.updateMatrix();const previous=node.userData.trackAnchorMatrix,offset=previous?new THREE.Matrix4().fromArray(previous).invert().multiply(node.matrix):new THREE.Matrix4();const next=localAnchor(curve,t,lateral,elevation);if(definition.conformToTerrain){const road=node.parent,p=new THREE.Vector3().setFromMatrixPosition(next).applyMatrix4(road.matrixWorld);next.setPosition(road.worldToLocal(projectSurface(road,definition,p)));}next.clone().multiply(offset).decompose(node.position,node.quaternion,node.scale);node.userData.trackAnchorMatrix=next.toArray();node.updateMatrixWorld(true);}
function namedPlane(parent,name,width,height,position,color){const node=new THREE.Mesh(new THREE.PlaneGeometry(width,height),mat(color));node.name=name;node.position.fromArray(position);node.userData.collision=false;node.userData.trackReference=name;parent.add(node);return node;}

/** Editable furniture lives in the road's local frame, outside its driving lane.
 * Call again before constructing physics after editing the master curve. */
export function createTrackFurniture(root){
 root.updateMatrixWorld(true);const road=raceRoad(root);if(!road)return null;const data=curveFor(road);if(!data)return null;const {curve,definition}=data,w=definition.width;
 const find=role=>road.children.find(n=>n.userData.trackFurniture===role);
 const create=(role,name,t,lateral,build)=>{let node=find(role);if(!node){node=assetRoot(name,'Racing',{collision:true,tags:['race','catalunya','functional']});node.userData.trackFurniture=role;node.userData.aw_id=(road.userData.aw_id??definition.id)+':'+role;node.userData.trackAnchor={t,lateral};build(node);road.add(node);let index=0;node.traverse(n=>{n.userData.aw_id??=node.userData.aw_id+':part:'+index++;});}else node.userData.trackAnchor.lateral=lateral;syncAnchor(node,curve,definition);return node;};
 const gantry=create('gantry','Catalunya · starting gantry',FIRST_GATE,0,g=>{for(const s of [-1,1]){box(g,'Gantry footing '+s,[s*(w/2+1),.15,0],[.9,.3,.9],'stone');box(g,'Gantry tower '+s,[s*(w/2+1),2.3,0],[.3,4.6,.35],'red');}box(g,'Gantry crossbeam',[0,4.45,0],[w+2.6,.62,.45],'navy');for(let i=0;i<10;i++)box(g,'Checkered start emblem '+i,[-2.5+i*.55,4.56,.24],[.28,.23,.03],i%2?'white':'rubber',false);box(g,'Starting lamp housing',[0,3.83,0],[3.9,.61,.22],'rubber',false);namedPlane(g,'refStartingLights',3.5,.39,[0,3.83,.13],'red');});
 const board=create('timing','Catalunya · lap timing board',.026,-w/2-3.5,g=>{for(const x of [-1.1,1.1])box(g,'Timing board support '+x,[x,1.8,0],[.13,3.6,.13],'metal');box(g,'Timing board frame',[0,2.8,0],[3.2,3.3,.22],'navy');namedPlane(g,'refLeaderboard',2.9,2.9,[0,2.8,.13],'navy');const timer=new THREE.Object3D();timer.name='refTimer';timer.userData.trackReference='refTimer';timer.position.set(0,4.78,.18);g.add(timer);box(g,'Lap clock housing',[0,4.78,0],[2.85,.65,.2],'navy',false);});
 const marker=create('start','Catalunya · start race marker',START,-w/2-.9,g=>{g.userData.collision=false;cylinder(g,'Start marker plinth',[0,.08,0],.68,.16,'navy',.68,20,false);torus(g,'Start marker ring',[0,.18,0],.55,.08,'gold');box(g,'Start marker mast',[0,.9,0],[.07,1.5,.07],'metal',false);for(let i=0;i<2;i++){const flag=box(g,'Start chevron '+i,[.18+i*.33,1.6,0],[.46,.46,.055],'teal',false);flag.rotation.z=Math.PI/4;}});
 const oldWidth=gantry.userData.trackFurnitureWidth??w;if(oldWidth!==w){for(const sign of [-1,1])for(const name of ['Gantry footing ','Gantry tower ']){const part=gantry.getObjectByName(name+sign);if(part)part.position.x+=sign*(w-oldWidth)/2;}const beam=gantry.getObjectByName('Gantry crossbeam');if(beam)beam.scale.x*=(w+2.6)/(oldWidth+2.6);}gantry.userData.trackFurnitureWidth=w;
 root.updateMatrixWorld(true);return {road,gantry,board,marker,curve,definition};
}

function storageKey(checkpoints){const data=JSON.stringify(checkpoints.map(g=>[...g.position,...g.scale].map(v=>Math.round(v*100))));let hash=2166136261;for(let i=0;i<data.length;i++)hash=Math.imul(hash^data.charCodeAt(i),16777619);return 'helloworld-v4-catalunya-laps-'+(hash>>>0).toString(36);}
class NativeCircuit extends Circuit{
 load(){try{const raw=JSON.parse(localStorage.getItem(this.references.storageKey)??'null');if(Array.isArray(raw?.records))this.records=raw.records.filter(r=>Number.isFinite(r?.time)&&r.time>0).sort((a,b)=>a.time-b.time).slice(0,10);}catch{}}
 save(){try{localStorage.setItem(this.references.storageKey,JSON.stringify({records:this.records}));}catch{}}
 // Imported refs use a reflected authored basis. Native Three.js curves use the
 // normal basis, so align only the visual plane with the actual checkpoint line.
 place(mesh,gate){super.place(mesh,gate);mesh.rotation.y=gate.rotation;}
}
function referencesFor(furniture){
 const {road,curve,definition,gantry,board,marker}=furniture;road.updateWorldMatrix(true,true);const points=[];
 for(let i=0;i<GATE_COUNT;i++){const t=(FIRST_GATE+i/GATE_COUNT)%1,position=projectSurface(road,definition,curve.getPointAt(t).applyMatrix4(road.matrixWorld)),direction=curve.getTangentAt(t).transformDirection(road.matrixWorld),yaw=Math.atan2(-direction.x,-direction.z),scale=road.getWorldScale(new THREE.Vector3()),width=definition.width*(Math.abs(scale.x)+Math.abs(scale.z))*.5;points.push({name:'Catalunya checkpoint '+(i+1),position:position.toArray(),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw).toArray(),scale:[width,1,1]});}
 const startMatrix=road.matrixWorld.clone().multiply(localAnchor(curve,START)),start=new THREE.Object3D();start.name='refStart';startMatrix.decompose(start.position,start.quaternion,start.scale);projectSurface(road,definition,start.position);
 const reference=(group,name)=>{let result;group.traverse(n=>{if((n.userData.trackReference===name||n.name===name)&&visible(n))result=n;});return result??null;};
 const nodes=new Map([['refStart',start],['refStartingLights',reference(gantry,'refStartingLights')],['refLeaderboard',reference(board,'refLeaderboard')],['refTimer',reference(board,'refTimer')],['refInteractivePoint.003',visible(marker)?marker:null]]);
 const refs={interactions:{checkpoints:points},storageKey:storageKey(points),environment:{physicals:new Map(),collidersFor:()=>({colliders:[]})},node:name=>nodes.get(name)??null,series:()=>[],physical:()=>null,position(name){return this.node(name)?.getWorldPosition(new THREE.Vector3())??null;},transform(name){const node=this.node(name);if(!node)return null;node.updateWorldMatrix(true,false);const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();node.matrixWorld.decompose(position,quaternion,scale);return {position,quaternion,scale};}};return refs;
}

/** Retains Circuit's countdown, gate progression, respawn, achievements and HUD. */
export class TrackGameplay{
 constructor({root,scene,physics,driving,achievements,onReset=()=>{}}){
  this.bin=new Bin();this.circuit=null;this.prompts=null;this.driving=driving;this.disposed=false;const furniture=createTrackFurniture(root);if(!furniture)return;this.furniture=furniture;this.references=referencesFor(furniture);
  const tweens=new Tweens(driving.ticker,this.bin);this.prompts=new Prompts(driving.ticker,tweens,driving.inputs,this.bin,()=>driving.player.position);scene.add(this.prompts.group);
  const lights=this.references.node('refStartingLights'),board=this.references.node('refLeaderboard'),saved={lightsMaterial:lights?.material,lightsPosition:lights?.position.clone(),boardMaterial:board?.material};
  this.restoreFurniture=()=>{if(lights){lights.material=saved.lightsMaterial;lights.position.copy(saved.lightsPosition);}if(board)board.material=saved.boardMaterial;};
  const game={...driving,physics,tweens,publishGameplay:()=>driving.publishGameplay?.(),audio:driving.audio??{play(){}},interactions:{prompts:this.prompts,achievements:achievements??{unlock(){}},resetProps:onReset}};
  this.circuit=new NativeCircuit(game,this.references,this.bin);this.circuit.group.name='Catalunya · race gameplay';scene.add(this.circuit.group);
  if(!board)this.circuit.board.group.visible=false;const promptPosition=this.references.position('refInteractivePoint.003');if(promptPosition)this.circuit.attachPrompt(this.prompts.create({label:'Start Catalunya race',position:promptPosition,align:'right',onInteract:()=>this.circuit.restart()}));
  const resetPoint=furniture.board.localToWorld(new THREE.Vector3(-2,0,0));if(board)this.prompts.create({label:'Clear Catalunya best laps',position:resetPoint,align:'left',onInteract:()=>this.circuit.clearRecords()});
 }
 get busy(){return !!this.circuit&&this.circuit.state!=='pending';}
 hud(){const hud=this.circuit?.hud()??{};return {headline:hud.headline??'',timer:hud.timer??'',lines:hud.lines??[],prompt:this.prompts?.activeLabel??'',activity:hud.activity??null};}
 interact(){return this.prompts?.interactActive()??false;}
 respawn(){return this.circuit?.respawn()??false;}
 exit(){this.circuit?.exit(true);}
 reset(){this.circuit?.restart();}
 dispose(){if(this.disposed)return;this.disposed=true;if(this.busy)this.driving.player.setState('default');this.bin.dispose();this.restoreFurniture?.();this.circuit?.group.removeFromParent();this.prompts?.group.removeFromParent();}
}
