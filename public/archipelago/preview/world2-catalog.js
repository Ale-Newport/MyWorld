import * as THREE from 'three';
import {sourceGroundPatch} from './prefab-terrain.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const AREAS=[
 ['bowling','Bolos · pista completa','Bowling'],['circuit','Carreras · circuito World2','Racing'],
 ['projects','Proyectos · panel interactivo','Projects'],['toilet','Baño · cabina física','Places'],
 ['achievements','Achievements · edificio y cascada','Achievements'],['behindTheScene','Behind the scenes · hoyo','Places'],
 ['social','Social · plaza y estatuas','Social'],['career','Estudios y experiencia · cronología','Career'],
 ['landing','Alejandro Newport · letras 3D','Title'],['cookie','Cookies · horno y dispensador','Places'],
 ['lab','Laboratorio · proyectos','Places'],['altar','Altar · cuenta atrás','Places'],
 ['timeMachine','Máquina del tiempo','Places'],['controls','Controles · mandos','Places'],['bonfire','Hoguera · restaurar objetos','Places'],
];
const nameOf=o=>o.userData.w2Source??o.name;
export function privateClone(root){const materials=new Map(),textures=new Map();const material=m=>{if(materials.has(m))return materials.get(m);const out=m.clone();for(const [key,value] of Object.entries(m))if(value?.isTexture){if(!textures.has(value))textures.set(value,value.clone());out[key]=textures.get(value);}materials.set(m,out);return out;};const o=root.clone(true);o.traverse(n=>{if(n.isMesh){n.geometry=n.geometry.clone();n.material=Array.isArray(n.material)?n.material.map(material):material(n.material);}});return o;}
export class World2Catalog {
 constructor(world,vegetation,data,manifest){
  Object.assign(this,{world,vegetation,data,manifest});this.entries=[];this.byId=new Map();this.nodes=new Map();
  world.updateMatrixWorld(true);vegetation.updateMatrixWorld(true);world.traverse(o=>this.nodes.set(nameOf(o),o));
  for(const [id,label,feature] of AREAS){let objects=this.nodes.has(id)?[this.nodes.get(id)]:[];
   if(id==='controls'||id==='bonfire')objects=this.collection(id);
   if(id==='circuit')objects.push(...this.collection('road.001'));
   if(id==='landing')objects=this.collection('title.001');
   if(objects.length)this.add(id,label,'World2 · actividades',objects,feature);
  }
  // Every independent physical object and authored collection remains available.
  // Collection entries preserve reference empties alongside meshes and colliders.
  const collections=new Set();world.traverse(o=>{for(const c of o.userData.w2Collections??[])collections.add(c);});
  const omit=new Set(['terrain','respawns',...AREAS.map(a=>a[0]),'title.001']);
  for(const c of collections){if(omit.has(c))continue;const objects=this.collection(c);if(objects.some(o=>this.hasMesh(o)))this.add('collection:'+c,'World2 · '+c,'World2 · conjuntos',objects,this.featureFor(c));}
  const seen=new Set();world.traverse(o=>{if(o.userData.w2Role!=='physical')return;
   const signature=[];o.traverse(n=>{if(n.isMesh)signature.push(n.geometry.uuid+':'+(Array.isArray(n.material)?n.material.map(m=>m.uuid).join(','):n.material.uuid));});
   const key=signature.join('|');if(!key||seen.has(key))return;seen.add(key);
   const source=nameOf(o);if(source.startsWith('refLettersPhysicalDynamic'))return;this.add('object:'+source,source.replace(/Physical(Dynamic|Fixed|Static)/g,'').replace(/^ref/,'')+' · World2','World2 · objetos',[o],['gitHubPhysicalDynamic','linkedInPhysicalDynamic','mailPhysicalDynamic'].includes(source)?'Social':null);
  });
  const vegetationSeen=new Set();vegetation.traverse(o=>{if(!o.isMesh)return;const key=o.geometry.uuid+':'+(o.material.uuid??'multi');if(vegetationSeen.has(key))return;vegetationSeen.add(key);this.add('nature:'+nameOf(o),nameOf(o)+' · World2','World2 · naturaleza',[o],null);});
 }
 hasMesh(o){let yes=false;o.traverse(n=>{if(n.isMesh&&n.userData.w2Role!=='collider')yes=true;});return yes;}
 collection(c){const all=[];this.world.traverse(o=>{if(o.userData.w2Collections?.includes(c))all.push(o);});const chosen=new Set(all);return all.filter(o=>{for(let p=o.parent;p;p=p.parent)if(chosen.has(p))return false;return true;});}
 featureFor(c){if(['pins','screen','bumpers'].includes(c))return 'Bowling';if(['board','pole'].includes(c))return 'Projects';if(['icons','default'].includes(c))return 'Social';if(['building'].includes(c))return 'Achievements';if(c==='explosiveCrates')return 'Crates';return null;}
 add(id,label,category,objects,feature){
  objects=[...new Set(objects)];const set=new Set(objects);objects=objects.filter(o=>{for(let p=o.parent;p;p=p.parent)if(set.has(p))return false;return true;});
  const source=new THREE.Group();for(const original of objects){const n=original.clone(true);original.matrixWorld.decompose(n.position,n.quaternion,n.scale);source.add(n);}
  source.updateMatrixWorld(true);let pit=null;if(id==='behindTheScene'){const terrain=this.nodes.get('terrain'),centre=this.nodes.get('refCenter.001').getWorldPosition(new THREE.Vector3());source.add(sourceGroundPatch(terrain,centre));pit={centre:centre.toArray(),radius:6.5};}const box=new THREE.Box3();source.traverse(o=>{if(o.isMesh&&o.userData.w2Role!=='collider')box.expandByObject(o);});
  if(box.isEmpty())return;const centre=box.getCenter(new THREE.Vector3());const area=this.nodes.get(id);const anchor=area?area.getWorldPosition(new THREE.Vector3()):centre.clone();anchor.y=feature?0:box.min.y;
  source.traverse(o=>{if(o.userData.w2Role==='collider')o.visible=false;if(o.isMesh){o.castShadow=o.userData.w2Category!=='terrain';o.receiveShadow=true;}});
  const entry={id,label,category,source,anchor:anchor.toArray(),feature,pit,size:box.getSize(new THREE.Vector3()).toArray()};this.entries.push(entry);this.byId.set(id,entry);
 }
 canonical(entry){return privateClone(entry.source);}
 spawnFor(asset){const entry=this.byId.get(asset.userData.world2Asset);if(!entry)return null;const names={landing:'respawnLanding',behindTheScene:'respawnBehindTheScene',timeMachine:'respawnTimeMachine'};const name=names[entry.id]??'respawn'+entry.id[0].toUpperCase()+entry.id.slice(1);const source=this.manifest.spawns.find(p=>p.name===name);if(!source)return null;asset.updateWorldMatrix(true,false);const matrix=asset.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(...entry.anchor.map(x=>-x)));const p=new THREE.Vector3(...source.position);p.y+=1.2;p.applyMatrix4(matrix);const f=new THREE.Vector3(Math.cos(source.rotation),0,-Math.sin(source.rotation)).transformDirection(matrix);return {name:entry.label,position:p.toArray(),rotation:Math.atan2(-f.z,f.x)};}
 template(entry){
  const node=new THREE.Group();node.name=entry.label;node.userData={world2Asset:entry.id,world2Feature:entry.feature,world2Anchor:entry.anchor,editable_root:true,ground_surface:false,world2Pit:entry.pit?{centre:entry.pit.centre.map((v,i)=>v-entry.anchor[i]),radius:entry.pit.radius}:null,category:entry.category};
  const content=this.canonical(entry);content.position.fromArray(entry.anchor).negate();node.add(content);return node;
 }
}
export async function loadWorld2Catalog(){const loader=new GLTFLoader(),base='../assets/environment/portfolio/';const [a,b,data,manifest]=await Promise.all([loader.loadAsync(base+'models/world.glb'),loader.loadAsync(base+'models/vegetation.glb'),fetch(base+'interactions.json').then(r=>r.json()),fetch(base+'world-manifest.json').then(r=>r.json())]);return new World2Catalog(a.scene,b.scene,data,manifest);}
