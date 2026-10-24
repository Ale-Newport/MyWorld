import * as THREE from 'three';
import {sourceGroundPatch} from './prefab-terrain.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCompressedGLB} from './compressed-gltf.js';
import {fetchEarly} from './early-fetch.js';
import {PLAYER_MODE} from './world-storage.js';
import {plazaArrival} from './portfolio/world2/interactions/PlazaLayout.js';

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
// The circuit's fabric displays used imported technology/brand artwork.
// Keep their geometry and cloth material, but give those five surfaces a
// a muted racing palette. The podium has separate branded materials.
const CIRCUIT_FABRIC=new Set(['Cylinder.022','Cylinder.037','Cylinder.039','refBanners','refBanners.001']);
const FABRIC_COLORS=['#bf6844','#558e88','#c2a263','#558e88','#bf6844'];
const CIRCUIT_ARTWORK=new Set(['circuitWebgl','circuitWebgpu','circuitBrand']);
export function plainCircuitFabric(world){world.traverse(node=>{
 if(!node.isMesh||!CIRCUIT_FABRIC.has(nameOf(node)))return;
 const plain=material=>{if(!CIRCUIT_ARTWORK.has(material.name))return material;const fabric=material.clone();fabric.map=null;fabric.color.set(FABRIC_COLORS[[...CIRCUIT_FABRIC].indexOf(nameOf(node))]);fabric.roughness=.9;fabric.needsUpdate=true;return fabric;};
 node.material=Array.isArray(node.material)?node.material.map(plain):plain(node.material);
});}
export function privateClone(root){const materials=new Map(),textures=new Map();const material=m=>{if(materials.has(m))return materials.get(m);const out=m.clone();for(const [key,value] of Object.entries(m))if(value?.isTexture){if(!textures.has(value))textures.set(value,value.clone());out[key]=textures.get(value);}materials.set(m,out);return out;};const o=root.clone(true);o.traverse(n=>{if(n.isMesh){n.geometry=n.geometry.clone();n.material=Array.isArray(n.material)?n.material.map(material):material(n.material);}});return o;}
export class World2Catalog {
 constructor(world,vegetation,data,manifest){
  Object.assign(this,{world,vegetation,data,manifest});this.entries=[];this.byId=new Map();this.nodes=new Map();
  world.updateMatrixWorld(true);world.traverse(o=>this.nodes.set(nameOf(o),o));
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
  this.addVegetation(vegetation);
 }
 /** The vegetation scene's meshes become the `nature:*` entries (the studio's vegetation library). Returns the entries it added. */
 addVegetation(vegetation){
  const first=this.entries.length,seen=new Set();vegetation.updateMatrixWorld(true);
  vegetation.traverse(o=>{if(!o.isMesh)return;const key=o.geometry.uuid+':'+(o.material.uuid??'multi');if(seen.has(key))return;seen.add(key);this.add('nature:'+nameOf(o),nameOf(o)+' · World2','World2 · naturaleza',[o],null);});
  return this.entries.slice(first);
 }
 /** The player starts without the vegetation GLB (`vegetationSource` is how to fetch it). Once its world document is in, this fetches
  * and adds the `nature:*` entries only when that document names one of them; resolves to the entries added (none otherwise). */
 loadVegetationFor(world){
  if(!this.vegetationSource||!worldNamesVegetation(world))return Promise.resolve([]);
  return this.vegetationLoad??=this.vegetationSource().then(gltf=>this.addVegetation(gltf.scene),error=>{this.vegetationLoad=null;throw error;});
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
 spawnFor(asset){const entry=this.byId.get(asset.userData.world2Asset);if(!entry)return null;const names={landing:'respawnLanding',behindTheScene:'respawnBehindTheScene',timeMachine:'respawnTimeMachine'};const name=names[entry.id]??'respawn'+entry.id[0].toUpperCase()+entry.id.slice(1);const source=this.manifest.spawns.find(p=>p.name===name);if(!source)return null;asset.updateWorldMatrix(true,false);const matrix=asset.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(...entry.anchor.map(x=>-x)));const seat=entry.id==='achievements'?plazaArrival(entry.anchor,source.position[1]):source;const p=new THREE.Vector3(...seat.position);p.y+=1.2;p.applyMatrix4(matrix);const f=new THREE.Vector3(Math.cos(seat.rotation),0,-Math.sin(seat.rotation)).transformDirection(matrix);return {name:entry.label,position:p.toArray(),rotation:Math.atan2(-f.z,f.x)};}
 template(entry){
  const node=new THREE.Group();node.name=entry.label;node.userData={world2Asset:entry.id,world2Feature:entry.feature,world2Anchor:entry.anchor,editable_root:true,ground_surface:false,world2Pit:entry.pit?{centre:entry.pit.centre.map((v,i)=>v-entry.anchor[i]),radius:entry.pit.radius}:null,category:entry.category};
  const content=this.canonical(entry);content.position.fromArray(entry.anchor).negate();node.add(content);return node;
 }
}
/** Does a world document name an entry of the vegetation library (`nature:*`)? Those are the only entries that come from
 * vegetation.glb.gz. They are named exactly where `definitionsToRestore` (asset-definitions.js) looks for definitions: an instance
 * reference (`definitionId`, and the saved parts' own data), a saved node state, an experience group, an added object or an
 * instance override (`userData.world2Asset` is the entry, `userData.assetDefinitionId` its definition `world2:<entry>`). */
export function worldNamesVegetation(world){
 const nature=data=>typeof data?.world2Asset==='string'&&data.world2Asset.startsWith('nature:')||typeof data?.assetDefinitionId==='string'&&data.assetDefinitionId.startsWith('world2:nature:');
 const tree=json=>{if(!json)return false;if(nature(json.userData))return true;for(const child of json.children??[])if(tree(child))return true;return false;};
 for(const ref of world?.instanceRefs??[]){if(typeof ref?.definitionId==='string'&&ref.definitionId.startsWith('world2:nature:'))return true;for(const part of ref?.parts??[])if(nature(part?.state?.data))return true;}
 for(const state of Object.values(world?.states??{}))if(nature(state?.data))return true;
 for(const group of world?.experiences?.groups??[])if(nature(group?.data))return true;
 for(const json of world?.added??[])if(tree(json?.object))return true;
 for(const saved of world?.instanceOverrides??[])if(tree(saved?.object?.object))return true;
 return false;
}
/** The vegetation GLB (7.4 MB to inflate and parse, 1.2 MB on the wire) only fills the `nature:*` library entries, which the studio
 * offers and a published world may have placed. The player does not fetch it up front: `loadVegetationFor` (above) gets it once the
 * world document, which the editor waits for anyway, names one of those entries. None of today's data does. */
export async function loadWorld2Catalog(onProgress){const loader=new GLTFLoader(),base='../assets/environment/portfolio/',vegetation=()=>loadCompressedGLB(loader,base+'models/vegetation.glb.gz');const [a,b,data,manifest]=await Promise.all([loadCompressedGLB(loader,base+'models/world.glb.gz',onProgress),PLAYER_MODE?{scene:new THREE.Group()}:vegetation(),fetchEarly(base+'interactions.json').then(r=>r.json()),fetchEarly(base+'world-manifest.json').then(r=>r.json())]);plainCircuitFabric(a.scene);const catalog=new World2Catalog(a.scene,b.scene,data,manifest);if(PLAYER_MODE)catalog.vegetationSource=vegetation;return catalog;}
