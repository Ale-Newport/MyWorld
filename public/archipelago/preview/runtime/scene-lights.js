import * as THREE from 'three';

function available(light,root){
 if(light.userData.deleted||light.userData.assetVisibilityEdited&&!light.visible||light.intensity<=0)return false;
 if(!light.visible&&!light.userData.nightReady&&!light.userData.nighttime)return false;
 for(let p=light.parent;p;p=p.parent){if(!p.visible||p.userData.deleted)return false;if(p===root)return true;}
 return false;
}

/** Fixed render-only light slots keep shader counts stable as the focus moves.
 * Authored lights remain intact for editing, saving and GLB export. */
export class SceneLightBudget{
 constructor(scene,root,{pointBudget=8,spotBudget=1,interval=500}={}){
  this.scene=scene;this.root=root;this.interval=interval;this.lastRefresh=-Infinity;this.night=false;this.sources=[];this.point=new THREE.Vector3();
  this.group=new THREE.Group();this.group.name='Runtime nearby lights';this.group.userData={editorOnly:true,runtimeOnly:true};this.group.visible=false;scene.add(this.group);
  this.slots=[];for(const [kind,count]of [['point',pointBudget],['spot',spotBudget]])for(let i=0;i<count;i++){
   const light=kind==='point'?new THREE.PointLight(0xffffff,0):new THREE.SpotLight(0xffffff,0);light.name=`Nearby ${kind} light ${i+1}`;light.castShadow=false;this.group.add(light);if(light.isSpotLight)this.group.add(light.target);this.slots.push({kind,light,source:null});
  }
 }
 invalidate(){this.lastRefresh=-Infinity;}
 refresh(focus,now){
  this.lastRefresh=now;this.sources=[];const points=[],spots=[];
  this.root.traverse(light=>{if(!light.isPointLight&&!light.isSpotLight)return;this.sources.push(light);if(!available(light,this.root))return;light.getWorldPosition(this.point);const priority=Math.max(0,Number(light.userData.lightPriority)||0),score=this.point.distanceToSquared(focus)/(1+priority);(light.isSpotLight?spots:points).push({light,score});});
  points.sort((a,b)=>a.score-b.score);spots.sort((a,b)=>a.score-b.score);let p=0,s=0;for(const slot of this.slots)slot.source=(slot.kind==='point'?points[p++]:spots[s++])?.light??null;
 }
 update(night,focus,now){
  if(night!==this.night){this.night=night;this.invalidate();}this.group.visible=night;
  if(now-this.lastRefresh>=this.interval)this.refresh(focus,now);
  if(!night)return;
  for(const slot of this.slots){const source=slot.source,light=slot.light;if(!source||!available(source,this.root)){light.intensity=0;continue;}
   source.getWorldPosition(light.position);light.color.copy(source.color);light.intensity=source.intensity;light.distance=source.distance;light.decay=source.decay;
   if(light.isSpotLight){light.angle=source.angle;light.penumbra=source.penumbra;source.target.getWorldPosition(light.target.position);}
  }
 }
 render(renderer,camera,night,focus,now){
  this.update(night,focus,now);
  // A synchronous render-only mask avoids changing visible/metadata in documents
  // or in Asset Studio clones. Finally also restores state if rendering fails.
  const masks=this.sources.map(light=>light.layers.mask);for(const light of this.sources)light.layers.mask=0;
  try{renderer.render(this.scene,camera);}finally{this.sources.forEach((light,i)=>light.layers.mask=masks[i]);}
 }
 dispose(){this.group.removeFromParent();for(const {light}of this.slots)light.dispose();this.sources=[];this.slots=[];}
}
