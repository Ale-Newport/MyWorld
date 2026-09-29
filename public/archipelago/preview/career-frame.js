import * as THREE from 'three';
import {Career} from './portfolio/world2/interactions/Career.js';

const identity=new THREE.Matrix4();
function bySource(root,source){let found;root?.traverse(n=>{if(!found&&n.userData.w2Source===source)found=n;});return found;}
export function careerSourceBasis(catalog){const source=bySource(catalog?.byId.get('career')?.source,'career');source?.updateWorldMatrix(true,false);return source?.matrixWorld.clone()??null;}
function equalMatrix(a,b){return a.elements.every((v,i)=>Math.abs(v-b.elements[i])<1e-10);}

/** Keep the generated lanes in the model's authored frame without reparenting
 * nodes: existing world saves address this hierarchy by stable child IDs. */
function followSource(frame,source,generated,basis){
 frame.updateWorldMatrix(true,true);const delta=frame.matrixWorld.clone().invert().multiply(source.matrixWorld).multiply(basis.clone().invert());
 const previous=generated.userData.careerSourceDelta?new THREE.Matrix4().fromArray(generated.userData.careerSourceDelta):identity;
 if(!equalMatrix(delta,previous)){
  generated.updateMatrix();const next=delta.clone().multiply(previous.clone().invert()).multiply(generated.matrix);next.decompose(generated.position,generated.quaternion,generated.scale);generated.updateWorldMatrix(false,true);
 }
 generated.userData.careerSourceDelta=delta.toArray();generated.userData.careerSourceBasis=basis.toArray();return delta;
}

export function syncCareerPreviews(root,catalog){
 const assets=[];root.traverse(n=>{if(n.userData.world2Asset==='career')assets.push(n);});
 for(const asset of assets){const source=bySource(asset,'career');let generated;asset.traverse(n=>{if(!generated&&(n.userData.assetRuntimeKey==='runtime:career#0'||n.name==='runtime:career'))generated=n;});
  if(!source||!generated?.parent)continue;
  const basis=generated.userData.careerSourceBasis?new THREE.Matrix4().fromArray(generated.userData.careerSourceBasis):careerSourceBasis(catalog);if(basis)followSource(generated.parent,source,generated,basis);
 }
}

/** The copied controller measures a straight X/Z timeline. Build in that
 * original frame, then transform its visuals and player query together. */
export class FramedCareer extends Career{
 constructor(game,references,basis,bin){
  const source=references.node('career'),saved=source?{p:source.position.clone(),q:source.quaternion.clone(),s:source.scale.clone()}:null,frame={inverse:new THREE.Matrix4(),basis,source};
  if(source&&basis){source.parent?.updateWorldMatrix(true,false);const local=source.parent?source.parent.matrixWorld.clone().invert().multiply(basis):basis;local.decompose(source.position,source.quaternion,source.scale);source.updateWorldMatrix(false,true);}
  const player=new Proxy(game.player,{get(target,key){if(key==='position')return target.position.clone().applyMatrix4(frame.inverse);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  try{super({...game,player},references,bin);}finally{if(saved){source.position.copy(saved.p);source.quaternion.copy(saved.q);source.scale.copy(saved.s);source.updateWorldMatrix(false,true);}}
  this.sourceFrame=frame;
 }
 syncSourceFrame(parent){const f=this.sourceFrame;if(f.source&&f.basis)f.inverse.copy(followSource(parent,f.source,this.group,f.basis)).invert();}
}
