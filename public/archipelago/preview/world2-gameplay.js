import * as THREE from 'three';
import {Bin} from './portfolio/world/core/Disposal.js';
import {Events} from './runtime/Events.js';
import {Tweens} from './portfolio/world/core/Tween.js';
import {World2Environment} from './portfolio/world2/World2Environment.js';
import {References} from './portfolio/world2/interactions/references.js';
import {reservedNames,Interactions} from './portfolio/world2/interactions/Interactions.js';
import {Prompts} from './portfolio/world2/interactions/Prompts.js';
import {Achievements} from './portfolio/world2/interactions/Achievements.js';
import {Bowling} from './portfolio/world2/interactions/Bowling.js';
import {Circuit} from './portfolio/world2/interactions/Circuit.js';
import {Projects} from './portfolio/world2/interactions/Projects.js';
import {paintProjectsPreview} from './projects-preview.js';
import {FramedCareer,careerSourceBasis} from './career-frame.js';
import {Title} from './portfolio/world2/interactions/Title.js';
import {Social} from './portfolio/world2/interactions/Social.js';
import {Places} from './portfolio/world2/interactions/Places.js';
import {Blackboards} from './portfolio/world2/interactions/Blackboards.js';
import {Explosions} from './portfolio/world2/interactions/Explosions.js';
import {ExplosiveCrates} from './portfolio/world2/interactions/ExplosiveCrates.js';
import {LocalPhysics} from './runtime/local-physics.js';
import {Physics} from './runtime/physics.js';
import {collectRuntimeEdits,applyRuntimeEdits,cloneAsset,tagAssetParts} from './asset-definitions.js';

class PrefabEnvironment extends World2Environment {
 adopt(source){this.group.add(source);this.group.updateMatrixWorld(true);source.traverse(o=>{this.nodes.set(o.userData.w2Source??o.name,o);this.nodes.set(o.name,o);if(o.userData.w2Role==='collider')o.visible=false;else if(o.isMesh)this.meshes.push(o);});}
 addWater(){} terrainHeightAt(){return 0;}
}
const quietAudio={play(){},impact(){},environment(){}};
const fallbackInputs=()=>({events:new Events(),actions:new Map(),mode:'keyboard',gamepad:{type:'xbox',events:new Events()},setFilters(){},isActive(){return false;}});
const emptyReferences={node(){return null;}};

export class World2Instance {
 constructor(manager,asset){
  this.manager=manager;this.asset=asset;this.entry=manager.catalog.byId.get(asset.userData.world2Asset);this.bin=new Bin();this.parts={};
  const entry=this.entry,drive=manager.driving,frame=new THREE.Group();this.frame=frame;
  asset.updateWorldMatrix(true,false);const matrix=asset.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(...entry.anchor.map(x=>-x)));
  
  const edits=collectRuntimeEdits(asset),canonical=manager.catalog.canonical(entry),removed=asset.userData.assetRemovedParts??[];
  applyRuntimeEdits(canonical,edits,entry.anchor,{sourceOnly:true});
  const remove=[];canonical.traverse(n=>{if(removed.some(e=>e.source&&e.source===n.userData.w2Source))remove.push(n);if(n.userData.assetPartEdited&&n.userData.collision===false){n.userData.w2Role=n.userData.w2Role==='physical'?'visual':n.userData.w2Role;n.traverse(child=>{if(child.userData.w2Role==='collider')remove.push(child);});n.userData.w2Category='water';}});remove.forEach(n=>n.removeFromParent());
  const environment=new PrefabEnvironment({...manager.catalog.manifest,areas:[]},this.bin);environment.adopt(canonical);this.environment=environment;
  const physics=new LocalPhysics(manager.physics,matrix,environment.nodes);this.physics=physics;
  const player=new Proxy(drive.player,{get(p,k){if(k==='position')return physics.local(p.position);if(k==='position2'){const v=physics.local(p.position);return new THREE.Vector2(v.x,v.z);}const v=p[k];return typeof v==='function'?v.bind(p):v;}});
  const vehicle=new Proxy(drive.vehicle,{get(v,k){if(k==='position')return physics.local(v.position);if(k==='chassis')return {...v.chassis,physical:physics.wrap(v.chassis.physical)};if(k==='moveTo')return (p,angle)=>{const direction=physics.vector({x:Math.cos(angle),y:0,z:-Math.sin(angle)});v.moveTo(physics.point(p),Math.atan2(-direction.z,direction.x));};return v[k];}});
  const view=new Proxy(drive.view,{get(v,k){if(k==='startCinematic')return (p,target,...rest)=>v.startCinematic(physics.point(p),physics.point(target),...rest);if(k==='focusPoint')return {...v.focusPoint,position:physics.local(v.focusPoint.position??drive.player.position)};const value=v[k];return typeof value==='function'?value.bind(v):value;}});
  const game={...drive,bin:this.bin,ticker:drive.ticker,tweens:drive.tweens,inputs:drive.inputs,physics,environment,player,vehicle,view,renderer:{scene:frame},status:manager.status,audio:drive.audio??quietAudio,lighting:{phase:.4},publishGameplay:()=>{},toggleMap:()=>manager.ui.map?.(),toggleHelp:()=>manager.ui.help?.(),toggleAchievements:()=>manager.ui.achievements?.()};this.game=game;
  const feature=entry.feature;
  if(feature)for(const name of reservedNames(environment.nodes))environment.reserved.add(name);
  environment.addPhysics(physics,drive.ticker);environment.addVegetationPhysics();manager.physics.refreshQueries();
  const data={...manager.catalog.data,checkpoints:feature==='Racing'?manager.catalog.data.checkpoints:[],careerText:feature==='Career'?manager.catalog.data.careerText:[]};
  const refs=new References(environment,data);this.references=refs;
  const prompts=new Prompts(drive.ticker,drive.tweens,drive.inputs,this.bin,()=>player.position);this.prompts=prompts;frame.add(environment.group,prompts.group);
  const explosions=new Explosions(physics,drive.ticker,view,this.bin,physics.wrap(drive.vehicle.chassis.physical),(at,strength)=>game.audio.environment('explosion',Math.min(1,strength/8)));frame.add(explosions.group);
  const facade={prompts,achievements:manager.achievements,explosions,resetProps:()=>manager.reset()};game.interactions=facade;
  const own=(name,Controller,...args)=>{const component=new Controller(game,refs,...args,this.bin);this.parts[name]=component;facade[name]=component;if(component.group){component.group.name='runtime:'+name;let index=0;component.group.traverse(n=>{if(!n.name)n.name='runtime:'+name+':'+n.type+':'+index++;});frame.add(component.group);}return component;};
  if(feature==='Bowling'){
   const bowling=own('bowling',Bowling);const at=refs.position('refRestartInteractivePoint');
   if(at)bowling.attachPrompts(prompts.create({label:'Reset pins',position:at,align:'right',startHidden:true,onInteract:()=>bowling.reset()}),null);
   const bumper=refs.position('refBumpersInteractivePoint.001');if(bumper)prompts.create({label:'Bumpers',position:bumper,align:'left',onInteract:()=>bowling.toggleBumpers()});
  }
  if(feature==='Racing'){
   const circuit=own('circuit',Circuit);const at=refs.position('refInteractivePoint.003');if(at)circuit.attachPrompt(prompts.create({label:'Start race',position:at,align:'right',onInteract:()=>circuit.restart()}));
   const reset=refs.position('refLeaderboardReset');if(reset)prompts.create({label:'Clear best laps',position:reset,align:'left',onInteract:()=>circuit.clearRecords()});
  }
  if(feature==='Projects'){
   const projects=own('projects',Projects);const at=refs.position('refInteractivePoint');if(at)projects.attachPrompt(prompts.create({label:'Projects',position:at,align:'right',onInteract:()=>projects.open()}));
  }
  if(feature==='Career')own('career',FramedCareer,careerSourceBasis(manager.catalog)).syncSourceFrame(frame);
  if(feature==='Title'){const title=own('title',Title);title.group.userData.assetDisplayName='Alejandro Newport · letters';title.letters.forEach((letter,i)=>{letter.mesh.userData.assetDisplayName='Letter '+letter.char+' · '+String(i+1).padStart(2,'0');});}
  if(feature==='Social')own('social',Social,prompts);
  if(feature==='Achievements'){
   const a=own('achievements',Achievements);a.groups=manager.achievements.groups;
  }
  if(feature==='Crates'||environment.collection('explosiveCrates').length){const crates=new ExplosiveCrates(refs,physics,drive.ticker,drive.tweens,explosions,this.bin,{onFuse:()=>game.audio.play('blip',1.9),onExplode:()=>manager.achievements.unlock('tnt'),onChain:(count,total)=>{manager.achievements.set('tntChain',count);for(let i=0;i<total;i++)manager.achievements.mark('tntAll','crate-'+i);}});this.parts.crates=crates;}
  if(feature)own('places',Places,prompts);
  if(feature)new Blackboards(refs,drive.inputs,this.bin);
  const bonfire=refs.position('refBonfireInteractivePoint');if(bonfire)prompts.create({label:'Reset the island',position:bonfire,align:'right',onInteract:()=>manager.reset()});
  tagAssetParts(frame);
  const changed=applyRuntimeEdits(frame,edits,entry.anchor);this.parts.career?.syncSourceFrame(frame);const generatedRemoved=[];frame.traverse(n=>{if(removed.some(e=>e.key===n.userData.assetRuntimeKey))generatedRemoved.push(n);});
  const bindings=[...environment.dynamic,...(this.parts.title?.letters??[]).map(l=>({node:l.mesh,physical:l.physical,home:l.home}))];if(this.parts.bowling?.ballNode)bindings.push({node:this.parts.bowling.ballNode,physical:this.parts.bowling.ball,home:{position:this.parts.bowling.ballHome}});
  for(const {node,physical,home} of bindings){if(generatedRemoved.includes(node)){node.visible=false;physical.body.setEnabled(false);continue;}if(!changed.includes(node))continue;node.updateWorldMatrix(true,false);const p=node.getWorldPosition(new THREE.Vector3()),q=node.getWorldQuaternion(new THREE.Quaternion());physical.body.setTranslation(p,true);physical.body.setRotation(q,true);physical.body.setLinvel({x:0,y:0,z:0},true);const raw=physical.raw??physical,worldPosition=physics.point(p),worldRotation=physics.quaternion(q);raw.current.position.copy(worldPosition);raw.previous.position.copy(worldPosition);raw.current.quaternion.copy(worldRotation);raw.previous.quaternion.copy(worldRotation);raw.initialState.position=worldPosition.clone();raw.initialState.rotation=worldRotation.clone();if(home){home.position?.copy(p);home.quaternion?.copy(q);}if(this.parts.title?.letters.some(l=>l.mesh===node)&&node.geometry){node.geometry.computeBoundingBox();const half=node.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(node.getWorldScale(new THREE.Vector3())).multiplyScalar(physics.scale*.5);for(const c of physical.colliders)c.setHalfExtents(half);}for(const collider of physical.colliders){if(node.userData.mass)collider.setMass(node.userData.mass/physical.colliders.length);if(node.userData.friction!==undefined)collider.setFriction(node.userData.friction);if(node.userData.restitution!==undefined)collider.setRestitution(node.userData.restitution);if(node.userData.collision===false)collider.setEnabled(false);}}
  generatedRemoved.forEach(n=>{n.visible=false;n.userData.deleted=true;});
  const visibility=changed.filter(n=>n.userData.assetVisibilityEdited).map(n=>[n,n.visible]);if(visibility.length||generatedRemoved.length){const maintain=()=>{for(const [n,visible] of visibility)n.visible=visible;for(const n of generatedRemoved)n.visible=false;};drive.ticker.events.on('tick',maintain,100);this.bin.add(()=>drive.ticker.events.off('tick',maintain));}
  // User-created/duplicated children live alongside regenerated gameplay parts.
  const newParts=[];asset.traverse(n=>{if(n.userData.assetNewPart&&!n.parent?.userData.assetNewPart)newParts.push(n);});
  for(const original of newParts){const extra=cloneAsset(original,true),world=new THREE.Matrix4().makeTranslation(...entry.anchor).multiply(asset.matrixWorld.clone().invert()).multiply(original.matrixWorld);world.decompose(extra.position,extra.quaternion,extra.scale);frame.add(extra);if(extra.userData.collision){extra.updateWorldMatrix(true,true);const geometry=[];extra.traverse(n=>{if(n.isMesh)geometry.push(n.geometry.clone().applyMatrix4(n.matrixWorld));});const colliders=geometry.map(g=>({shape:'trimesh',parameters:[Float32Array.from(g.attributes.position.array),g.index?Uint32Array.from(g.index.array):Uint32Array.from({length:g.attributes.position.count},(_,i)=>i)]}));if(colliders.length)physics.add({type:'fixed',colliders,owner:extra.name,friction:extra.userData.friction??.7});geometry.forEach(g=>g.dispose());}this.bin.object3D(extra);}
  // Keep authored material edits when replacing the Edit preview with gameplay.
  const edited=new Map();asset.traverse(o=>{if(o.isMesh&&o.userData.materialEdited)edited.set(o.userData.w2Source??o.name,Array.isArray(o.material)?o.material:[o.material]);});
  frame.traverse(o=>{const saved=edited.get(o.userData.w2Source??o.name);if(!o.isMesh||!saved)return;const apply=(m,i)=>{const source=saved[i]??saved[0],out=m.clone();if(out.color&&source.color)out.color.copy(source.color);for(const k of ['roughness','metalness'])if(k in out&&k in source)out[k]=source[k];if(source.userData.editorTexture){out.map=source.map;out.needsUpdate=true;}this.bin.add(()=>out.dispose());return out;};o.material=Array.isArray(o.material)?o.material.map(apply):apply(o.material,0);});
  // Original controllers use authored global coordinates. Keep lookups in that
  // frame after rendering applies the user-authored prefab placement.
  refs.position=name=>{const n=refs.node(name);return n?physics.local(n.getWorldPosition(new THREE.Vector3())):null;};
  refs.transform=name=>{const n=refs.node(name);if(!n)return null;n.updateWorldMatrix(true,false);const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();physics.inverse.clone().multiply(n.matrixWorld).decompose(p,q,s);return {position:p,quaternion:q,scale:s};};
  matrix.decompose(frame.position,frame.quaternion,frame.scale);asset.visible=false;manager.scene.add(frame);frame.updateMatrixWorld(true);
 }
 get busy(){return (this.parts.circuit&&this.parts.circuit.state!=='pending')||(this.parts.projects&&this.parts.projects.state!=='closed');}
 exit(){if(this.parts.projects?.state!=='closed'&&this.parts.projects)this.parts.projects.close();else this.parts.circuit?.exit(true);}
 reset(){this.parts.title?.reset();this.parts.bowling?.reset();this.parts.crates?.reset();this.game.interactions.explosions.clear();for(const {physical} of this.environment.dynamic)this.physics.reset(physical);}
 dispose(){this.frame.removeFromParent();this.asset.visible=true;this.bin.dispose();}
}

export class World2Gameplay {
 constructor(catalog,scene,root,physics,driving,ui={}){
  Object.assign(this,{catalog,scene,root,physics,driving,ui});this.status={area:'island',achievementsOpen:false};this.bin=new Bin();
  const game={...driving,status:this.status,publishGameplay(){}};this.achievements=new Achievements(game,emptyReferences,this.bin);scene.add(this.achievements.group);
  this.instances=[];const assets=[];root.traverse(o=>{if(!o.userData.world2Asset)return;for(let parent=o;parent;parent=parent.parent)if(!parent.visible||parent.userData.deleted)return;assets.push(o);});
  for(const asset of assets)this.instances.push(new World2Instance(this,asset));
  const on=(action,fn)=>{const listener=a=>{if(a.active)fn();};driving.inputs.events.on(action,listener);this.bin.add(()=>driving.inputs.events.off(action,listener));};
  on('interact',()=>this.interact());on('boardPrevious',()=>this.active()?.parts.projects?.step(-1));on('boardNext',()=>this.active()?.parts.projects?.step(1));
  game.interactions={achievements:this.achievements};if(!driving.simulationOnly)Interactions.prototype.watchDriving.call({game,achievements:this.achievements});
  driving.player.onRespawnRequest=()=>this.active()?.parts.circuit?.respawn()??false;
 }
 active(){return this.instances.find(i=>i.busy);}
 interact(){const active=this.active();if(active?.parts.projects?.state==='open'){active.parts.projects.openLink();return true;}const item=this.instances.find(i=>i.prompts.activeLabel);return item?.prompts.interactActive()??false;}
 reset(){for(const instance of this.instances)instance.reset();this.physics.resetProps();}
 hud(){const active=this.active();const race=active?.parts.circuit?.hud(),board=active?.parts.projects?.hud();const lane=this.instances.map(i=>i.parts.bowling?.hud()).find(h=>h?.headline);return {headline:race?.headline??board?.headline??lane?.headline??'',timer:race?.timer??'',lines:race?.lines??board?.lines??lane?.lines??[],prompt:this.instances.find(i=>i.prompts.activeLabel)?.prompts.activeLabel??'',notice:this.achievements.notice};}
 dispose(){this.instances.forEach(i=>i.dispose());this.achievements.group.removeFromParent();this.bin.dispose();}
}

/** Render original runtime-generated name, career labels and screens in Edit too. */
export function authoringPreview(catalog,entry){
 const physics=new Physics(),scene=new THREE.Scene(),ticker={events:new Events(),elapsed:0,delta:1/60,deltaScaled:1/30,scale:2,alpha:1};const bin=new Bin(),inputs=fallbackInputs();
 const empty=physics.add({type:'dynamic',colliders:[{shape:'cuboid',parameters:[.01,.01,.01]}],position:{x:10000,y:10000,z:10000}});
 const player={position:new THREE.Vector3(10000,10000,10000),events:new Events(),setState(){},respawn(){},distanceDriven:0,boosting:0};
 const view={focusPoint:{position:player.position},kick(){},startCinematic(){},endCinematic(){}};
 const driving={ticker,tweens:new Tweens(ticker,bin),inputs,player,view,audio:quietAudio,vehicle:{position:player.position,chassis:{physical:empty},speedKmh:0,wheels:{inContactCount:4},moveTo(){}}};
 const manager={catalog,physics,scene,driving,status:{area:'preview'},ui:{},reset(){},achievements:null};manager.achievements=new Achievements({...driving,publishGameplay(){}},emptyReferences,bin);
 const asset=new THREE.Group();asset.userData.world2Asset=entry.id;const instance=new World2Instance(manager,asset);
 paintProjectsPreview(instance.parts.projects);
 const frame=instance.frame;frame.removeFromParent();ticker.events.clear();physics.destroy();return frame;
}

export function simulationDriver(physics,position){
 const bin=new Bin(),ticker={events:new Events(),elapsed:0,delta:1/60,deltaScaled:1/30,scale:2,alpha:1},inputs=fallbackInputs();
 const body=physics.add({type:'fixed',colliders:[{shape:'cuboid',parameters:[.01,.01,.01]}],position:{x:10000,y:10000,z:10000}});
 const player={position:position.clone(),events:new Events(),setState(){},respawn(){},distanceDriven:0,boosting:0};
 return {simulationOnly:true,bin,ticker,inputs,player,tweens:new Tweens(ticker,bin),view:{focusPoint:{position:player.position},kick(){},startCinematic(){},endCinematic(){}},audio:quietAudio,vehicle:{position:player.position,chassis:{physical:body},speedKmh:0,wheels:{inContactCount:4},moveTo(){}},dispose(){bin.dispose();ticker.events.clear();}};
}
