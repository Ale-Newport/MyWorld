import * as THREE from 'three';
import {assetBounds} from './asset-definitions.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const slug=value=>String(value).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
const pose=node=>({p:node.position.toArray(),q:node.quaternion.toArray(),s:node.scale.toArray()});
const applyPose=(node,state)=>{node.position.fromArray(state.p);node.quaternion.fromArray(state.q);node.scale.fromArray(state.s);};
const parentId=node=>node.parent?.userData.aw_id??null;
const isExperience=node=>!!node?.userData.worldExperience;
const visible=node=>{for(let n=node;n;n=n.parent)if(!n.visible||n.userData.deleted)return false;return true;};
const disabled=node=>{for(let n=node;n;n=n.parent)if(n.userData.deleted)return true;return false;};
const assetName=node=>String(node.userData.assetDefinitionId??node.name).toLowerCase();
const generic=/tree|pine|palm|rock|flower|bush|shrub|planter|bench|street.light|lamp|sign|ground|court|plaza|ring/;

/** Zone centres are only fallbacks. Current landmark bounds/poses and current
 * member positions determine membership; no saved object is reset or replaced. */
const ZONES=[
 ['central-plaza','Central Plaza',1,0,-12,25,25,'⛲',['landing'],/circular-fountain|central pedestrian|plaza limestone|palm-tree|park-bench/],
 ['about-me','About Me',2,13,-34,15,14,'A',[],/about-pavilion/],
 ['projects','Projects',3,66,-30,24,23,'▣',['projects','lab'],/studio-camera|studio-laptop|studio-robot|server-rack|vending-machine|projects limestone/],
 ['achievements','Achievements',4,88,26,19,18,'★',['achievements'],/golden-trophy|achievement trophy/],
 ['career','Career',5,26,39,18,16,'⌘',['career'],/career-studio|studio-laptop|career court/],
 ['contact','Contact',6,88,70,17,16,'✉',['social'],/contact-post-office|contact waterfront/],
 ['bowling','Bowling',7,-90,-28,26,23,'●',['bowling'],/bowling-clubhouse|bowling court/],
 ['cookies','Cookies',8,-94,11,18,17,'◉',['cookie'],/cookie-café|cookie-cafe|cookie café|picnic-table|cookie café terrace/],
 ['f1-circuit','F1 Circuit',9,-194,173,115,100,'⚑',['circuit'],/tire-stack|marshal-booth|timing-screen|pit-equipment|race-camera|catalunya|circuit/],
 ['ice-rink','Ice Rink',10,-31,-87,29,25,'❄',[],/frozen-lake|plastic-penguin|traffic-cone|snow/],
 ['ferris-wheel','Ferris Wheel',11,34,-83,26,25,'☼',[],/ferris-wheel|ticket-booth|popcorn-stand|carnival-light|fairground plaza/],
 ['loop-area','Loop Area',12,110,-64,23,24,'∞',[],/road.loop/],
 ['harbor','Harbor / Port',13,27,97,39,32,'⚓',[],/harbor|pier|dock|mooring|yacht|sailboat|buoy|fuel-pump|rope-coil|fishing-crate|life-ring|boat-ramp/],
 ['beach','Beach',14,-56,104,48,18,'☀',[],/beach-|sunbed|lifeguard|volleyball|kayak|sandcastle/],
 ['lighthouse','Lighthouse',15,-124,54,18,17,'◈',[],/coastal-lighthouse/],
 ['castle','Castle',16,-90,-93,24,23,'♜',[],/northwatch-castle/],
].map(([id,name,zone,x,z,rx,rz,icon,world2,match])=>({id,name,zone,x,z,rx,rz,icon,world2,match}));
const INITIAL_TEMPLATES={
 'ice-rink':'Ice Rink Complete',harbor:'Harbor Complete','ferris-wheel':'Ferris Plaza',projects:'Projects District',
 achievements:'Achievements Plaza',bowling:'Bowling',cookies:'Cookies',castle:'Castle',lighthouse:'Lighthouse Area',beach:'Beach Setup','f1-circuit':'F1 Circuit Complete',
};

export class WorldExperience extends THREE.Group{
 constructor(name='Experience',id='experience:'+THREE.MathUtils.generateUUID()){
  super();this.name=name;this.isWorldExperience=true;
  this.userData={worldExperience:true,experienceVersion:1,experienceId:id.replace(/^experience:/,''),aw_id:id,editable_root:true,added:true,category:'Experiences',layer:'Experiences',collision:false,recommendedClearance:3,entrancePoints:[]};
 }
}

/** Scene grouping/persistence service. The editor owns history transactions;
 * call mutations inside editor.mutate(), or startChange()/endChange(). */
export class ExperienceManager{
 constructor(editor){this.editor=editor;this.root=editor.root;this.groups=new Map();this.templates=new Map((this.root.userData.experienceTemplates??[]).map(t=>[t.id,copy(t)]));this.root.userData.experienceTemplates??=[];this.templateSources=new Map();this.managed=new Set();this.initializationReport=[];this.root.traverse(n=>{if(isExperience(n))this.groups.set(n.userData.aw_id,n);if(isExperience(n.parent))this.managed.add(n.userData.aw_id);});}
 list({includeDeleted=false}={}){return [...this.groups.values()].filter(g=>includeDeleted||!g.userData.deleted);}
 findFor(object){for(let n=object;n&&n!==this.root;n=n.parent)if(isExperience(n))return n;return null;}
 get(id){return this.groups.get(id)??this.list().find(g=>g.userData.experienceId===id||g.name===id);}
 isLocked(object){for(let n=object;n&&n!==this.root;n=n.parent)if(n.userData.locked||n.userData.assetLocked)return true;return false;}
 register(node,{fresh=false,assetRoot=false}={}){
  node.traverse(n=>{if(n.userData.proceduralDerived){delete n.userData.aw_id;return;}if(fresh||!n.userData.aw_id)n.userData.aw_id='user:'+THREE.MathUtils.generateUUID();if(fresh){delete n.userData.added;delete n.userData.experienceOwner;}this.editor.registry.set(n.userData.aw_id,n);this.editor.baseline?.set(n.userData.aw_id,{geometry:n.geometry,material:n.material});});
  if(assetRoot)node.userData.added=true;return node;
 }
 eligible(node,{allowRoads=false,allowTerrain=false}={}){return node&&node!==this.root&&!disabled(node)&&!node.userData.editorOnly&&!node.userData.sea&&!node.userData.unselectable&&(!node.userData.terrain||allowTerrain)&&(!node.userData.road_points||allowRoads||node.userData.road_network==='race');}
 create(nodes,name='Experience',options={}){
  const unique=[...new Set(nodes)].filter(n=>this.eligible(n,options)),chosen=new Set(unique),members=unique.filter(n=>{for(let p=n.parent;p&&p!==this.root;p=p.parent)if(chosen.has(p))return false;return true;});
  if(!options.allowEmpty&&!members.length)throw Error('Select at least one object to create an Experience.');
  if(!options.allowLocked&&members.some(n=>this.isLocked(n)))throw Error('Unlock the selected objects before grouping them.');
  const id=options.id??'experience:'+THREE.MathUtils.generateUUID();if(this.groups.has(id))throw Error('Experience already exists: '+id);
  const group=new WorldExperience(name,id),bounds=new THREE.Box3();this.root.updateMatrixWorld(true);for(const node of members)bounds.union(assetBounds(node));
  const worldCentre=options.position?new THREE.Vector3(...options.position):bounds.isEmpty()?new THREE.Vector3():bounds.getCenter(new THREE.Vector3());worldCentre.y=options.groundHeight??this.root.userData.mainHeight??.15;
  group.position.copy(this.root.worldToLocal(worldCentre));Object.assign(group.userData,{icon:options.icon??'◇',worldZone:options.zone??null,recommendedClearance:options.clearance??3,scaleLocked:options.scaleLocked??true});this.root.add(group);this.register(group);this.groups.set(id,group);
  for(const node of members){this.managed.add(node.userData.aw_id);group.attach(node);}this.root.updateMatrixWorld(true);this.updateEntrance(group);return group;
 }
 ungroup(group){group=this.get(group)||group;if(!isExperience(group))return [];if(this.isLocked(group))throw Error('Unlock the Experience before ungrouping it.');const parent=group.parent??this.root,members=[...group.children];for(const node of members){parent.attach(node);this.managed.add(node.userData.aw_id);}group.visible=false;group.userData.deleted=true;return members;}
 remove(group){group=this.get(group)||group;if(!isExperience(group))return;if(this.isLocked(group))throw Error('Unlock the Experience before deleting it.');group.visible=false;group.userData.deleted=true;}
 setLocked(group,value){group=this.get(group)||group;group.userData.locked=!!value;return group;}
 setVisible(group,value){group=this.get(group)||group;group.visible=!!value;return group;}
 duplicate(group,{offset=[8,0,8],name}={}){
  group=this.get(group)||group;if(!isExperience(group))throw Error('Select an Experience to duplicate.');const result=group.clone(true);result.name=name??group.name+' copy';result.userData.aw_id='experience:'+THREE.MathUtils.generateUUID();result.userData.experienceId=result.userData.aw_id.slice(11);result.userData.locked=false;delete result.userData.deleted;result.visible=true;
  this.root.add(result);group.updateWorldMatrix(true,true);const world=group.matrixWorld.clone();world.elements[12]+=offset[0];world.elements[13]+=offset[1];world.elements[14]+=offset[2];this.root.matrixWorld.clone().invert().multiply(world).decompose(result.position,result.quaternion,result.scale);
  const rootId=result.userData.aw_id;this.register(result,{fresh:true});result.userData.aw_id=rootId;result.userData.added=true;this.editor.registry.set(rootId,result);this.editor.baseline?.set(rootId,{geometry:result.geometry,material:result.material});for(const [id,node]of this.editor.registry)if(node===result&&id!==rootId){this.editor.registry.delete(id);this.editor.baseline?.delete(id);}
  result.traverse(n=>{if(isExperience(n)){if(n!==result){n.userData.experienceId=n.userData.aw_id;n.userData.added=true;}this.groups.set(n.userData.aw_id,n);}if(n.parent&&isExperience(n.parent)&&!isExperience(n)){n.userData.added=true;this.managed.add(n.userData.aw_id);}});this.root.updateMatrixWorld(true);return result;
 }
 updateEntrance(group){
  const bounds=assetBounds(group),centre=bounds.getCenter(new THREE.Vector3());let nearest=null,best=Infinity;this.root.traverse(n=>{if(!n.userData.road_points||n.userData.road_network==='race'||!visible(n)||this.findFor(n)===group)return;const raw=typeof n.userData.road_points==='string'?JSON.parse(n.userData.road_points):n.userData.road_points;for(const p of raw){const v=new THREE.Vector3(...p).applyMatrix4(n.matrixWorld),distance=(v.x-centre.x)**2+(v.z-centre.z)**2;if(distance<best){best=distance;nearest=v;}}});
  const direction=nearest?nearest.clone().sub(centre):new THREE.Vector3(0,0,1);direction.y=0;if(direction.lengthSq()<1e-8)direction.z=1;direction.normalize();const half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5),distance=Math.min(Math.abs(direction.x)>1e-5?half.x/Math.abs(direction.x):Infinity,Math.abs(direction.z)>1e-5?half.z/Math.abs(direction.z):Infinity),at=centre.clone().addScaledVector(direction,Number.isFinite(distance)?distance:0);at.y=group.getWorldPosition(new THREE.Vector3()).y;group.updateWorldMatrix(true,false);const inverse=group.matrixWorld.clone().invert();group.userData.entrancePoints=[{name:'Main entrance',position:at.applyMatrix4(inverse).toArray(),direction:direction.transformDirection(inverse).toArray(),kind:'path'}];return group.userData.entrancePoints;
 }
 initializeFromWorld({templates=true}={}){
  if(this.list({includeDeleted:true}).length){if(templates)for(const [slug,name]of Object.entries(INITIAL_TEMPLATES)){const group=this.get(slug),id='experience-template:'+slug;if(group&&!group.userData.deleted&&!this.templates.has(id))this.saveTemplate(group,name,{id});}this.syncTemplateState();return this.list();}const candidates=this.root.children.filter(n=>this.eligible(n)),bounds=new Map(candidates.map(n=>[n,assetBounds(n)])),centres=new Map([...bounds].map(([n,b])=>[n,b.getCenter(new THREE.Vector3())]));
  const specs=ZONES.map(spec=>({...spec,members:[],centre:new THREE.Vector3(spec.x,0,spec.z)})),assigned=new Map();
  for(const spec of specs){const seeds=candidates.filter(n=>n.userData.worldZone===spec.zone||spec.world2.includes(n.userData.world2Asset));for(const node of seeds){assigned.set(node,spec);spec.members.push(node);}const landmark=seeds.find(n=>n.userData.worldZone===spec.zone)??seeds[0];if(landmark){const p=landmark.userData.aw_loop?centres.get(landmark):landmark.getWorldPosition(new THREE.Vector3());spec.centre.set(p.x,0,p.z);}if(spec.id==='f1-circuit'&&seeds[0]){const b=bounds.get(seeds[0]);spec.centre.copy(b.getCenter(new THREE.Vector3()));spec.rx=b.getSize(new THREE.Vector3()).x/2+8;spec.rz=b.getSize(new THREE.Vector3()).z/2+8;}}
  // The edited harbor spans the building, moved piers and moored boats. Measure
  // their current positions instead of assuming the original zone rectangle.
  const harbor=specs.find(s=>s.id==='harbor'),marine=candidates.filter(n=>/harbor|pier|dock|mooring|yacht|sailboat|buoy|fuel-pump|rope-coil|fishing-crate|life-ring|boat-ramp/.test(assetName(n))&&centres.get(n).distanceTo(new THREE.Vector3(27,0,97))<75);if(marine.length){const b=new THREE.Box3();marine.forEach(n=>b.union(bounds.get(n)));harbor.centre.copy(b.getCenter(new THREE.Vector3()));harbor.rx=Math.max(30,b.getSize(new THREE.Vector3()).x/2+7);harbor.rz=Math.max(28,b.getSize(new THREE.Vector3()).z/2+7);}
  for(const node of candidates){if(assigned.has(node))continue;if(node.userData.worldZone&&node.userData.worldZone>16)continue;if(node.userData.world2Asset)continue;const at=centres.get(node),name=assetName(node);let winner=null,score=Infinity;
   for(const spec of specs){const distance=((at.x-spec.centre.x)/spec.rx)**2+((at.z-spec.centre.z)/spec.rz)**2;if(distance>1.15**2)continue;const semantic=spec.match.test(name)||(spec.id==='harbor'&&/wooden-bridge-medium/.test(name));if(!semantic&&!generic.test(name))continue;if(node.userData.road_points&&(spec.id!=='f1-circuit'||node.userData.road_network!=='race'))continue;const rank=distance+(semantic?0:1);if(rank<score){score=rank;winner=spec;}}
   if(winner){winner.members.push(node);assigned.set(node,winner);}
  }
  for(const spec of specs){const group=this.create(spec.members,spec.name,{id:'experience:'+spec.id,zone:spec.zone,icon:spec.icon,position:spec.centre.toArray(),allowEmpty:true,allowLocked:true,clearance:spec.id==='f1-circuit'?8:spec.id==='ferris-wheel'?6:spec.id==='harbor'?5:3});group.userData.initialExperience=true;this.initializationReport.push({id:group.userData.aw_id,name:group.name,memberIds:group.children.map(n=>n.userData.aw_id),bounds:{min:assetBounds(group).min.toArray(),max:assetBounds(group).max.toArray()}});if(templates&&INITIAL_TEMPLATES[spec.id])this.saveTemplate(group,INITIAL_TEMPLATES[spec.id],{id:'experience-template:'+spec.id});}
  return this.list();
 }
 captureParents(states){for(const [id,node]of this.editor.registry)if(states[id])states[id].parentId=parentId(node);const rootState=states[this.root.userData.aw_id];if(rootState)rootState.data.experienceTemplates??=[...this.templates.values()].map(copy);return states;}
 applyParentLinks(states){
  const savedTemplates=states[this.root.userData.aw_id]?.data?.experienceTemplates;if(Array.isArray(savedTemplates)){this.templates=new Map(savedTemplates.map(t=>[t.id,copy(t)]));this.templateSources.clear();}
  for(const [id,state]of Object.entries(states)){if(state.data?.worldExperience&&!this.editor.registry.has(id)){const group=new WorldExperience(state.name,id);this.root.add(group);this.register(group);this.groups.set(id,group);}}
  for(const group of this.groups.values())if(!states[group.userData.aw_id]){group.visible=false;group.userData.deleted=true;}
  for(const [id,state]of Object.entries(states)){if(!('parentId'in state))continue;const node=this.editor.registry.get(id),parent=(state.parentId?this.editor.registry.get(state.parentId):null)??this.root;if(!node||node===this.root||node===parent)continue;let cycle=false;for(let p=parent;p;p=p.parent)if(p===node)cycle=true;if(cycle)continue;if(node.parent!==parent)parent.add(node);if(isExperience(parent))this.managed.add(id);}
 }
 document(){
  const groups=this.list({includeDeleted:true}).map(g=>({id:g.userData.aw_id,name:g.name,parentId:parentId(g),...pose(g),visible:g.visible,data:copy(g.userData)}));
  const parentLinks=[...this.managed].map(id=>this.editor.registry.get(id)).filter(Boolean).map(n=>({id:n.userData.aw_id,parentId:parentId(n),...pose(n)}));
  return {schema:1,groups,parentLinks,templates:[...this.templates.values()].map(copy)};
 }
 restore(document){
  if(!document||document.schema!==1)return false;
  for(const state of document.groups??[]){let group=this.editor.registry.get(state.id);if(!group){group=new WorldExperience(state.name,state.id);this.root.add(group);this.register(group);}group.name=state.name;group.userData=copy(state.data);group.visible=state.visible;applyPose(group,state);this.groups.set(state.id,group);}
  for(const link of [...(document.groups??[]),...(document.parentLinks??[])]){const node=this.editor.registry.get(link.id),parent=this.editor.registry.get(link.parentId)??this.root;if(!node||node===parent)continue;if(node.parent!==parent)parent.add(node);applyPose(node,link);if(!isExperience(node))this.managed.add(link.id);}
  this.templates=new Map((document.templates??[]).map(t=>[t.id,copy(t)]));this.templateSources.clear();this.syncTemplateState();this.root.updateMatrixWorld(true);return true;
 }
 syncTemplateState(){this.root.userData.experienceTemplates=[...this.templates.values()].map(copy);}
 /** Archive only definitions actually referenced by templates, immediately
  * before Asset Studio replaces that version. Assets keep shared resources. */
 preserveDefinitionVersion(id){
  const definition=this.editor.assetDefinitions?.get(id);if(!definition)return null;const members=[...this.templates.values()].flatMap(t=>t.members).filter(m=>m.definitionId===id&&(m.definitionVersion??definition.version)===definition.version);if(!members.length)return null;
  const archive=this.editor.assetDefinitions.add({id:'experience-version:'+id+':'+definition.version,label:definition.name+' · template version '+definition.version,category:'Experience parts',node:definition.node,source:definition.source});this.editor.assetDefinitions.modified.add(archive.id);
  for(const member of members){member.sourceDefinitionId??=id;member.definitionId=archive.id;member.definitionVersion=archive.version;}this.syncTemplateState();return archive;
 }
 saveTemplate(group,name,{id='experience-template:'+THREE.MathUtils.generateUUID()}={}){
  group=this.get(group)||group;if(!isExperience(group))throw Error('Select an Experience to save as a template.');const members=[];
  for(const node of group.children){if(node.userData.deleted)continue;let definitionId=node.userData.assetDefinitionId,edited=!!node.userData.assetInstanceOverride;node.traverse(n=>{if(n.userData.geometryEdited||n.userData.materialEdited||n.userData.assetPartEdited||n.userData.assetParentEdited)edited=true;});if((!definitionId||edited)&&this.editor.assetDefinitions){const d=this.editor.assetDefinitions.add({id:'experience-part:'+THREE.MathUtils.generateUUID(),label:node.name,category:'Experience parts',node,source:'HelloWorld authored Experience part'});definitionId=d.id;this.editor.assetDefinitions.modified.add(d.id);}
   const parts=[];const walk=(n,path=[])=>{parts.push({path,name:n.name,...pose(n),visible:n.visible,data:copy(n.userData)});n.children.forEach((child,i)=>walk(child,[...path,i]));};walk(node);
   const member={sourceId:node.userData.aw_id,definitionId:definitionId??null,definitionVersion:this.editor.assetDefinitions?.get(definitionId)?.version??null,name:node.name,...pose(node),parts};members.push(member);this.templateSources.set(id+':'+members.length,node.clone(true));
  }
  const template={id,name:name??group.name,icon:group.userData.icon??'◇',recommendedClearance:group.userData.recommendedClearance??3,entrancePoints:copy(group.userData.entrancePoints??[]),scaleLocked:group.userData.scaleLocked!==false,members};this.templates.set(id,template);this.syncTemplateState();return template;
 }
 previewTemplate(id){
  const template=typeof id==='string'?this.templates.get(id):id;if(!template)throw Error('Experience template not found.');const group=new WorldExperience(template.name);group.userData={...group.userData,icon:template.icon,recommendedClearance:template.recommendedClearance,entrancePoints:copy(template.entrancePoints),scaleLocked:template.scaleLocked,templateId:template.id};
  for(const [i,member]of template.members.entries()){const source=this.templateSources.get(template.id+':'+(i+1))??this.editor.assetDefinitions?.get(member.definitionId)?.node??this.editor.registry.get(member.sourceId);if(!source)throw Error('Missing template asset: '+member.name);const node=source.clone(true);for(const part of member.parts??[]){let n=node;for(const index of part.path)n=n?.children[index];if(!n)continue;n.name=part.name;applyPose(n,part);n.visible=part.visible;n.userData=copy(part.data);}applyPose(node,member);if(member.definitionId){node.userData.assetDefinitionId=member.definitionId;node.userData.assetDefinitionVersion=member.definitionVersion??1;}group.add(node);}group.updateMatrixWorld(true);return group;
 }
 placeTemplate(id,position,{name}={}){
  const group=this.previewTemplate(id);if(name)group.name=name;const rootId=group.userData.aw_id;this.register(group,{fresh:true});this.editor.registry.delete(group.userData.aw_id);this.editor.baseline?.delete(group.userData.aw_id);group.userData.aw_id=rootId;group.userData.added=true;this.editor.registry.set(rootId,group);this.editor.baseline?.set(rootId,{geometry:group.geometry,material:group.material});this.root.add(group);group.traverse(n=>{if(isExperience(n))this.groups.set(n.userData.aw_id,n);if(n.parent&&isExperience(n.parent)&&!isExperience(n)){n.userData.added=true;this.managed.add(n.userData.aw_id);}});const at=position?.isVector3?position:new THREE.Vector3(...(position??[0,this.root.userData.mainHeight??.15,0]));group.position.copy(this.root.worldToLocal(at.clone()));this.root.updateMatrixWorld(true);return group;
 }
}
