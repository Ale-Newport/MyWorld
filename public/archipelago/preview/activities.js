import * as THREE from 'three';
import {Prompts} from './portfolio/world2/interactions/Prompts.js';
import {Bin} from './portfolio/world/core/Disposal.js';
import {Tweens} from './portfolio/world/core/Tween.js';
import {resetPushables} from './pushables.js';
import {MAP_HIDDEN} from './atlas.js';

/* ============================================================
   ACTIVITIES BUILT FROM THE WORLD'S OWN GROUPS

   An activity is an experience group in the world document whose
   data carries `activity: { type, … }`. Everything it needs is in
   that group and read from the scene when it starts — the cones
   of a slalom are the cones placed in the editor, the pen of the
   round-up is wherever the group stands — so moving or editing the
   group in the admin's world editor moves and edits the activity.
   Nothing here holds a coordinate of its own.

   Every activity has: a prompt to begin (Enter / the touch
   button), a countdown, live feedback (in the scene and on the
   HUD, with the world's sounds), a result, and a way to go again.
   Escape, a respawn or driving away ends a run. The map pauses
   them with everything else: their clocks advance on the drive
   ticker, which stops while the map is open.

   Slalom   — a timed run through cone gates between a start and a
              finish line. A missed gate costs 3 s, a knocked cone 1 s
              (cones are light rigid bodies: hitting one moves it).
   Round-up — push the lake's penguins into the pen on the ice
              before the clock runs out.
   ============================================================ */

const visible=node=>{for(let n=node;n;n=n.parent)if(!n.visible||n.userData.deleted)return false;return true;};
const flat=(v)=>new THREE.Vector2(v.x,v.z);
const world=(node)=>node.getWorldPosition(new THREE.Vector3());
const fmt=(s)=>s<60?`${s.toFixed(2)} s`:`${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,'0')}`;
const STORE='archipelago-activities-v1';
function readBest(){try{return JSON.parse(localStorage.getItem(STORE)??'{}')??{};}catch{return {};}}
function writeBest(key,value){try{const all=readBest();all[key]=value;localStorage.setItem(STORE,JSON.stringify(all));}catch{/* private mode: the run still counts, it is just not remembered */}}

/** Does segment a→b cross segment c→d (all in the ground plane)? */
function crosses(a,b,c,d){
 const o=(p,q,r)=>Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));
 return o(a,b,c)!==o(a,b,d)&&o(c,d,a)!==o(c,d,b);
}

/** The groups that declare an activity, in the scene as it stands. */
export function activityGroups(root){const out=[];root.traverse(n=>{if(n.userData.worldExperience&&n.userData.activity?.type&&visible(n))out.push(n);});return out;}

/* ---- shared visuals ------------------------------------------------- */
const COLORS={idle:new THREE.Color('#f3ede2'),next:new THREE.Color('#ff7a3d'),ok:new THREE.Color('#38d27a'),bad:new THREE.Color('#ff4d4d'),warn:new THREE.Color('#ffc14d')};
function stripMaterial(color,opacity=.55){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2});}
function checkerTexture(){const c=document.createElement('canvas');c.width=64;c.height=16;const g=c.getContext('2d');for(let x=0;x<16;x++)for(let y=0;y<4;y++){g.fillStyle=(x+y)%2?'#151515':'#f5f5f0';g.fillRect(x*4,y*4,4,4);}const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.colorSpace=THREE.SRGBColorSpace;return t;}
/** Height of the ground (or ice) under a point, from the scene's meshes. */
function groundY(root,x,z,fallback){const ray=new THREE.Raycaster(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0),0,400);const hits=ray.intersectObject(root,true).filter(h=>h.object.isMesh&&visible(h.object)&&(h.object.userData.terrain||h.object.userData.ground_surface||h.object.userData.surface_type||h.object.userData.landTile||/terrain|ground|ice|lake|grass/i.test(h.object.name)));return hits[0]?.point.y??fallback;}

/** A small board drawn on a canvas, for in-world timing screens. */
class Board{
 constructor(width=512,height=256){this.canvas=document.createElement('canvas');this.canvas.width=width;this.canvas.height=height;this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;this.material=new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false});}
 draw(title,rows){const g=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;g.fillStyle='#14120f';g.fillRect(0,0,w,h);g.fillStyle='#ff7a3d';g.font='700 34px system-ui, sans-serif';g.textBaseline='top';g.fillText(title.toUpperCase(),26,22);g.fillStyle='#f3ede2';rows.forEach(([k,v],i)=>{const y=86+i*52;g.font='500 26px ui-monospace, monospace';g.fillStyle='#a8a091';g.fillText(k,26,y);g.font='700 34px ui-monospace, monospace';g.fillStyle='#f3ede2';const tw=g.measureText(v).width;g.fillText(v,w-26-tw,y-4);});this.texture.needsUpdate=true;}
 dispose(){this.texture.dispose();this.material.dispose();}
}

/** Puts a board on both faces of a screen-like node (its orientation is the editor's to choose). */
function mountBoard(node,board,overlay){
 node.updateWorldMatrix(true,true);const inverse=node.matrixWorld.clone().invert(),box=new THREE.Box3(),v=new THREE.Vector3();
 node.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;const m=new THREE.Matrix4().multiplyMatrices(inverse,n.matrixWorld);for(let i=0;i<a.count;i+=Math.max(1,Math.floor(a.count/400)))box.expandByPoint(v.fromBufferAttribute(a,i).applyMatrix4(m));});
 if(box.isEmpty())return [];const size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
 const thin=size.z<=size.x?'z':'x',width=(thin==='z'?size.x:size.z)*.86,height=Math.min(size.y*.42,width*.5);
 const planes=[];for(const side of [1,-1]){const plane=new THREE.Mesh(new THREE.PlaneGeometry(width,height),board.material);const local=centre.clone();local.y=box.max.y-height*.62-size.y*.04;if(thin==='z'){local.z=side>0?box.max.z+.02:box.min.z-.02;plane.rotation.y=side>0?0:Math.PI;}else{local.x=side>0?box.max.x+.02:box.min.x-.02;plane.rotation.y=side>0?Math.PI/2:-Math.PI/2;}plane.position.copy(local);node.add(plane);Object.assign(plane.userData,{activityOverlay:true,unselectable:true});plane.layers.set(MAP_HIDDEN);planes.push(plane);}
 return planes;
}

/* ---- the base: prompt, countdown, run, result -------------------------- */
class Activity{
 constructor(ctx,group){this.ctx=ctx;this.group=group;this.spec=group.userData.activity;this.state='idle';this.result=null;this.countdown=0;this.elapsed=0;this.notice=null;this.noticeUntil=0;}
 get running(){return this.state==='countdown'||this.state==='armed'||this.state==='running';}
 get key(){return `${this.spec.type}:${this.group.userData.aw_id??this.group.name}`;}
 get best(){return readBest()[this.key]??null;}
 say(text,seconds=2.2,tone='info'){this.notice={text,tone};this.noticeUntil=this.ctx.driving.ticker.elapsed+seconds;}
 play(sound,pitch){try{this.ctx.driving.audio?.play?.(sound,pitch);}catch{/* sound is optional */}}
 tell(action,extra={}){this.ctx.tell?.('archipelago:event',{event:'world_activity',name:this.spec.type,action,...extra});}
 begin(){if(this.running)return;this.prepare();this.state='countdown';this.countdown=3;this.beat=3;this.ctx.prompts.setSuspended(true);this.ctx.driving.player.setState?.('locked');this.play('note',.7);this.tell('start');}
 tick(dt){
  if(this.state==='countdown'){this.countdown-=dt;const beat=Math.ceil(this.countdown);if(beat!==this.beat&&beat>0){this.beat=beat;this.play('note',.7+(4-beat)*.1);}if(this.countdown<=0){this.state=this.armedState??'running';this.elapsed=0;this.ctx.driving.player.setState?.('default');this.play('note',1.6);this.go?.();}return;}
  if(this.state==='armed'||this.state==='running'){if(this.state==='running')this.elapsed+=dt;this.step(dt);if(this.running&&this.tooFar()){this.stop('left');}}
 }
 stop(reason){if(!this.running)return;const wasCountdown=this.state==='countdown';this.state='idle';this.ctx.prompts.setSuspended(false);if(wasCountdown)this.ctx.driving.player.setState?.('default');this.say(reason==='left'?`${this.spec.name ?? 'Activity'} abandoned — you left the area`:reason==='respawn'?`${this.spec.name ?? 'Activity'} stopped`:`${this.spec.name ?? 'Activity'} stopped`,2.4,'warn');this.play('fail');this.tell('abandon');this.idleVisuals?.();}
 finish(result){this.state='done';this.result=result;this.ctx.prompts.setSuspended(false);this.play('achievement');this.tell('finish',result.analytics??{});this.idleVisuals?.(true);this.prompt?.setLabel(this.againLabel);}
 tooFar(){const p=this.ctx.driving.vehicle.position;return flat(p).distanceTo(this.centre())>this.reach;}
 hudBase(){const n=this.notice&&this.ctx.driving.ticker.elapsed<this.noticeUntil?this.notice.text:'';return n;}
 dispose(){}
}

/* ---- slalom ------------------------------------------------------------------ */
class Slalom extends Activity{
 constructor(ctx,group){
  super(ctx,group);this.reach=60;this.armedState='armed';this.againLabel='Run the slalom again';
  this.read();if(!this.ok)return;
  const at=this.startCentre.clone().addScaledVector(this.direction,-4.5);
  this.prompt=ctx.prompts.create({label:'Start the infield slalom',position:new THREE.Vector3(at.x,this.groundHeight+1.6,at.y),align:'right',onInteract:()=>this.begin()});
  this.build();this.paintBoard();
 }
 /** Gates, start and finish from the names of the group's members. */
 read(){
  const parts=new Map(),cones=[];this.group.updateWorldMatrix(true,true);
  this.group.traverse(n=>{if(n===this.group||!visible(n))return;const m=/^Slalom (start|finish|gate (\d+)) · (left|right)/i.exec(n.name);if(m){const key=m[2]?`gate${m[2]}`:m[1].toLowerCase();if(!parts.has(key))parts.set(key,{});parts.get(key)[m[3].toLowerCase()]=n;if(n.userData.pushable)cones.push(n);}if(/^Slalom timing screen/i.test(n.name))this.screen=n;});
  const line=(p)=>p?.left&&p?.right?[flat(world(p.left)),flat(world(p.right))]:null;
  this.start=line(parts.get('start'));this.finishLine=line(parts.get('finish'));
  this.gates=[...parts.entries()].filter(([k])=>k.startsWith('gate')).sort((a,b)=>+a[0].slice(4)-+b[0].slice(4)).map(([,p])=>line(p)).filter(Boolean);
  this.cones=cones;this.ok=!!(this.start&&this.finishLine&&this.gates.length);
  if(!this.ok)return;
  this.startCentre=this.start[0].clone().add(this.start[1]).multiplyScalar(.5);const finishCentre=this.finishLine[0].clone().add(this.finishLine[1]).multiplyScalar(.5);
  this.direction=finishCentre.clone().sub(this.startCentre).normalize();this.mid=this.startCentre.clone().add(finishCentre).multiplyScalar(.5);
  this.groundHeight=groundY(this.ctx.root,this.startCentre.x,this.startCentre.y,world(this.group).y);
 }
 centre(){return this.mid;}
 build(){
  const overlay=new THREE.Group();overlay.name='Slalom · feedback';this.ctx.overlay.add(overlay);this.overlay=overlay;
  const strip=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);this.strips=[];
  const lay=(a,b,material,depth=.55)=>{const m=new THREE.Mesh(strip,material),c=a.clone().add(b).multiplyScalar(.5),len=a.distanceTo(b);m.scale.set(len,1,depth);m.position.set(c.x,groundY(this.ctx.root,c.x,c.y,this.groundHeight)+.035,c.y);m.rotation.y=-Math.atan2(b.y-a.y,b.x-a.x);overlay.add(m);return m;};
  const checker=checkerTexture();this.checker=checker;const lineMat=new THREE.MeshBasicMaterial({map:checker,transparent:true,opacity:.92,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  checker.wrapS=THREE.RepeatWrapping;checker.repeat.set(2,1);
  lay(this.start[0],this.start[1],lineMat,.9);lay(this.finishLine[0],this.finishLine[1],lineMat,.9);
  this.gateMeshes=this.gates.map(([a,b])=>lay(a,b,stripMaterial(COLORS.idle,.35)));
  this.idleVisuals();
 }
 paintBoard(){
  if(!this.screen)return;this.board??=new Board();if(!this.boardPlanes)this.boardPlanes=mountBoard(this.screen,this.board,this.ctx.overlay);
  const best=this.best,last=this.lastTotal;
  this.board.draw('Infield slalom',[['BEST',best?fmt(best.total):'—'],['LAST',last!=null?fmt(last):'—'],['GATES',String(this.gates.length)]]);
 }
 idleVisuals(){for(const m of this.gateMeshes??[]){m.material.color.copy(COLORS.idle);m.material.opacity=.32;}}
 prepare(){
  // A fresh course: knocked cones go back where the editor put them.
  resetPushables(this.ctx.physics,n=>this.cones.includes(n));
  this.coneHome=this.cones.map(c=>flat(world(c)));this.coneHit=new Set();
  this.passed=0;this.missed=0;this.penalty=0;this.result=null;this.crossedStart=false;
  for(const m of this.gateMeshes){m.material.color.copy(COLORS.idle);m.material.opacity=.32;}
  this.gateMeshes[0].material.color.copy(COLORS.next);this.gateMeshes[0].material.opacity=.7;
  const p=this.startCentre.clone().addScaledVector(this.direction,-3.2);
  this.ctx.driving.vehicle.moveTo({x:p.x,y:groundY(this.ctx.root,p.x,p.y,this.groundHeight)+1.3,z:p.y},Math.atan2(-this.direction.y,this.direction.x));
  this.last=flat(this.ctx.driving.vehicle.position);
 }
 go(){this.say('Go — through the start line',1.6);}
 step(){
  const now=flat(this.ctx.driving.vehicle.position),prev=this.last;this.last=now;
  if(this.state==='armed'){if(crosses(prev,now,this.start[0],this.start[1])){this.state='running';this.elapsed=0;this.play('blip',1);}return;}
  // Gates in order; crossing a later one (or the finish) means the ones before it were missed.
  for(let i=this.passed+this.missed;i<this.gates.length;i++){
   const [a,b]=this.gates[i],through=crosses(prev,now,a,b);
   const ahead=i===this.passed+this.missed;
   if(through){
    for(let j=this.passed+this.missed;j<i;j++)this.miss(j);
    this.passed++;const m=this.gateMeshes[i];m.material.color.copy(COLORS.ok);m.material.opacity=.75;this.play('blip',Math.min(2,1+this.passed*.08));this.highlightNext();break;
   }
   // Driving past a gate's line outside its cones also counts as a miss.
   const [ea,eb]=this.extended(a,b);if(ahead&&crosses(prev,now,ea,eb)&&!through){this.miss(i);this.highlightNext();break;}
  }
  for(let i=0;i<this.cones.length;i++){if(this.coneHit.has(i))continue;if(flat(world(this.cones[i])).distanceTo(this.coneHome[i])>.35){this.coneHit.add(i);this.penalty+=this.spec.penaltyCone??1;this.say(`Cone down · +${this.spec.penaltyCone??1} s`,1.4,'warn');this.play('fail');}}
  if(crosses(prev,now,this.finishLine[0],this.finishLine[1])&&this.passed+this.missed>=Math.min(1,this.gates.length)){
   for(let j=this.passed+this.missed;j<this.gates.length;j++)this.miss(j,true);
   const total=this.elapsed+this.penalty,best=this.best,record=!best||total<best.total;
   if(record)writeBest(this.key,{total,time:this.elapsed,penalty:this.penalty});
   this.lastTotal=total;this.paintBoard();
   const a=this.ctx.achievements;if(this.penalty===0)a?.unlock?.('slalomClean');if(total<(this.spec.quickUnder??22))a?.unlock?.('slalomQuick');
   this.finish({total,time:this.elapsed,penalty:this.penalty,missed:this.missed,cones:this.coneHit.size,record,analytics:{action:'finish'}});
  }
 }
 extended(a,b){const d=b.clone().sub(a).normalize();return [a.clone().addScaledVector(d,-14),b.clone().addScaledVector(d,14)];}
 miss(i,quiet=false){this.missed++;this.penalty+=this.spec.penaltyMissed??3;const m=this.gateMeshes[i];m.material.color.copy(COLORS.bad);m.material.opacity=.7;if(!quiet){this.say(`Gate ${i+1} missed · +${this.spec.penaltyMissed??3} s`,1.6,'warn');this.play('fail');}}
 highlightNext(){const k=this.passed+this.missed;if(k<this.gateMeshes.length){const m=this.gateMeshes[k];m.material.color.copy(COLORS.next);m.material.opacity=.75;}}
 hud(){
  const notice=this.hudBase();
  if(this.state==='countdown')return {activity:true,headline:'Infield slalom',timer:String(Math.max(1,Math.ceil(this.countdown))),lines:['Weave through every gate in order']};
  if(this.state==='armed')return {activity:true,headline:'Infield slalom',timer:'0.00 s',lines:[notice||'The clock starts at the start line']};
  if(this.state==='running')return {activity:true,headline:'Infield slalom',timer:fmt(this.elapsed),lines:[`Gate ${Math.min(this.gates.length,this.passed+this.missed+1)}/${this.gates.length}`,this.penalty?`+${this.penalty} s`:'',notice].filter(Boolean)};
  if(this.state==='done'&&this.result&&flat(this.ctx.driving.vehicle.position).distanceTo(this.mid)<this.reach){const r=this.result,b=this.best;return {activity:true,headline:r.record?'Slalom · new best':'Slalom · finished',timer:fmt(r.total),lines:[`${fmt(r.time)} + ${r.penalty} s penalties`,r.missed?`${r.missed} gate${r.missed>1?'s':''} missed`:'',r.cones?`${r.cones} cone${r.cones>1?'s':''} down`:'',b?`best ${fmt(b.total)}`:''].filter(Boolean)};}
  return notice?{activity:true,headline:'',timer:'',lines:[notice]}:null;
 }
 marker(){return this.ok?{id:'activity:'+this.key,kind:'activity',name:'Infield slalom',x:this.startCentre.x,z:this.startCentre.y,priority:2}:null;}
 dispose(){this.overlay?.removeFromParent();this.overlay?.traverse(o=>{if(o.isMesh&&o.material!==this.board?.material){o.material.dispose?.();}});this.checker?.dispose();for(const p of this.boardPlanes??[]){p.geometry.dispose();p.removeFromParent();}this.board?.dispose();}
}

/* ---- penguin round-up ------------------------------------------------------------ */
class RoundUp extends Activity{
 constructor(ctx,group){
  super(ctx,group);this.reach=48;this.againLabel='Round them up again';
  this.radius=this.spec.radius??3.6;this.seconds=this.spec.seconds??90;
  this.group.updateWorldMatrix(true,true);this.pen=flat(world(this.group));
  this.group.traverse(n=>{if(/^Round-up sign/i.test(n.name)&&visible(n))this.sign=n;});
  this.penguins=[];ctx.root.traverse(n=>{if(n.userData.pushable&&n.userData.assetDefinitionId==='v4:plastic-penguin'&&visible(n)&&flat(world(n)).distanceTo(this.pen)<32)this.penguins.push(n);});
  this.ok=this.penguins.length>0;if(!this.ok)return;
  this.y=groundY(ctx.root,this.pen.x,this.pen.y,world(this.group).y);
  const s=this.sign?world(this.sign):new THREE.Vector3(this.pen.x,this.y,this.pen.y+this.radius+3);
  this.prompt=ctx.prompts.create({label:'Start the penguin round-up',position:new THREE.Vector3(s.x,this.y+1.6,s.z),align:'left',onInteract:()=>this.begin()});
  this.resetPrompt=ctx.prompts.create({label:'Put the penguins back',position:new THREE.Vector3(s.x+2.2,this.y+1.6,s.z),align:'right',startHidden:true,onInteract:()=>{resetPushables(ctx.physics,n=>this.penguins.includes(n));this.resetPrompt.hide();this.say('The penguins are back where they live',2);}});
  this.build();
 }
 centre(){return this.pen;}
 build(){
  const overlay=new THREE.Group();overlay.name='Round-up · pen';this.ctx.overlay.add(overlay);this.overlay=overlay;
  this.ringMaterial=stripMaterial(COLORS.idle,.45);this.fillMaterial=stripMaterial(COLORS.idle,.08);
  const ring=new THREE.Mesh(new THREE.RingGeometry(this.radius-.28,this.radius,64).rotateX(-Math.PI/2),this.ringMaterial);
  const fill=new THREE.Mesh(new THREE.CircleGeometry(this.radius-.28,64).rotateX(-Math.PI/2),this.fillMaterial);
  for(const m of [ring,fill]){m.position.set(this.pen.x,this.y+.03,this.pen.y);overlay.add(m);}
  this.ring=ring;
 }
 idleVisuals(){this.ringMaterial.color.copy(COLORS.idle);this.ringMaterial.opacity=.45;this.fillMaterial.color.copy(COLORS.idle);this.fillMaterial.opacity=.08;}
 prepare(){resetPushables(this.ctx.physics,n=>this.penguins.includes(n));this.penned=0;this.result=null;this.resetPrompt?.hide();this.ringMaterial.color.copy(COLORS.next);this.ringMaterial.opacity=.8;}
 go(){this.say(`Push the penguins into the ring · ${this.seconds} s`,2.2);}
 inside(){let n=0;for(const p of this.penguins){const w=world(p);if(flat(w).distanceTo(this.pen)<this.radius-.15&&Math.abs(w.y-this.y)<1.6)n++;}return n;}
 step(dt){
  const n=this.inside();
  if(n>this.penned){this.play('blip',1+n*.06);this.pulse=1;this.say(`${n} of ${this.penguins.length} in the pen`,1.2);}else if(n<this.penned){this.say('One got away',1.2,'warn');}
  this.penned=n;if(this.pulse>0){this.pulse=Math.max(0,this.pulse-dt*2.5);this.ringMaterial.color.copy(COLORS.next).lerp(COLORS.ok,this.pulse);}
  const all=n===this.penguins.length,timeUp=this.elapsed>=this.seconds;
  if(all||timeUp){
   const best=this.best,score={count:n,time:all?this.elapsed:this.seconds};const better=!best||n>best.count||(n===best.count&&score.time<best.time);if(better)writeBest(this.key,score);
   const a=this.ctx.achievements;if(n>=Math.min(5,this.penguins.length))a?.unlock?.('roundUp');if(all)a?.unlock?.('roundUpAll');
   this.ringMaterial.color.copy(all?COLORS.ok:COLORS.warn);this.fillMaterial.color.copy(all?COLORS.ok:COLORS.warn);this.fillMaterial.opacity=.18;
   this.finish({count:n,of:this.penguins.length,time:score.time,all,record:better,analytics:{action:'finish'}});this.resetPrompt?.show();
  }
 }
 hud(){
  const notice=this.hudBase();
  if(this.state==='countdown')return {activity:true,headline:'Penguin round-up',timer:String(Math.max(1,Math.ceil(this.countdown))),lines:['Push them into the ring on the ice']};
  if(this.state==='running')return {activity:true,headline:'Penguin round-up',timer:fmt(Math.max(0,this.seconds-this.elapsed)),lines:[`${this.penned}/${this.penguins.length} in the pen`,notice].filter(Boolean)};
  if(this.state==='done'&&this.result&&flat(this.ctx.driving.vehicle.position).distanceTo(this.pen)<this.reach){const r=this.result,b=this.best;return {activity:true,headline:r.all?'Round-up · every penguin home':'Round-up · time',timer:`${r.count}/${r.of}`,lines:[r.all?`in ${fmt(r.time)}`:'',r.record?'new best':b?`best ${b.count}/${r.of}${b.count===r.of?` in ${fmt(b.time)}`:''}`:''].filter(Boolean)};}
  return notice?{activity:true,headline:'',timer:'',lines:[notice]}:null;
 }
 marker(){return this.ok?{id:'activity:'+this.key,kind:'activity',name:'Penguin round-up',x:this.pen.x,z:this.pen.y,priority:2}:null;}
 dispose(){this.overlay?.removeFromParent();this.ring?.geometry.dispose();this.overlay?.traverse(o=>{if(o.isMesh)o.geometry.dispose();});this.ringMaterial?.dispose();this.fillMaterial?.dispose();}
}

const TYPES={slalom:Slalom,roundup:RoundUp};

export class Activities{
 constructor({root,scene,physics,driving,achievements,tell}){
  this.bin=new Bin();this.driving=driving;this.list=[];
  const tweens=new Tweens(driving.ticker,this.bin);
  this.prompts=new Prompts(driving.ticker,tweens,driving.inputs,this.bin,()=>driving.player.position);scene.add(this.prompts.group);
  this.overlay=new THREE.Group();this.overlay.name='Activities';scene.add(this.overlay);
  const ctx={root,scene,physics,driving,achievements,tell,prompts:this.prompts,overlay:this.overlay};
  for(const group of activityGroups(root)){const Type=TYPES[group.userData.activity.type];if(!Type)continue;try{const a=new Type(ctx,group);if(a.ok)this.list.push(a);}catch(e){console.warn('[activities] could not build',group.name,e);}}
  const tick=()=>{const dt=driving.ticker.delta;for(const a of this.list)a.tick(dt);};
  driving.ticker.events.on('tick',tick,10);this.bin.add(()=>driving.ticker.events.off('tick',tick));
  driving.player.events?.on?.('respawn',()=>{for(const a of this.list)if(a.running)a.stop('respawn');});
 }
 get groups(){return [this.prompts.group,this.overlay];}
 get busy(){return this.list.some(a=>a.running);}
 hud(){for(const a of this.list){const h=a.running?a.hud():null;if(h)return h;}for(const a of this.list){const h=a.hud();if(h)return h;}return {prompt:this.prompts.activeLabel??''};}
 get prompt(){return this.prompts.activeLabel??'';}
 interact(){return this.prompts.interactActive();}
 exit(){const a=this.list.find(x=>x.running);if(a){a.stop('exit');return true;}return false;}
 markers(){return this.list.map(a=>a.marker()).filter(Boolean);}
 dispose(){for(const a of this.list){if(a.running)a.stop('exit');a.dispose();}this.bin.dispose();this.prompts.group.removeFromParent();this.overlay.removeFromParent();}
}
