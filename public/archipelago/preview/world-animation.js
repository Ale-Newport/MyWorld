import * as THREE from 'three';

function sourceTarget(root,name){
 if(!name)return root;
 let stable;root.traverse(node=>{if(!stable&&node.userData.assetRuntimeKey?.replace(/#\d+$/,'')===name)stable=node;});
 return stable??root.getObjectByName(name)??root.getObjectByProperty('uuid',name);
}
function bindingPath(binding){
 let path='';if(binding.objectName)path+='.'+binding.objectName+(binding.objectIndex!==undefined?'['+binding.objectIndex+']':'');
 return path+'.'+binding.propertyName+(binding.propertyIndex!==undefined?'['+binding.propertyIndex+']':'');
}
/** Rebase original motion onto the edited local pose. The first original key
 * becomes the authored pose; later keys retain the same relative motion.
 * Cubic-spline tangents are transformed as derivatives, never translated. */
function rebaseTrack(track,target,binding){
 const property=binding.propertyName;if(binding.objectName||!['position','quaternion','scale'].includes(property)||!track.times.length)return;
 const cubic=!!track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline,stride=track.getValueSize(),size=cubic?stride/3:stride,first=cubic?size:0,values=track.values;
 if(property==='quaternion'&&size===4&&binding.propertyIndex===undefined){
  const initial=new THREE.Quaternion().fromArray(values,first).normalize(),delta=target.quaternion.clone().multiply(initial.invert()).normalize(),value=new THREE.Quaternion();
  for(let key=0;key<track.times.length;key++)for(let part=0;part<(cubic?3:1);part++){const offset=key*stride+part*size;value.fromArray(values,offset).premultiply(delta);if(!cubic||part===1)value.normalize();value.toArray(values,offset);}return;
 }
 if(property==='quaternion')return;
 const axes=['x','y','z'],index=binding.propertyIndex,component=index===undefined?null:axes.includes(index)?axes.indexOf(index):Number(index);
 if(size!==(component===null?3:1))return;
 for(let axis=0;axis<size;axis++){const authored=target[property][axes[component??axis]],initial=values[first+axis];if(!Number.isFinite(authored))continue;const multiply=property==='scale'&&Math.abs(initial)>1e-8,factor=multiply?authored/initial:1,offset=multiply?0:authored-initial;
  for(let key=0;key<track.times.length;key++)for(let part=0;part<(cubic?3:1);part++){const at=key*stride+part*size+axis;values[at]=values[at]*factor+(!cubic||part===1?offset:0);}
 }
}

/** Clips address actual instance nodes, so duplicates retain their own animation. */
export function worldAnimationClips(root,sourceClips=[]){
 const clips=[];
 root.traverseVisible(node=>{
  if(node.userData.sourceAnimations)for(const source of sourceClips){
   const tracks=[];for(const original of source.tracks){const binding=THREE.PropertyBinding.parseTrackName(original.name),target=sourceTarget(node,binding.nodeName);if(!target)continue;const t=original.clone();rebaseTrack(t,target,binding);t.name=target.uuid+bindingPath(binding);tracks.push(t);}if(tracks.length)clips.push(new THREE.AnimationClip(node.name+' · wheel',source.duration,tracks));
  }
  const data=node.userData.animation,custom=node.userData.assetAnimation;
  const a=custom?.enabled?{kind:'spin',axis:custom.axis,speed:THREE.MathUtils.degToRad(custom.speed)}:data;if(!a)return;
  const axis=['x','y','z'].includes(a.axis)?a.axis:'y',speed=Number(a.speed)||1,period=a.kind==='spin'?Math.PI*2/Math.abs(speed):Math.PI*2/Math.abs(speed),times=[],values=[];
  if(['spin','sway'].includes(a.kind)){for(let i=0;i<=64;i++){const t=i/64*period,e=node.rotation.clone();e[axis]+=a.kind==='spin'?speed*t:Math.sin(t*speed)*(a.amplitude??.05);times.push(t);values.push(...new THREE.Quaternion().setFromEuler(e).toArray());}clips.push(new THREE.AnimationClip(node.name+' · '+a.kind,period,[new THREE.QuaternionKeyframeTrack(node.uuid+'.quaternion',times,values)]));}
  else if(['float','pulse','waterFlow'].includes(a.kind)){for(let i=0;i<=64;i++){const t=i/64*period,v=(a.kind==='float'?node.position:node.scale).clone();v[axis]+=Math.sin(t*speed)*(a.amplitude??.035);times.push(t);values.push(...v.toArray());}clips.push(new THREE.AnimationClip(node.name+' · '+a.kind,period,[new THREE.VectorKeyframeTrack(node.uuid+(a.kind==='float'?'.position':'.scale'),times,values)]));}
 });return clips;
}
