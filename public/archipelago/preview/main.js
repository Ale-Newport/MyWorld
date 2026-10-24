import {host} from './runtime/host.js';
import {createProgress,nextFrame,yieldToMain} from './runtime/loading.js';
import {AdaptiveQuality,FramePacer,FRAME_CAP_FPS} from './runtime/quality.js';
import {ShadowRig} from './runtime/shadow-rig.js';
import {StaticFreeze} from './runtime/freeze.js';
import {chunkable,chunkMesh,disposeChunk} from './runtime/terrain-chunks.js';
import {mergeFerrisCabins} from './runtime/ferris-merge.js';
import {assignDepthMaterials,warmShadowPrograms} from './runtime/shadow-warm.js';
import {tickMeadowGrass} from './meadow-grass.js';
import * as THREE from 'three';
import {worldFiles,PLAYER_MODE,startWorldFileDownloads,observeWorldDownloads} from './world-storage.js';
import {fetchEarly} from './early-fetch.js';
import {surfaceMaterialsReady} from './surface-materials.js';
import {upgradeExperienceSurfaces} from './experience-surfaces.js';
import {MapEditor} from './map-editor.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCompressedGLB} from './compressed-gltf.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Physics,RAPIER,hasDisabledCollisionAncestor} from './runtime/physics.js';
import {Driving} from './runtime/driving.js';
import {WorldEditor} from './editor.js';
import {loadWorld2Catalog,plainCircuitFabric} from './world2-catalog.js';
import {updatePrefabTerrain} from './prefab-terrain.js';
import {World2Gameplay,simulationDriver} from './world2-gameplay.js';
import {createTrackFurniture,TrackGameplay} from './track-gameplay.js';
import {waterLevelQuery} from './water-query.js';
import {finishOcean,simplifyOcean} from './ocean.js';
import {curatedLibrary} from './assets/library.js';
import {buildWorldMap,terrainHeight} from './world-map.js';
import {SEA_LEVEL,MAIN_HEIGHT} from './world-config.js';
import {vehicleLibraryEntries} from './runtime/vehicle-assets.js';
import {worldAnimationClips} from './world-animation.js';
import {SceneLightBudget} from './runtime/scene-lights.js';
import {authoredWorldBounds} from './world-bounds.js';
import {validateWorld,createWaterDebug} from './world-validation.js';
import {createRoadDebug,rebuildRoadNetwork} from './roads/road-system.js';
import {upgradePushableProps} from './pushables.js';
import {WorldAtlas,sceneMarkers,MAP_HIDDEN} from './atlas.js';
import {Activities} from './activities.js';
import {Placement,PLACEMENT,REASONS,START_VIEW,centralPlaza,plazaSpawn,softObstacles,framed} from './runtime/placement.js';
import {anchorCandidates,validateAnchors} from './runtime/recovery.js';
import {touchControls} from './touch-controls.js';
import {createHud} from './runtime/hud.js';
import {qaSwitches} from './runtime/qa-switches.js';
import {createAwardsList} from './runtime/awards-list.js';
const $=s=>document.querySelector(s),canvas=$('#world'),viewport=$('#viewport'),keys=new Set();
/** The player's touch HUD while driving (touch-controls.js); null in the studio. */
let touch=null,quality,shadowRig=null,freezer=null,ferris=null,chunked=[];
/** The QA switches (runtime/qa-switches.js): ?shadow=legacy|post, ?fps=uncapped, ?freeze=off|flags, ?ferris=meshes, ?terrain=whole, for A/B against the fitted shadow, the batches and the frozen matrices.
 * They work on localhost and with ?qa; a visitor's link cannot change the engine's mode. */
const {qa:qaHost,legacyShadow,postShadow,uncapped,freezeOff,freezeFlags,ferrisMeshes,terrainWhole}=qaSwitches();
const sunOffset=new THREE.Vector3(-70,130,80);
const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
let loopOriginalMatrix,catalog,gameplay,trackGameplay,simulationContext,sourceClips=[],perspectiveCamera,topCamera,topMode=false,debugOverlay,night=false,sun,skyLight,validationResult,lightBudget;
let mapEditor,mapCamera,edit3DState,atlas;
/** The visitor's HUD (runtime/hud.js): written the frame it changes, never rewritten for nothing. */
const hud=createHud({panel:$('#gameplay-hud'),action:$('#interact-action'),readout:$('#speed')});
/** How many <dialog>s are open, kept from their `open` attribute by one observer: the frame loop reads a number where it used to ask the document for a selector every frame.
 * When a dialog closes the keys go back to the world: a visitor who used the mouse or a finger does not get the opener button back with focus (Enter and Space would press it again), one who used the keyboard keeps their place. */
let dialogsOpen=0;
{const count=()=>{dialogsOpen=document.querySelectorAll('dialog[open]').length;};
 new MutationObserver(records=>{if(records.some(r=>r.target.localName==='dialog'))count();}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});count();
 // Two frames on: a dialog closed with Escape is still the focused element when `close` fires, and the browser has not yet put focus back (or lost it) when the next frame starts.
 if(PLAYER_MODE)document.addEventListener('close',e=>{if(e.target.localName!=='dialog')return;requestAnimationFrame(()=>requestAnimationFrame(()=>{const held=document.activeElement;if(dialogsOpen===0&&!atlas?.isOpen&&(!held||held===document.body||!held.matches(':focus-visible')))canvas.focus({preventScroll:true});}));},true);}
/** The QA probe (runtime/perf-probe.js), only for ?qa&perf. */
let perf=null;const perfWanted=()=>qaSwitches().perf;
let renderer,scene,camera,orbit,root,editor,physics,driving,mixer,nav,mode='edit',simulating=false,editorCamera,simState,accumulator=0,batches=[],hidden=[],ready=false;
function notice(text){$('#notice').textContent=text;$('#notice').classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').classList.remove('show'),3500);}
function ancestor(o,key){for(let p=o;p;p=p.parent)if(p.userData[key])return true;return false;}
/** A physics world built from the edited scene: every visible collision node (World2 prefabs add their own while driving). */
function buildPhysics(){const p=new Physics();p.scene=root;p.waterElevation=nav.seaLevel;p.waterAt=waterLevelQuery(root,nav.seaLevel);root.updateMatrixWorld(true);const nodes=[];root.traverse(o=>{if(!editor.isVisible(o)||!o.userData.collision||ancestor(o,'editorOnly')||ancestor(o,'world2Asset')||hasDisabledCollisionAncestor(o,root))return;let parent=o.parent,owned=false;while(parent&&parent!==root){if(parent.userData.collision)owned=true;if(parent.userData.collision===false&&parent.userData.assetPhysicsEdited)return;parent=parent.parent;}if(!owned||o.userData.assetPhysicsEdited)nodes.push(o);});for(const o of nodes)p.mesh(o);return p;}
function setupPhysics(){createTrackFurniture(root);updatePrefabTerrain(root,!PLAYER_MODE);physics=buildPhysics();return physics;}
function animated(o){for(let p=o;p;p=p.parent)if(p.userData.animated||p.userData.animation||p.userData.assetAnimation?.enabled)return true;return false;}
function refreshAnimations(play=false){const poses=[];root.traverse(n=>poses.push([n,n.position.clone(),n.quaternion.clone(),n.scale.clone()]));mixer?.stopAllAction();mixer?.uncacheRoot(root);for(const [n,p,q,s]of poses){n.position.copy(p);n.quaternion.copy(q);n.scale.copy(s);}editor.animationClips=worldAnimationClips(root,sourceClips);mixer=new THREE.AnimationMixer(root);if(play)editor.animationClips.forEach(a=>mixer.clipAction(a).play());}
/** A batched mesh casts a shadow (the restored props carry no castShadow of their own: this has always been what gave them theirs), except a flat decal lying on the ground: its shadow is the ground it lies on.
 * A thin sheet above the ground (a cap on a post, a sheet a metre up) is no decal: it keeps its shadow. The island's ground is at MAIN_HEIGHT (beaches under it): a sheet that starts
 * within 15 cm of that is on it; one higher up, on a platform, casts as it always did. (Not the terrain query: asking it here costs a rebuild of 0.8 s.) */
const decalBox=new THREE.Box3();
function decal(o){const g=o.geometry;g.boundingBox??g.computeBoundingBox();decalBox.copy(g.boundingBox).applyMatrix4(o.matrixWorld);return decalBox.max.y-decalBox.min.y<.06&&decalBox.min.y<MAIN_HEIGHT+.15;}
function batch(){
 const eligible=[],instanceGroups=new Map(),mergedGroups=new Map();root.updateMatrixWorld(true);
 root.traverse(o=>{if(!o.isMesh||!editor.isVisible(o)||animated(o)||ancestor(o,'world2Asset')||Array.isArray(o.material)||o.userData.terrain||o.userData.unselectable)return;if(!legacyShadow&&(o.userData.mapSurface||o.userData.surfaceDefinition||o.userData.ground_surface))return;for(let p=o;p;p=p.parent)if(p.userData.physics_mode==='DYNAMIC')return;eligible.push(o);const at=o.getWorldPosition(new THREE.Vector3()),cell=Math.floor(at.x/48)+':'+Math.floor(at.z/48),key=o.geometry.uuid+':'+o.material.uuid+':'+cell+(legacyShadow||!decal(o)?'':':n');if(!instanceGroups.has(key))instanceGroups.set(key,[]);instanceGroups.get(key).push(o);});
 const instanced=new Set();for(const group of instanceGroups.values()){if(group.length<3)continue;const m=new THREE.InstancedMesh(group[0].geometry,group[0].material,group.length);group.forEach((o,i)=>{m.setMatrixAt(i,o.matrixWorld);instanced.add(o);hidden.push([o,o.visible]);o.visible=false;o.userData.batched=true;});m.castShadow=legacyShadow||!decal(group[0]);m.receiveShadow=true;m.computeBoundingSphere();scene.add(m);batches.push(m);}
 for(const o of eligible){if(instanced.has(o))continue;const at=o.getWorldPosition(new THREE.Vector3()),key=o.material.uuid+':'+Math.floor(at.x/48)+':'+Math.floor(at.z/48)+(legacyShadow||!decal(o)?'':':n');if(!mergedGroups.has(key))mergedGroups.set(key,[]);mergedGroups.get(key).push(o);}
 for(const objects of mergedGroups.values()){if(objects.length<3)continue;const geometries=objects.map(o=>{let g=o.geometry.clone().applyMatrix4(o.matrixWorld);if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}return g;});const attrs=Object.keys(geometries[0].attributes).filter(k=>geometries.every(g=>g.attributes[k]));for(const g of geometries)for(const k of Object.keys(g.attributes))if(!attrs.includes(k))g.deleteAttribute(k);const geometry=mergeGeometries(geometries,false);if(geometry){const m=new THREE.Mesh(geometry,objects[0].material);m.castShadow=legacyShadow||!decal(objects[0]);m.receiveShadow=true;scene.add(m);batches.push(m);for(const o of objects){hidden.push([o,o.visible]);o.visible=false;o.userData.batched=true;}}geometries.forEach(g=>g.dispose());}
}
/** `userData.batched` marks a mesh hidden only because the drive draws it instanced or merged: it is still there (runtime/placement.js areaOf). */
function unbatch(){batches.forEach(b=>{b.removeFromParent();if(b.isInstancedMesh)b.dispose();else if(b.userData.terrainChunk)disposeChunk(b);else b.geometry.dispose();});batches=[];chunked.forEach(c=>c.restore());chunked=[];hidden.forEach(([o,v])=>{o.visible=v;delete o.userData.batched;});hidden=[];freezer?.release();freezer=null;ferris?.dispose();ferris=null;}
/** performance.measure('archipelago:sub:<name>') around one piece of the drive's set-up, for the QA's cold-start steps. */
function timed(name,fn){const t=performance.now();try{return fn();}finally{try{performance.measure('archipelago:sub:'+name,{start:t});}catch{}}}
/** The coast is one mesh of 135,000 triangles that is in view from everywhere: drawn in pieces (runtime/terrain-chunks.js), the camera only pays for what it sees. The source stays visible and queryable, and draws nothing. */
function chunkTerrain(){
 if(!PLAYER_MODE||terrainWhole)return;
 root.traverse(o=>{if(o.userData.terrain&&!o.userData.sea&&!o.userData.landTile&&editor.isVisible(o)&&chunkable(o)){const c=chunkMesh(o);chunked.push(c);for(const m of c.meshes){scene.add(m);batches.push(m);}}});
}
/** The player's static world stops being recomposed every frame (runtime/freeze.js): everything under the editor's root except what code moves, and the batches. */
function freezeWorld(){
 if(!PLAYER_MODE||freezeOff)return;
 const keep=new Set();
 for(const p of physics.dynamic)if(p.node)keep.add(p.node);
 root.traverse(o=>{const u=o.userData;if(u.physics_mode==='DYNAMIC'||u.pushable||u.animated||u.animation||u.assetAnimation?.enabled||u.sourceAnimations||u.trackAnchor)keep.add(o);});
 for(const clip of editor.animationClips??[])for(const track of clip.tracks){const node=root.getObjectByProperty('uuid',track.name.split('.')[0]);if(node)keep.add(node);}
 for(const node of Object.values(trackGameplay?.furniture??{}))if(node?.isObject3D)keep.add(node);
 freezer=new StaticFreeze();freezer.freeze(scene,root,keep,batches,{cut:!freezeFlags});
}
function resetSimulation(){if(physics){if(gameplay)gameplay.reset();else physics.resetProps();physics.render(1);}mixer?.setTime(0);notice('Simulación restaurada');}
function stopSimulation(){if(!physics)return;activities?.dispose();activities=null;unbatch();trackGameplay?.dispose();trackGameplay=null;gameplay?.dispose();gameplay=null;simulationContext?.dispose();simulationContext=null;hud.clear();driving?.dispose();driving=null;touch=null;physics.destroy();physics=null;mixer.stopAllAction();editor.apply(simState);editor.select(simSelection.map(id=>editor.registry.get(id)).filter(Boolean));editor.dirty=simDirty;editor.updateHistory();mixer.time=0;simulating=false;$('#save').disabled=false;$('#export-glb').disabled=false;$('#simulate').classList.remove('active');}
let simDirty=false,simSelection=[];
function startSimulation(forDrive=false){simState=editor.capture();simSelection=editor.selected.map(o=>o.userData.aw_id);simDirty=editor.dirty;refreshAnimations(true);setupPhysics();if(!forDrive){simulationContext=simulationDriver(physics,orbit.target);gameplay=new World2Gameplay(catalog,scene,root,physics,simulationContext);physics.ticker=simulationContext.ticker;}simulating=true;$('#save').disabled=true;$('#export-glb').disabled=true;$('#simulate').classList.add('active');}
function liveNavigation(){const live=JSON.parse(JSON.stringify(nav)),variant=root.userData.worldVariant;if(variant?.spawn)live.spawn=variant.spawn;live.spawnPinned=!!variant?.spawnPinned&&Array.isArray(variant.spawn);live.spawnHeading=Number(variant?.spawnHeading)||0;live.bounds=authoredWorldBounds(root);live.roads=[];live.prefabSpawns=[];root.updateMatrixWorld(true);root.traverse(o=>{if(!editor.isVisible(o))return;if(o.userData.landmark&&o.userData.worldZone){const zone=live.zones.find(z=>z.id===o.userData.worldZone);if(zone){const p=o.getWorldPosition(new THREE.Vector3());zone.x=p.x;zone.y=-p.z;}}if(o.userData.world2Asset==='circuit'){const zone=live.zones.find(z=>z.id===9),p=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());if(zone){zone.x=p.x;zone.y=-p.z;zone.name='World2 Circuit';}}if(o.userData.world2Asset){const spawn=catalog.spawnFor(o);if(spawn)live.prefabSpawns.push(spawn);}if(o.userData.road_points){const points=editor.roadPoints(o).map(p=>new THREE.Vector3(...p).applyMatrix4(o.matrixWorld));const curve=new THREE.CatmullRomCurve3(points,!!o.userData.road_closed,'catmullrom',.5);live.roads.push({name:o.name.replaceAll('_',' '),width:o.userData.road_width,closed:!!o.userData.road_closed,type:o.userData.road_network||'road',samples:curve.getPoints(points.length*16).map(p=>[p.x,-p.z,p.y])});}if(o.userData.aw_loop&&loopOriginalMatrix){const delta=o.matrixWorld.clone().multiply(loopOriginalMatrix.clone().invert());live.loop.points=nav.loop.points.map(([x,y,z])=>{const p=new THREE.Vector3(x,z,-y).applyMatrix4(delta);return [p.x,-p.z,p.y];});}});return live;}
function enterDrive(){if(!ready||mode==='drive'||editor.assetStudio?.active)return;if(simulating)stopSimulation();const live=liveNavigation();live.playerCarTemplate=editor.assetDefinitions.get('vehicle-player-car')?.node;live.planeTemplate=editor.assetDefinitions.get('vehicle-corsair')?.node;if(root.userData.vehicleColor)live.vehicleColor=root.userData.vehicleColor;let spawnAsset=editor.selected[0];if(spawnAsset?.userData.worldExperience){let feature;spawnAsset.traverse(n=>{if(!feature&&n.userData.world2Asset)feature=n;});spawnAsset=feature??spawnAsset;const entrance=spawnAsset.userData.entrancePoints?.[0];if(entrance){const at=spawnAsset.localToWorld(new THREE.Vector3(...entrance.position));at.y=editor.terrainHeightAt(at.x,at.z)+1.2;live.directSpawn={name:spawnAsset.name,position:at.toArray(),rotation:0};}}if(spawnAsset?.userData.world2Asset)live.directSpawn=catalog.spawnFor(spawnAsset);let selectedRoad=editor.selected[0];while(selectedRoad&&selectedRoad!==root&&selectedRoad.userData.road_network!=='race')selectedRoad=selectedRoad.parent;if(selectedRoad?.userData.road_network==='race'){const track=createTrackFurniture(root);if(track?.road===selectedRoad){const p=track.curve.getPointAt(.015).applyMatrix4(selectedRoad.matrixWorld),t=track.curve.getTangentAt(.015).transformDirection(selectedRoad.matrixWorld);p.addScaledVector(new THREE.Vector3(-t.z,0,t.x),-Math.min(1.8,track.definition.width*.28));p.y+=1.3;live.directSpawn={name:'Catalunya · start',position:p.toArray(),rotation:Math.atan2(-t.z,t.x)};}}if(editor.selected[0]?.userData.landTile){const land=editor.selected[0],a=land.geometry.attributes.position,centre=new THREE.Box3().setFromObject(land).getCenter(new THREE.Vector3());let best=new THREE.Vector3(0,-Infinity,0);for(let i=0;i<a.count;i++){const p=new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(land.matrixWorld);if(p.y>best.y+.01||(Math.abs(p.y-best.y)<.01&&p.distanceToSquared(centre)<best.distanceToSquared(centre)))best=p;}best.y+=1.3;live.directSpawn={name:'Tierra creada',position:best.toArray(),rotation:0};}editorCamera={map:!!mapEditor?.active,camera,topMode,p:camera.position.clone(),q:camera.quaternion.clone(),target:orbit.target.clone(),fov:camera.fov,near:camera.near,far:camera.far,up:camera.up.clone()};if(mapEditor?.active)mapEditor.deactivate();setCamera(perspectiveCamera);camera.near=.1;clearDebug();startSimulation(true);hideDriveAids();driving=new Driving(physics,scene,camera,live,keys,undefined,{root});if(PLAYER_MODE){/* near 0.5 m, not the editor's 0.1: five times the depth precision for the 2.5 cm decals and slabs at distance (far plane 800 m). Nothing is ever that close to a player camera: the chase camera is 12 m or more from the car and View stops 1.2 m short of a wall, the Projects cinematic is 5 m and more from the board, the plane's is 17 m behind it (scripts/qa/world-frame-near.mjs casts a grid of rays in all of them: the nearest surface is 3.5 m). */camera.near=.5;camera.updateProjectionMatrix();}if(PLAYER_MODE)touch=touchControls(driving);camera.layers.enable(MAP_HIDDEN);atlas?.invalidate();gameplay=new World2Gameplay(catalog,scene,root,physics,driving,{map:()=>atlas?.toggle(),help:()=>$('#help-dialog').showModal(),achievements:showAchievements});trackGameplay=new TrackGameplay({root,scene,physics,driving,achievements:gameplay.achievements,onReset:()=>gameplay.reset()});const sourceRespawn=driving.player.onRespawnRequest;driving.player.onRespawnRequest=()=>trackGameplay?.respawn()||sourceRespawn?.();activities=new Activities({root,scene,physics,driving,achievements:gameplay.achievements,tell:tellHost});driving.inputs.events.on('interact',a=>{if(a.active&&!gameplay.instances.some(i=>i.prompts.activeLabel)){if(!activities?.interact())trackGameplay?.interact();}});driving.inputs.events.on('map',a=>{if(a.active)atlas?.toggle();});driving.inputs.events.on('achievements',a=>{if(a.active)showAchievements();});driving.inputs.events.on('help',a=>{if(a.active)$('#help-dialog').showModal();});driving.inputs.events.on('mute',a=>{if(a.active)driving.audio.setMuted(!driving.audio.muted);});
 // Only now does every World2 prop exist in the physics world: the first pose can keep clear of them.
 driving.spawnInitial();driving.events.on('recovered',(reason,pose)=>notice(pose.source==='in place'?'Back on your wheels':'Back on your wheels, nearby'));mode='drive';$('#viewport-label').textContent='CAR · WORLD2 HANDLING';editor.setEnabled(false);orbit.enabled=false;document.body.classList.add('driving');$('#drive').classList.add('active');$('#edit').classList.remove('active');$('#save').disabled=true;$('#export-glb').disabled=true;timed('batch',batch);timed('terrain',chunkTerrain);if(PLAYER_MODE&&!ferrisMeshes)ferris=timed('ferris',()=>mergeFerrisCabins(scene));timed('freeze',freezeWorld);if(shadowRig)timed('depth',()=>assignDepthMaterials(scene));resize();
 // Keyboard focus and the controls notice come when the world can be played: behind the leaves they would go unseen (and the notice would run out).
 host.whenLive(()=>{canvas.focus({preventScroll:true});notice(driving?.inputs.mode==='touch'?'Drag to drive · tap the car to jump':'WASD drive · SPACE jump, hold to raise the wheels · SPACE twice: plane · M map: select a place to travel');});}
function exitDrive(resumeMap=true){if(PLAYER_MODE)return;if(mode!=='drive')return;keys.clear();const savedColor=root.userData.vehicleColor;stopSimulation();if(savedColor){root.userData.vehicleColor=savedColor;editor.dirty=true;}mode='edit';sun.position.set(-90,160,90);sun.target.position.set(0,0,0);sun.target.updateMatrixWorld();$('#viewport-label').textContent='PERSPECTIVE · WORLD OVERVIEW';editor.setEnabled(true);orbit.enabled=true;setCamera(editorCamera.camera);topMode=editorCamera.topMode;camera.position.copy(editorCamera.p);camera.quaternion.copy(editorCamera.q);if(camera.isPerspectiveCamera)camera.fov=editorCamera.fov;camera.near=editorCamera.near;camera.far=editorCamera.far;camera.up.copy(editorCamera.up);orbit.enableRotate=!topMode;$('#viewport-label').textContent=topMode?'TOP VIEW · ORTHOGRAPHIC · NORTH ↑':'PERSPECTIVE · BLUEPRINT WORLD';orbit.target.copy(editorCamera.target);document.body.classList.remove('driving');$('#drive').classList.remove('active');$('#edit').classList.add('active');$('#save').disabled=false;$('#export-glb').disabled=false;resize();if(resumeMap&&editorCamera?.map)mapEditor.activate();refreshDriveAids();}
function enterMapCamera(){if(mode==='drive')exitDrive(false);if(simulating){stopSimulation();editor.setEnabled(true);}if(camera!==mapCamera)edit3DState={camera,topMode,p:camera.position.clone(),q:camera.quaternion.clone(),target:orbit.target.clone(),up:camera.up.clone()};setCamera(mapCamera);topMode=false;mapCamera.up.set(0,0,-1);mapCamera.position.y=700;mapCamera.lookAt(mapCamera.position.x,0,mapCamera.position.z);orbit.enabled=false;orbit.enableRotate=false;}
function enter3DEdit(){if(mode==='drive')exitDrive(false);if(!mapEditor?.active&&camera!==mapCamera)return;mapEditor.deactivate();editor.setEnabled(true);orbit.enabled=true;if(edit3DState){setCamera(edit3DState.camera);camera.position.copy(edit3DState.p);camera.quaternion.copy(edit3DState.q);camera.up.copy(edit3DState.up);orbit.target.copy(edit3DState.target);topMode=edit3DState.topMode;orbit.enableRotate=!topMode;}else overview();$('#edit').classList.add('active');$('#viewport-label').textContent=topMode?'TOP VIEW · ORTHOGRAPHIC · NORTH ↑':'PERSPECTIVE · 3D WORLD EDITOR';editor.select(editor.selected);resize();}
function setCamera(next){camera=next;orbit.object=next;if(editor){editor.camera=next;editor.gizmo.camera=next;}orbit.update();}
function overview(){if(mapEditor?.active){mapEditor.frameWorld();return;}if(mode==='drive'||editor?.assetStudio?.active)return;setCamera(perspectiveCamera);topMode=false;camera.up.set(0,1,0);camera.fov=43;camera.near=1;const bounds=authoredWorldBounds(root),width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ,aspect=viewport.clientWidth/viewport.clientHeight,distance=Math.max(310,width*.61/(Math.tan(43*Math.PI/360)*aspect),depth*.61/Math.tan(43*Math.PI/360));orbit.target.set((bounds.minX+bounds.maxX)/2,0,(bounds.minZ+bounds.maxZ)/2);camera.position.copy(orbit.target).add(new THREE.Vector3(0,distance*.76,distance*.64));camera.lookAt(orbit.target);orbit.enableRotate=true;$('#viewport-label').textContent='PERSPECTIVE · BLUEPRINT WORLD';$('#top-view').classList.remove('active');resize();}
function topView(){if(mode==='drive'||editor?.assetStudio?.active)return;setCamera(topCamera);topMode=true;camera.up.set(0,0,-1);const b=authoredWorldBounds(root);orbit.target.set((b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2);camera.position.set(orbit.target.x,700,orbit.target.z);camera.lookAt(orbit.target);orbit.enableRotate=false;$('#viewport-label').textContent='TOP VIEW · ORTHOGRAPHIC · NORTH ↑';$('#top-view').classList.add('active');resize();}
function resize(){if(!renderer||!camera)return;const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);if(camera===mapCamera){camera.left=-250*w/h;camera.right=250*w/h;camera.top=250;camera.bottom=-250;mapEditor?.invalidate();}else if(camera.isOrthographicCamera){const b=authoredWorldBounds(root),half=Math.max((b.maxZ-b.minZ)/2+10,((b.maxX-b.minX)/2+10)/(w/h));camera.left=-half*w/h;camera.right=half*w/h;camera.top=half;camera.bottom=-half;}else camera.aspect=w/h;camera.updateProjectionMatrix();driving?.measure();}
function clearDebug(){if(debugOverlay){debugOverlay.removeFromParent();debugOverlay.traverse(n=>{n.geometry?.dispose();if(n.material)(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose());});debugOverlay=null;}$('#road-debug').classList.remove('active');$('#water-debug').classList.remove('active');$('#debug-legend').hidden=true;}
function toggleDebug(kind){if(mode==='drive'||editor.assetStudio?.active)return;const active=debugOverlay?.name===(kind==='road'?'Road debug':'Water debug');clearDebug();if(active)return;debugOverlay=kind==='road'?createRoadDebug(root):createWaterDebug(root,{seaLevel:SEA_LEVEL,bounds:authoredWorldBounds(root)});scene.add(debugOverlay);$('#'+kind+'-debug').classList.add('active');$('#debug-legend').hidden=false;$('#debug-legend').textContent=kind==='road'?'Cyan: curve · Yellow: edges · Pink: clearance · Green: collision surface':'Cyan: sea · Turquoise: shallow water · Blue: deep water · Sand: beach · Green: terrain';}
function runValidation(){if(mode==='drive'||editor.assetStudio?.active)return;updatePrefabTerrain(root,true);const session=placementSession();let spawn=null;try{spawn=resolveSpawn(session.placement);}finally{session.dispose();}validationResult=validateWorld(root,{definitions:editor.assetDefinitions,seaLevel:SEA_LEVEL,mainHeight:MAIN_HEIGHT,spawn:spawn?.position?.toArray(),spawnProblem:spawn&&!spawn.valid?REASONS[spawn.reason]??spawn.reason:null,groundHeight:(x,z)=>editor.terrainHeightAt(x,z),beachRegion:{minX:-95,maxX:-20,minZ:90,maxZ:122}});const list=$('#validation-list');list.replaceChildren();$('#validation-summary').textContent=validationResult.summary.errors+' errors · '+validationResult.summary.warnings+' warnings · '+validationResult.counts.objects+' objects';for(const issue of validationResult.issues){const button=document.createElement('button');button.className=issue.severity;button.textContent=issue.severity.toUpperCase()+' · '+issue.object+' — '+issue.message;button.onclick=()=>{const o=root.getObjectByName(issue.object);if(o){$('#validation-dialog').close();editor.select([editor.editRoot(o)]);editor.focus();}};list.append(button);}if(!validationResult.issues.length)list.textContent='World validation passed.';$('#validation-dialog').showModal();}
function toggleNight(){night=!night;skyLight.intensity=night?.34:1.65;sun.intensity=night?.25:2.5;scene.background.set(night?'#102c43':'#458d9d');lightBudget.invalidate();$('#night-view').classList.toggle('active',night);}
/** The Achievements dialog is ready before it is asked for (runtime/awards-list.js): rows built once and kept, the dialog's first layout paid under the loading cover, so opening is a showModal. */
const awards=createAwardsList({dialog:$('#awards-dialog'),list:$('#awards-list')});
function showAchievements(){if(!gameplay)return;awards.sync(gameplay.achievements.view());$('#awards-dialog').showModal();}
function updateGameplay(){if(!gameplay)return;const original=gameplay.hud(),native=trackGameplay?.hud(),act=activities?.hud(),base=native?.activity?{...original,...native}:native?.prompt?{...original,prompt:native.prompt}:original,h=act?.activity&&!native?.activity?{...base,...act,prompt:act.prompt??base.prompt??activities.prompt}:act?.prompt||activities?.prompt?{...base,prompt:base.prompt||activities.prompt}:base;hud.text(h);hud.prompt(h.prompt,driving?.inputs.mode==='touch');}
/** Map pause: the car, the race clock and every activity hold still, and no key
 * held while the map was up is still pressed when it closes — a held SPACE included,
 * and the touch joystick and JUMP button with them. */
function holdControls(){keys.clear();driving?.releaseTouch();driving?.inputs.releaseAll();driving?.releaseHold();touch?.release();accumulator=0;}
/** Ends whatever run is in progress — a race, an activity, an open project board — the way Escape does. */
function endRuns(){if(trackGameplay?.busy)trackGameplay.exit();if(activities?.busy)activities.exit();const active=gameplay?.active();if(active)active.exit();}
/** Travel from the M map: a named place (an experience group, an activity), or any point of the island.
 * runtime/placement.js finds a safe arrival or says why there is none; Driving.place() moves the car,
 * out of the plane if need be, with the camera snapped behind it. A teleport is not driving, so a run in
 * progress ends, as with a respawn. */
function travel(target){
 if(!driving)return {ok:false,message:'Travel is for driving'};
 const arrival=driving.arrival(target.kind==='point'?target:{group:target.group??null,x:target.x,z:target.z,name:target.name});
 if(!arrival.ok)return {ok:false,reason:arrival.reason,message:`Can’t drive there — ${REASONS[arrival.reason]??REASONS.blocked}`};
 endRuns();driving.place(arrival,{reason:'travel'});return {ok:true,name:arrival.name??target.name??null,position:arrival.position.toArray()};
}
/* ---- the studio: the drive spawn and the recovery anchors -------------------------------------
   The world document may pin the drive spawn (worldVariant.spawn in map coordinates [x, north, y],
   spawnHeading for moveTo, spawnPinned: true). Without the pin — older documents included, whose
   unpinned spawn is ignored — /world starts in the Central Plaza (runtime/placement.js). Anchors are
   never stored: they are derived from the scene for each drive, and drawn here on request. */
/** Placement queries outside a drive: a short-lived physics world built from the edited scene the way a
 * test drive builds it. World2 prefabs only collide while driving; the spawn is validated again then. */
function placementSession(){
 if(driving)return {placement:driving.placement,dispose(){}};
 const p=buildPhysics();p.refreshQueries();
 const placement=new Placement({physics:p,root,bounds:authoredWorldBounds(root),seaLevel:nav.seaLevel,soft:softObstacles(root),cameraDirection:()=>new THREE.Vector3(-Math.sin(START_VIEW.theta),0,-Math.cos(START_VIEW.theta)),cameraOffset:()=>new THREE.Vector3().setFromSphericalCoords(1,START_VIEW.phi,START_VIEW.theta)});
 return {placement,dispose:()=>p.destroy()};
}
/** Where DRIVE (nothing selected) and /world start: the pinned spawn when there is one, else the plaza's. */
function resolveSpawn(placement){
 const v=root.userData.worldVariant;
 if(v?.spawnPinned&&Array.isArray(v.spawn)){const at=new THREE.Vector3(v.spawn[0],v.spawn[2],-v.spawn[1]),heading=Number(v.spawnHeading)||0,c=placement.check(at.x,at.z,heading,{dynamicMargin:2});return {...(c.ok?c:{position:at,rotation:heading,heading,x:at.x,z:at.z}),pinned:true,valid:c.ok,reason:c.ok?null:c.reason};}
 const plaza=centralPlaza(root),pose=plaza?plazaSpawn(placement,plaza,{seen:framed}):null;return pose?{...pose,pinned:false,valid:true}:null;
}
function spawnTarget(){const selected=editor.selected.filter(o=>o!==root);if(selected.length){const b=new THREE.Box3();for(const o of selected)b.union(new THREE.Box3().setFromObject(o));const c=b.getCenter(new THREE.Vector3());return {x:c.x,z:c.z,label:selected.map(o=>o.name).join(', ')};}const t=mapEditor?.active?mapCamera.position:orbit.target;return {x:t.x,z:t.z,label:'the centre of the view'};}
/** Studio action: pins the drive spawn at the selection (or the centre of the view), on the nearest valid spot within 10 m. */
function setDriveSpawn(){
 if(mode==='drive'||editor.assetStudio?.active)return;const session=placementSession();
 try{
  const target=spawnTarget(),camera=session.placement.cameraHeading(),pose=session.placement.near(target.x,target.z,{radius:10,step:1,prefer:[{heading:camera,weight:.6}],margin:.6,dynamicMargin:2,maxEdge:4});
  if(!pose){const why=session.placement.check(target.x,target.z,camera,{dynamicMargin:2});notice(`No valid drive spawn within 10 m of ${target.label} (${REASONS[why.reason]??'not a place'}). Choose open, dry, level ground.`);return;}
  editor.mutate(()=>{const v=root.userData.worldVariant??(root.userData.worldVariant={});v.spawn=[+pose.x.toFixed(3),+(-pose.z).toFixed(3),+pose.position.y.toFixed(3)];v.spawnHeading=+pose.heading.toFixed(4);v.spawnPinned=true;});
  notice('Drive spawn pinned here. Save and publish to start /world here; DRIVE with nothing selected starts here now.');
 }finally{session.dispose();}
 refreshDriveAids();
}
function clearDriveSpawn(){const v=root.userData.worldVariant;if(mode==='drive'||!v?.spawnPinned)return;editor.mutate(()=>{delete v.spawnPinned;delete v.spawnHeading;});notice('The drive spawn is the Central Plaza again.');refreshDriveAids();}
let driveAids=null,driveAidsJob=null,driveAidsTimer=0;
function hideDriveAids(){clearTimeout(driveAidsTimer);driveAidsJob?.cancel();driveAidsJob?.session.dispose();driveAidsJob=null;if(driveAids){driveAids.removeFromParent();driveAids.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});driveAids=null;}}
function scheduleDriveAids(){clearTimeout(driveAidsTimer);driveAidsTimer=setTimeout(refreshDriveAids,500);}
function updateDriveSpawnStatus(text){const status=$('#drive-spawn-status');if(!status)return;const v=root.userData.worldVariant;$('#clear-drive-spawn').disabled=!v?.spawnPinned;status.textContent=text??(v?.spawnPinned&&Array.isArray(v.spawn)?`Pinned at x ${v.spawn[0].toFixed(1)}, z ${(-v.spawn[1]).toFixed(1)}.`:'Automatic: the best open spot in the Central Plaza.');}
/** Draws the anchors recovery would use (small cones, by source) and the drive spawn (an arrow), for the edited world. */
function refreshDriveAids(){
 hideDriveAids();updateDriveSpawnStatus();
 if(!$('#show-recovery-anchors')?.checked||mode==='drive'||!ready||editor.assetStudio?.active)return;
 const session=placementSession(),spawn=resolveSpawn(session.placement),candidates=anchorCandidates({root,navigation:liveNavigation(),bounds:authoredWorldBounds(root)});
 updateDriveSpawnStatus('Checking recovery anchors…');
 const job=validateAnchors(session.placement,candidates,{onDone:list=>{session.dispose();driveAidsJob=null;drawDriveAids(list,spawn);updateDriveSpawnStatus(`${spawn?.pinned?(spawn.valid?'Pinned spawn':`The pinned spawn is not a valid place (${REASONS[spawn.reason]}): drives start in the Central Plaza`):'Central Plaza spawn (automatic)'} · ${list.length} recovery anchors.`);}});
 driveAidsJob={cancel:()=>job.cancel(),session};
}
function drawDriveAids(list,spawn){
 const group=new THREE.Group();group.name='Drive spawn and recovery anchors';group.userData.editorOnly=true;
 // Dots of a fixed size on screen, so the whole island's anchors read from the overview as well as up close.
 const colors={entrance:'#f2c14e',prefab:'#e86738',road:'#ded5b6',grid:'#5fd4bd'},c=new THREE.Color(),positions=[],tints=[];
 for(const a of list){positions.push(a.x,a.y+.6,a.z);c.set(colors[a.source]??'#ffffff');tints.push(c.r,c.g,c.b);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));
 const dots=new THREE.Points(geometry,new THREE.PointsMaterial({size:7,sizeAttenuation:false,vertexColors:true,depthTest:false,transparent:true,opacity:.95}));dots.name='Recovery anchors';dots.renderOrder=999;group.add(dots);
 if(spawn?.position){const color=spawn.valid?'#ff5fa2':'#ff3b30',arrow=new THREE.Mesh(new THREE.ConeGeometry(1.6,5,12).rotateZ(-Math.PI/2),new THREE.MeshBasicMaterial({color,depthTest:false}));arrow.position.copy(spawn.position).add(new THREE.Vector3(0,1.4,0));arrow.rotation.y=spawn.heading??spawn.rotation??0;arrow.renderOrder=1000;arrow.name='Drive spawn';group.add(arrow);const ring=new THREE.Mesh(new THREE.RingGeometry(2.6,3.2,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color,depthTest:false,side:THREE.DoubleSide}));ring.position.copy(spawn.position);ring.position.y-=PLACEMENT.rest-.05;ring.renderOrder=1000;group.add(ring);const pin=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(spawn.position.toArray(),3)),new THREE.PointsMaterial({size:14,sizeAttenuation:false,color,depthTest:false}));pin.renderOrder=1001;group.add(pin);}
 group.traverse(n=>{n.layers.set(MAP_HIDDEN);n.userData.editorOnly=true;n.userData.unselectable=true;});scene.add(group);driveAids=group;
}
function bindDriveAids(){
 const set=$('#set-drive-spawn');if(!set)return;set.onclick=setDriveSpawn;$('#clear-drive-spawn').onclick=clearDriveSpawn;$('#show-recovery-anchors').onchange=refreshDriveAids;
 // Anchors follow the edited world: every change, undo, redo and restore re-derives them (debounced).
 editor.onChange(()=>{updateDriveSpawnStatus();if(driveAids||driveAidsJob)scheduleDriveAids();});updateDriveSpawnStatus();
}
function mapPlayer(){if(!driving)return null;const v=driving.mode==='PLANE'?driving.plane.group:null,p=driving.vehicle.position,f=driving.vehicle.forward;return {x:p.x,z:p.z,dx:f.x,dz:f.z,plane:!!v};}
/** Vehicles, prompts and activity overlays are drawn for the driver, not photographed for the map. */
function hideTransientFromMap(){const groups=[driving?.visual.group,driving?.plane.group,driving?.wake,driving?.nipple.group,trackGameplay?.prompts?.group,trackGameplay?.circuit?.group,...(gameplay?.instances??[]).map(i=>i.prompts?.group),...(activities?.groups??[])];for(const g of groups)g?.traverse(o=>o.layers.set(MAP_HIDDEN));}
/** Primary activity prompts become map markers; housekeeping prompts (reset, clear) do not. */
function activityMarkers(){const out=[],p=new THREE.Vector3(),seen=new Set(),add=(prompts,kind='activity')=>{for(const item of prompts?.items??[]){if(item.requestedHidden||item.destroyed||/^(reset|clear|bumpers)/i.test(item.label))continue;item.group.getWorldPosition(p);const key=item.label+Math.round(p.x/8)+':'+Math.round(p.z/8);if(seen.has(key))continue;seen.add(key);out.push({id:'prompt:'+key,kind,name:item.label,x:p.x,z:p.z,priority:2});}};for(const i of gameplay?.instances??[])add(i.prompts);add(trackGameplay?.prompts);for(const a of activities?.markers?.()??[])out.push(a);return out;}
let activities=null;
/* The page hosting this frame (/world, or the admin's studio) is told how far
 * the world has got, and — only once a fully prepared frame has been drawn —
 * that it is ready. Same-origin only. */
export function tellHost(type,extra={}){try{if(parent!==window)parent.postMessage({type,...extra},location.origin);}catch{}}
/** How far the world has got, for the host (src/components/world): bytes while it downloads, the measured share of the CPU work after, one of eight
 * steps at a time (runtime/loading.js). Entering a step waits for a presented frame, so the host's indicator advances before the next long task. */
const progress=createProgress({post:m=>{tellHost('archipelago:progress',m);const el=$('#load-message');if(el)el.textContent=m.stage;},frame:nextFrame,mark:markStep});
const stage=id=>progress.step(id);
let openStep=null;
/** performance.measure('archipelago:<step>') for each step of a start: where the time of a cold start goes. */
function markStep(id){try{if(openStep)performance.measure('archipelago:'+openStep,'archipelago:'+openStep+':start');if(id){performance.mark('archipelago:'+id+':start');}openStep=id;}catch{}}
/** What the first frame waits for from the network, until the responses say how big they are (compressed bytes). */
const SIZE_HINTS={island:5.08e6,catalog:2.55e6,doc:17.2e6,defs:4.3e6};
/** The player's webfont is asked for at once and given 1.5 s at most; the canvas labels are drawn with system fonts, which need no wait. */
function loadFonts(){return document.fonts?Promise.race([Promise.all([document.fonts.load('700 16px Geist'),document.fonts.ready]).catch(()=>{}),new Promise(r=>setTimeout(r,1500))]):Promise.resolve();}
let fontsLoaded=Promise.resolve(),startFrames=()=>{};
/** The adaptive-quality governor ignores the frames of the cover's parting (the GPU is compositing the leaves too): it starts when the host says the leaves have parted. */
function holdQuality(){if(!host.embedded)return;quality.hold();const release=()=>quality?.release();host.whenRevealed(release);host.whenLive(()=>setTimeout(release,4000));}
let renderedFrames=0;const frameWaiters=[];
/** Resolves after `count` more frames were rendered. The frame loop draws nothing while the map or a dialog is open, which would hold this
 * (and `ready`) for ever if one was opened before the first frame: an open one counts as presented. */
function framesRendered(count){const target=renderedFrames+count;return new Promise(resolve=>{const waiter=[target,()=>{clearInterval(guard);resolve();}],guard=setInterval(()=>{if(atlas?.isOpen||dialogsOpen>0)waiter[1]();},100);frameWaiters.push(waiter);});}
/** Ready means nothing left to pop in: the plane, every texture decoded and
 * uploaded (the label canvases held in shader uniforms too), every shader compiled
 * (compile() takes the hidden gameplay materials as well as the visible ones), and
 * real frames drawn with all of it. */
async function presentable(){
 await stage('prepare');
 await Promise.all([driving?.plane.ready,surfaceMaterialsReady(),fontsLoaded]);
 const textures=new Set();scene.traverse(o=>{for(const m of [o.material].flat()){if(!m)continue;for(const v of Object.values(m))if(v?.isTexture)textures.add(v);if(m.uniforms)for(const u of Object.values(m.uniforms))for(const v of [u?.value].flat())if(v?.isTexture)textures.add(v);}});
 await Promise.all([...textures].map(t=>t.image?.decode&&!t.image.complete?t.image.decode().catch(()=>{}):null));
 // Uploaded in slices of 8 ms, with a macrotask between them rather than a frame (this runs under the cover): input and the host keep running.
 let uploadStart=performance.now(),uploaded=0;for(const t of textures){if(t.image)renderer.initTexture(t);progress.inside(++uploaded/textures.size);if(performance.now()-uploadStart>8){await yieldToMain();uploadStart=performance.now();}}
 await stage('compile');
 await renderer.compileAsync(scene,camera);
 // The sun's depth programs, one per kind of caster (runtime/shadow-warm.js): a crate, the explosion's debris, a place the car has not been to would link theirs on a frame.
 if(shadowRig)await warmShadowPrograms({renderer,scene,camera,yieldToMain});
 startFrames();
 await stage('frame');
 await framesRendered(3);
}
/* ---- frame cost ------------------------------------------------------------------------------------------------------------------
   The sun's shadow follows what the camera looks at and is redrawn only when something it shows changed, judged from the poses the frame is about to draw (runtime/shadow-rig.js). Rendering is capped
   to 60 fps or more on touch screens and from the governor's level 1 on: every Nth display refresh, N the largest whole number that keeps 60 (FramePacer: 90 Hz draws every
   refresh, 120 Hz every second one, never a mix of long and short frames; the simulation keeps its own clock). The governor's CPU tier (runtime/quality.js)
   trims scene work. Once the world is ready, idle time pre-pays what would otherwise hitch the first time it is needed. */
const coarsePointer=matchMedia('(pointer: coarse)');
let renderStamp=-1,lastCpu=0,cpuLevel=0;const pacer=new FramePacer();
function frameCap(){return uncapped||!PLAYER_MODE?0:coarsePointer.matches||quality?.level>=1||quality?.cpu>=1?1000/FRAME_CAP_FPS:0;}
// What fitShadow() hands the rig: the frame's scene and time, and the one thing it needs of main.js, the world matrices made current. The render that follows then skips its own pass over
// them (frame() turns matrixWorldAutoUpdate off for it): the matrices the shadow decision read are the matrices drawn, and they are computed once. The night's nearby lights are placed
// first, as lightBudget.render() would, so their matrices are current too.
let matricesCurrent=false;
const shadowFrame={scene:null,now:0,prepare(){lightBudget?.update(night,driving?.vehicle.position??orbit.target,shadowFrame.now);scene.updateMatrixWorld();matricesCurrent=true;}};
function fitShadow(now){
 // Something else drew since this frame loop did (the map's photograph, QA): the shadow map is not ours any more.
 if(renderStamp>=0&&renderer.info.render.frame!==renderStamp)shadowRig.invalidate();
 // A cinematic view (the Projects board) is a few metres from what it shows: the rig fits and judges it differently (shadow-rig.js). (?shadow=post, for A/B: the poses are read after the render, a frame late.)
 const cinematic=driving.view.cinematic.active||driving.view.cinematic.progress>.001;
 shadowFrame.scene=scene;shadowFrame.now=now;
 shadowRig.update(camera,driving.mode==='PLANE'?0:Math.min(driving.vehicle.position.y,8)-1,driving.vehicle.position,cinematic,postShadow?null:shadowFrame);
}
/** The governor's CPU tier. 1: the smallest casters leave the shadow pass and the far grass is hidden. 2: the grass stops swaying and animation beyond 60 m pauses (the sun's shadow is the rig's). */
const cpuMuted=[],cpuGrass=[],cpuActions=[];let cpuTimer=0;
function cpuTier(tier){
 cpuLevel=tier;if(!root||!driving)return;
 if(tier>=1&&!cpuMuted.length){const size=new THREE.Vector3();root.traverse(o=>{if(!o.isMesh||!o.castShadow||!o.visible)return;const g=o.geometry;g.boundingSphere??g.computeBoundingSphere();o.getWorldScale(size);if(g.boundingSphere.radius*2*Math.max(size.x,size.y,size.z)<.5){o.castShadow=false;cpuMuted.push(o);}});}
 else if(tier<1){for(const o of cpuMuted)o.castShadow=true;cpuMuted.length=0;}
 if(tier>=1&&!cpuGrass.length)root.traverse(o=>{if(o.isMesh&&o.userData.meadowGrass){const g=o.geometry;g.boundingSphere??g.computeBoundingSphere();const c=g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);cpuGrass.push({o,x:c.x,z:c.z,r:g.boundingSphere.radius});}});
 else if(tier<1){for(const t of cpuGrass)t.o.visible=true;cpuGrass.length=0;}
 if(tier>=2&&!cpuActions.length&&mixer){const at=new THREE.Vector3();for(const clip of editor.animationClips??[]){const node=root.getObjectByProperty('uuid',clip.tracks[0]?.name.split('.')[0]);if(node){node.getWorldPosition(at);cpuActions.push({action:mixer.clipAction(clip),x:at.x,z:at.z});}}}
 else if(tier<2){for(const a of cpuActions)a.action.paused=false;cpuActions.length=0;}
 shadowRig?.invalidate();clearInterval(cpuTimer);cpuTimer=tier>=1?setInterval(cpuSweep,250):0;
}
function cpuSweep(){
 const car=driving?.vehicle.position;if(!car)return;
 for(const t of cpuGrass)t.o.visible=Math.hypot(t.x-car.x,t.z-car.z)<70+t.r;
 for(const a of cpuActions)a.action.paused=Math.hypot(a.x-car.x,a.z-car.z)>60;
}
/** After `ready`, in idle time: what a first use would otherwise stall on. Lights in `visible` state change every lit shader (three keys programs by their number of point lights), and the first
 * explosion lights one: the 1- and 2-light variants are compiled now, with the lights in the scene only inside each synchronous slice so no frame is drawn with them. The map warms its own render-target shaders. */
function afterReady(){
 const idle=fn=>'requestIdleCallback' in window?requestIdleCallback(fn,{timeout:5000}):setTimeout(fn,1000);
 host.whenLive(()=>setTimeout(()=>idle(()=>{const t0=performance.now();void warmFlash().then(()=>{document.body.dataset.flashWarm=String(Math.round(performance.now()-t0));performance.measure('archipelago:flash-warm',{start:t0});}).catch(e=>console.warn('The explosion shaders could not be warmed.',e));atlas?.prewarm?.();}),1500));
}
async function warmFlash(){
 const reps=[],seen=new Set();
 scene.traverse(o=>{if(!(o.isMesh||o.isPoints||o.isLine||o.isSprite)||!o.material)return;const g=o.geometry?.attributes??{},key=[o.material].flat().map(m=>m.uuid).join()+(o.isInstancedMesh?'i'+(o.instanceColor?'c':''):'')+(g.color?'v'+g.color.itemSize:'')+(g.uv?'u':'')+(g.normal?'':'n')+(o.isPoints?'p':o.isLine?'l':'');if(!seen.has(key)){seen.add(key);reps.push(o);}});
 for(const count of [1,2]){
  // The lights join the scene only inside one synchronous slice (no frame can draw with them): compile() reads the lights the scene has right then.
  const flash=Array.from({length:count},()=>new THREE.PointLight('#ffb066',0,18,2)),programs=new Set();
  for(let i=0;i<reps.length;){await yieldToMain();const t0=performance.now();scene.add(...flash);try{while(i<reps.length&&performance.now()-t0<3.5)for(const material of renderer.compile(reps[i++],camera,scene)){const program=renderer.properties.get(material).currentProgram;if(program)programs.add(program);}}finally{scene.remove(...flash);}}
  while(programs.size){await yieldToMain();for(const program of programs)if(program.isReady()){try{program.getUniforms();}catch{}programs.delete(program);}if(programs.size)await new Promise(r=>setTimeout(r,30));}
 }
}
/** A lost WebGL context (a mobile GPU reclaimed, a driver reset): three rebuilds its state when it comes back; the host is told if it does not. */
function watchContext(){
 let lost=0,timer=0;
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=performance.now();tellHost('archipelago:contextlost');clearTimeout(timer);timer=setTimeout(()=>{if(lost)tellHost('archipelago:error',{message:'The graphics context was lost and did not come back'});},5000);});
 canvas.addEventListener('webglcontextrestored',()=>{lost=0;clearTimeout(timer);shadowRig?.invalidate();quality?.reset();tellHost('archipelago:contextrestored');});
}
async function init(){tellHost('archipelago:hello');observeWorldDownloads((key,loaded,total,done)=>progress.bytes(key,loaded,total,done));fontsLoaded=loadFonts();void stage('load');if(perfWanted()){const {installPerfProbe}=await import('./runtime/perf-probe.js');perf=installPerfProbe({THREE,renderer:()=>renderer,scene:()=>scene,camera:()=>camera,sun:()=>sun,quality:()=>quality,rig:()=>shadowRig,tier:()=>shadowRig?.state()});await perf.ready;}renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});watchContext();renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 scene=new THREE.Scene();scene.background=new THREE.Color('#458d9d');perspectiveCamera=new THREE.PerspectiveCamera(43,1,1,1400);topCamera=new THREE.OrthographicCamera(-160,160,140,-140,.1,1400);mapCamera=new THREE.OrthographicCamera(-250,250,250,-250,.1,1400);mapCamera.up.set(0,0,-1);mapCamera.position.set(0,700,0);mapCamera.lookAt(0,0,0);camera=perspectiveCamera;orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.maxDistance=1200;orbit.minDistance=2;orbit.maxPolarAngle=Math.PI*.49;overview();
 skyLight=new THREE.HemisphereLight(0xe6f4ed,0x727955,1.65);scene.add(skyLight);sun=new THREE.DirectionalLight(0xffe8c5,2.5);sun.position.set(-90,160,90);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-120,right:120,top:110,bottom:-110,near:1,far:420});sun.shadow.bias=-.0003;sun.shadow.normalBias=.08;scene.add(sun);scene.add(sun.target);if(PLAYER_MODE){shadowRig=new ShadowRig({renderer,sun,offset:sunOffset,legacy:legacyShadow});quality=new AdaptiveQuality(renderer,sun,{rig:shadowRig,onCpu:cpuTier});holdQuality();}
 for(const [key,size] of Object.entries(SIZE_HINTS))progress.expect(key,size);
 const [gltf,data,,loadedCatalog,vehicles]=await Promise.all([loadCompressedGLB(new GLTFLoader(),'../exports/AlejandroWorld.glb.gz',e=>progress.bytes('island',e.loaded,e.total,e.done)),fetchEarly('../exports/navigation.json').then(r=>r.json()),RAPIER.init(),loadWorld2Catalog(e=>progress.bytes('catalog',e.loaded,e.total,e.done)),vehicleLibraryEntries(),startWorldFileDownloads()]);sourceClips=gltf.animations;
 await stage('build');catalog=loadedCatalog;const library=curatedLibrary(gltf.scene),built=buildWorldMap(gltf.scene,catalog,library,data,vehicles);root=built.root;nav=built.navigation;finishOcean(root,terrainHeight);const raceFurniture=createTrackFurniture(root);scene.add(root);lightBudget=new SceneLightBudget(scene,root,{dayInterval:PLAYER_MODE?Infinity:500});
 root.traverse(o=>{if(o.isMesh){o.castShadow=!o.userData.unselectable&&!o.userData.terrain;o.receiveShadow=true;for(const material of Array.isArray(o.material)?o.material:[o.material]){material.side=THREE.DoubleSide;if(material.map?.name.includes('palette')){material.map.magFilter=THREE.NearestFilter;material.map.minFilter=THREE.NearestFilter;}}}if(o.userData.runtime_collider)o.visible=false;if(o.isPointLight||o.isSpotLight){o.userData.nightReady=true;o.visible=false;}});
 root.updateMatrixWorld(true);root.traverse(o=>{if(o.userData.aw_loop)loopOriginalMatrix=o.matrixWorld.clone();});editor=new WorldEditor(scene,root,camera,renderer,orbit,notice,catalog);if(PLAYER_MODE)editor.gizmo.enabled=false;editor.assetTemplates=editor.assetTemplates.filter(a=>a.id?.startsWith('world2:')||a.label==='Editable road');editor.addAssetTemplates([...library,...vehicles,...(raceFurniture?['gantry','board','marker'].map(key=>({id:'v4:track-'+key,label:raceFurniture[key].name,category:'Racing',node:raceFurniture[key]})):[])]);await stage('restore');await editor.initializeAssets();await editor.restore();if(PLAYER_MODE)rebuildRoadNetwork(root,{heightAt:(x,z)=>editor.terrainHeightAt(x,z)});if(document.body.classList.contains('studio-admin')){const {installBoardEditor}=await import('./board-editor.js');installBoardEditor(editor);}await stage('place');if(root.userData.worldVariant&&!root.userData.landscapeRevision){const sea=root.children.find(n=>n.userData.sea);if(sea?.geometry.attributes.color){const c=sea.geometry.attributes.color,color=new THREE.Color('#287f94');for(let i=0;i<c.count;i++)c.setXYZ(i,color.r,color.g,color.b);c.needsUpdate=true;}}if(PLAYER_MODE){const sea=simplifyOcean(root),held=sea&&editor.baseline.get(sea.userData.aw_id);if(held)held.geometry=sea.geometry;}const newGroups=!editor.experiences.list().length;editor.experiences.initializeFromWorld();const floorUpgrade=upgradeExperienceSurfaces(editor.experiences),pushUpgrade=upgradePushableProps(root);if(newGroups||floorUpgrade.changed.length||pushUpgrade.length){editor.dirty=true;editor.updateHistory();}const exportWorld=editor.exportGLB.bind(editor);editor.exportGLB=async()=>{if(!editor.enabled||editor.assetStudio?.active)return;refreshAnimations();await exportWorld();};refreshAnimations();updatePrefabTerrain(root,!PLAYER_MODE);overview();new ResizeObserver(()=>{quality?.apply();resize();}).observe(viewport);ready=true;mapEditor=new MapEditor(editor,{camera:mapCamera,activateCamera:enterMapCamera,on3D:enter3DEdit,resize});
 // The saved world may contain material snapshots from before the catalog's
 // plain fabric finish. Apply it to those restored circuit pieces as well.
 plainCircuitFabric(root);
 for(const c of [perspectiveCamera,topCamera,mapCamera])c.layers.enable(MAP_HIDDEN);
 atlas=new WorldAtlas({renderer,scene,root,sun,getPlayer:mapPlayer,getMarkers:()=>sceneMarkers(root,activityMarkers()),onOpen:()=>{shadowRig?.photograph(true);hideTransientFromMap();holdControls();document.body.classList.add('map-open');tellHost('archipelago:event',{event:'map_open'});},onClose:()=>{shadowRig?.photograph(false);holdControls();document.body.classList.remove('map-open');canvas.focus({preventScroll:true});},onTravel:target=>travel(target),canTravel:()=>!!driving});$('#loading').remove();editor.updateHistory();$('#choose-world').textContent='◫ '+worldFiles().name;$('#choose-world').disabled=true;if(!PLAYER_MODE)mapEditor.activate();
 $('#top-view').onclick=topView;$('#world-map').onclick=()=>atlas?.toggle();$('#reference').onclick=()=>$('#reference-panel').classList.toggle('open');$('#close-reference').onclick=()=>$('#reference-panel').classList.remove('open');$('#road-debug').onclick=()=>toggleDebug('road');$('#water-debug').onclick=()=>toggleDebug('water');$('#validate-world').onclick=runValidation;$('#close-validation').onclick=()=>$('#validation-dialog').close();$('#night-view').onclick=toggleNight;
 $('#download-validation').onclick=()=>{if(!validationResult)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(validationResult,null,2)],{type:'application/json'}));a.download='world-validation.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 $('#car-color').oninput=e=>{root.userData.vehicleColor=e.target.value;driving?.setColor(e.target.value);};$('#car-color').value=root.userData.vehicleColor??'#e86738';$('#clean-view').onclick=()=>{document.body.classList.toggle('clean-view');resize();};
 $('#drive').onclick=enterDrive;$('#edit').onclick=enter3DEdit;$('#overview').onclick=overview;$('#simulate').onclick=()=>{if(mode!=='edit')return;if(simulating){stopSimulation();editor.setEnabled(true);}else{startSimulation();editor.setEnabled(false);}};$('#reset-sim').onclick=resetSimulation;
 if(PLAYER_MODE)addEventListener('player-awards',showAchievements);else bindDriveAids();
 $('#close-awards').onclick=()=>$('#awards-dialog').close();$('#interact-action').onclick=()=>{if(touch&&driving?.inputs.mode==='touch')return;gameplay?.interact()||trackGameplay?.interact()||activities?.interact();};$('#help').onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=()=>$('#help-dialog').close();
 // Never negative: the first frame's timestamp can predate `previous` by the whole synchronous boot (measured -1.2 s), which
 // froze the car for that long and blew the chase camera's damping up into a fly-in from under the island.
 let previous=performance.now(),fpsTime=previous,frames=0;function frame(now){requestAnimationFrame(frame);pacer.observe(now);if(!pacer.draw(now,frameCap()))return;perf?.begin(now);const frameStart=performance.now(),elapsed=Math.max(0,now-previous),dt=Math.min(.07,elapsed/1000);previous=now;if(document.hidden||atlas?.isOpen||dialogsOpen>0){quality?.reset();return;}if(document.body.dataset.ready)quality?.sample(elapsed,lastCpu);if(editor.assetStudio?.active){editor.renderAssetStudio(dt);return;}if(simulating){driving?.poll();accumulator+=dt;let steps=0;while(accumulator>=1/60&&steps<5){if(driving)driving.fixed();else physics.step();accumulator-=1/60;steps++;}if(steps===5)accumulator=0;physics.render(accumulator*60);if(!motionQuery.matches)mixer.update(dt);perf?.mark('sim');if(simulationContext){simulationContext.ticker.elapsed+=dt;simulationContext.ticker.delta=dt;simulationContext.ticker.events.trigger('tick');}if(driving){driving.render(dt,accumulator*60);perf?.mark('ticks');if(shadowRig)fitShadow(now);else{const p=driving.vehicle.position;sun.position.copy(p).add(sunOffset);sun.target.position.copy(p);}}}else{if(!mapEditor?.active)orbit.update();if(topMode&&!mapEditor?.active){camera.position.set(orbit.target.x,700,orbit.target.z);camera.lookAt(orbit.target);}}
 tickMeadowGrass(motionQuery.matches||cpuLevel>=2?0:now/1000);mapEditor?.update();perf?.mark('pre-render');const current=matricesCurrent;matricesCurrent=false;if(current)scene.matrixWorldAutoUpdate=false;try{lightBudget.render(renderer,camera,night,driving?.vehicle.position??orbit.target,now);}finally{if(current)scene.matrixWorldAutoUpdate=true;}perf?.mark('render');if(shadowRig){shadowRig.watch(scene,now);renderStamp=renderer.info.render.frame;}freezer?.audit();frames++;renderedFrames++;for(let i=frameWaiters.length-1;i>=0;i--)if(renderedFrames>=frameWaiters[i][0]){frameWaiters[i][1]();frameWaiters.splice(i,1);}if(PLAYER_MODE){updateGameplay();if(driving)hud.speed(driving.vehicle.speedKmh,now);}else if(now-fpsTime>500){$('#performance').textContent=Math.round(frames*1000/(now-fpsTime))+' FPS · '+renderer.info.render.calls+' calls';frames=0;fpsTime=now;if(driving){$('#speed').textContent=String(Math.round(driving.vehicle.speedKmh)).padStart(2,'0');$('#vehicle-mode').textContent=driving.mode;$('#altitude').textContent=driving.mode==='PLANE'?'ALT '+driving.status.altitude.toFixed(1)+' m':driving.status.parked?'PARKED':driving.status.wetness>.03?'SHALLOW WATER':'';$('#viewport-label').textContent=driving.mode==='PLANE'?'PLANE · CORSAIR':'CAR · WORLD2 HANDLING';$('#surface').textContent=driving.mode==='PLANE'?(driving.inputs.mode==='touch'?'HOLD TO STEER':'W/S SPEED · A/D TURN · Q/E PITCH'):driving.loop.active?'LOOP · LOCAL GRIP':driving.vehicle.wheels.items.some(w=>w.groundCollider?.userData.surface_type==='ice')?'ICE · LOW GRIP':driving.nearest().name.toUpperCase();}updateGameplay();}lastCpu=performance.now()-frameStart;perf?.end();}
 // The player draws its first frame only once the car, the plane and every shader are ready (presentable): until then a frame would compile
 // the programs one at a time on this thread, and draw the whole island once for an overview nobody sees.
 startFrames=()=>requestAnimationFrame(frame);if(!PLAYER_MODE)startFrames();
 if(PLAYER_MODE){await fontsLoaded;await stage('drive');enterDrive();if(gameplay)try{awards.warm(gameplay.achievements.view());}catch(e){console.warn('The Achievements dialog could not be warmed.',e);}await presentable();}else await framesRendered(2);
 markStep(null);progress.finish();document.body.dataset.ready='true';tellHost('archipelago:ready');host.ready();if(PLAYER_MODE)afterReady();
}
// Read-only handles for the QA scripts; never exposed on a public host unless asked for with ?qa.
if(qaHost)globalThis.__archipelago={THREE,keys,get scene(){return scene;},get root(){return root;},get camera(){return camera;},get renderer(){return renderer;},get quality(){return quality;},get editor(){return editor;},get physics(){return physics;},get driving(){return driving;},get gameplay(){return gameplay;},get trackGameplay(){return trackGameplay;},get navigation(){return nav;},get mode(){return mode;},get atlas(){return atlas;},get activities(){return activities;},get host(){return host;},get progress(){return progress;},get perf(){return perf;},get shadow(){return shadowRig;},get freezer(){return freezer;},get ferris(){return ferris;}};
/** Typing belongs to the field that has focus, never to the car, the map or the editor shortcuts. */
export function typingInto(e){return e.isComposing||!!e.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');}
addEventListener('keydown',e=>{if(typingInto(e)||$('#help-dialog').open||editor?.assetStudio?.active)return;if(mode==='drive'){if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='Escape'){if(trackGameplay?.busy)trackGameplay.exit();else if(activities?.busy)activities.exit();else if(gameplay?.active())gameplay.active().exit();else exitDrive();}if(e.code==='Tab')atlas?.toggle();}});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>keys.clear());
// The admin's bar around the studio asks for saves (and forced saves after a conflict).
if(!PLAYER_MODE)addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;if(e.data?.type==='archipelago:save')void editor?.save(false,{force:!!e.data.force});});
init().catch(e=>{console.error(e);const m=$('#load-message');if(m)m.textContent='Error: '+e.message;tellHost('archipelago:error',{message:e?.message??String(e)});});
