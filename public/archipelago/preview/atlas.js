import * as THREE from 'three';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {authoredWorldBounds,visibleInWorld} from './world-bounds.js';
import {areaOf} from './runtime/placement.js';
/* THE ATLAS — the M map.
   An orthographic photograph of the world itself, north up, framed from the
   terrain's real bounds, the way /world2's top-down camera sees its island:
   the same scene, materials, lights and shadows the car drives through, never
   a second drawing of it. It is taken when the map opens and kept until the
   world changes; zooming in re-photographs only the visible rectangle at
   screen resolution, once the gesture has settled. Nothing renders for the
   map while it is closed.

   Vehicles, prompts and other transient runtime objects live on MAP_HIDDEN, a
   layer the driving camera enables and the map camera does not, so the map
   shows the island and the car is drawn as an arrow instead. Nothing in the
   world changes material or visibility for the photograph; only the sun's
   shadow frustum is re-centred for that one render and put back.

   Markers come from the scene graph: visible experience groups (placed where
   their meshes really are, see sceneMarkers), the activity points the runtime
   registered, and the player. Moving a group in the editor moves its marker;
   publishing a world publishes its map.

   TRAVEL. With `onTravel` (and while `canTravel()`, i.e. driving: the studio's
   editor shows the same map without it), every place is a button: selecting one, or any
   point of the photograph, asks the host for a safe arrival there
   (main.js → runtime/placement.js). On success the map closes; on refusal the
   reason is said where it was asked ("Can't drive there — water") and the map
   stays. A click is told from a drag by distance (5 px mouse, 10 px touch)
   and by pointer count (a pinch is never a click): the pointer is captured
   only once it has become a drag, and the click that ends a drag or a pinch is
   swallowed, so panning never travels. A double click no longer zooms (its
   first click already travels); the wheel, a pinch, + and − do.
   Keys while the map is open belong to the map and never reach the car: Esc
   and M close it; Tab and Shift+Tab move through the map, its places and its
   buttons (focus stays inside); Enter or Space on a place travels there;
   arrows/WASD pan; + − zoom and 0 shows the whole island. */
export const MAP_HIDDEN=2;
const KINDS={experience:{label:'Areas',color:'#1d3c46'},activity:{label:'Activities',color:'#d9542b'},place:{label:'Places',color:'#2f7f74'}};
const MIN_ZOOM=1,MAX_ZOOM=7,DRAG={mouse:5,pen:6,touch:10};
const clamp=THREE.MathUtils.clamp;
function el(tag,attrs={},...children){const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v!==undefined&&v!==null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...children);return e;}
export class WorldAtlas{
 constructor({renderer,scene,root,sun,getPlayer,getMarkers,onOpen=()=>{},onClose=()=>{},onTravel=null,canTravel=()=>true,title='Archipiélago'}){
  Object.assign(this,{renderer,scene,root,sun,getPlayer,getMarkers,onOpen,onClose,onTravel,canTravel});this.isOpen=false;this.photo=null;this.view={zoom:1,cx:0,cy:0};this.detailTimer=0;this.disposers=[];this.pinEls=[];this.suppressUntil=0;this.travelling=false;
  const link=el('link',{rel:'stylesheet',href:new URL('./atlas.css',import.meta.url).href});document.head.append(link);this.disposers.push(()=>link.remove());
  this.base=el('canvas',{class:'atlas-base','aria-hidden':'true'});this.detail=el('canvas',{class:'atlas-detail','aria-hidden':'true'});
  this.plane=el('div',{class:'atlas-plane'},this.base,this.detail);this.pins=el('div',{class:'atlas-pins',role:'group'});
  this.feedback=el('p',{class:'atlas-feedback',role:'alert',hidden:true});
  this.stage=el('div',{class:'atlas-stage',tabindex:'0'},this.plane,this.pins,this.feedback);
  const zoomIn=el('button',{type:'button','aria-label':'Zoom in',text:'+'}),zoomOut=el('button',{type:'button','aria-label':'Zoom out',text:'−'}),fit=el('button',{type:'button','aria-label':'Show the whole island',text:'⤢'});
  this.scale=el('div',{class:'atlas-scale','aria-hidden':'true'},el('i'),el('span'));
  this.legend=el('ul',{class:'atlas-legend','aria-label':'Legend'});
  this.status=el('p',{class:'atlas-status',role:'status'});
  const close=el('button',{type:'button',class:'atlas-close',text:'Close'},el('kbd',{text:'Esc'}));
  this.dialog=el('section',{class:'atlas',role:'dialog','aria-modal':'true','aria-labelledby':'atlas-title',hidden:true},
   el('header',{class:'atlas-head'},el('div',{},this.eyebrow=el('p',{class:'atlas-eyebrow',text:'Find your way'}),el('h2',{id:'atlas-title',text:title})),close),
   this.stage,
   el('aside',{class:'atlas-side'},el('div',{class:'atlas-zoom',role:'group','aria-label':'Zoom'},zoomIn,zoomOut,fit),el('p',{class:'atlas-north','aria-hidden':'true',text:'N ↑'}),this.scale,this.legend,this.status));
  document.body.append(this.dialog);this.disposers.push(()=>this.dialog.remove());
  close.onclick=()=>this.close();zoomIn.onclick=()=>this.zoomAt(1.5);zoomOut.onclick=()=>this.zoomAt(1/1.5);fit.onclick=()=>this.fit();
  this.bindGestures();
  this.resize=()=>{if(this.isOpen){this.layout();this.apply();}};addEventListener('resize',this.resize);this.disposers.push(()=>removeEventListener('resize',this.resize));
 }
 /** The world changed (editor edit, new revision): the next opening re-photographs it. */
 invalidate(){this.photo=null;}
 /** Travel is offered only when the host can travel now (while driving; not in the studio's editor). */
 setTravel(on){
  this.travelling=on;this.stage.classList.toggle('atlas-travel',on);this.eyebrow.textContent=on?'Find your way · select a place to travel there':'Find your way';
  this.pins.setAttribute('aria-label',on?'Places on the map: select one to travel there':'Places on the map');
  this.stage.setAttribute('aria-label',`Map. ${on?'Select a place, or any point of the island, to travel there. ':''}Drag or use the arrow keys to pan; scroll, pinch or + and − to zoom.`);
 }
 toggle(){if(this.isOpen)this.close();else this.show();}
 show(){
  if(this.isOpen)return;this.isOpen=true;this.returnFocus=document.activeElement;this.onOpen();
  this.setTravel(!!this.onTravel&&this.canTravel());
  this.dialog.hidden=false;
  if(!this.photo)this.photograph();
  this.layout();
  this.markers=this.collectMarkers();this.renderLegend();this.buildPins();
  this.centreOnPlayer();this.apply();this.stage.focus({preventScroll:true});
 }
 close(){if(!this.isOpen)return;this.isOpen=false;clearTimeout(this.detailTimer);clearTimeout(this.feedbackTimer);this.feedback.hidden=true;this.dialog.hidden=true;this.onClose();this.returnFocus?.focus?.({preventScroll:true});}
 /* ---- photograph --------------------------------------------------------- */
 bounds(){const b=authoredWorldBounds(this.root),m=6;return {minX:b.minX-m,maxX:b.maxX+m,minZ:b.minZ-m,maxZ:b.maxZ+m};}
 render(rect,width,height){
  const r=this.renderer,cam=new THREE.OrthographicCamera(rect.minX-(rect.minX+rect.maxX)/2,rect.maxX-(rect.minX+rect.maxX)/2,(rect.maxZ-rect.minZ)/2,-(rect.maxZ-rect.minZ)/2,1,1200);
  const cx=(rect.minX+rect.maxX)/2,cz=(rect.minZ+rect.maxZ)/2;cam.up.set(0,0,-1);cam.position.set(cx,500,cz);cam.lookAt(cx,0,cz);cam.layers.set(0);cam.updateMatrixWorld(true);cam.updateProjectionMatrix();
  const sun=this.sun,saved=sun&&{p:sun.position.clone(),t:sun.target.position.clone(),c:{...sun.shadow.camera}};
  if(sun){const all=this.photo?.bounds??rect,ax=(all.minX+all.maxX)/2,az=(all.minZ+all.maxZ)/2,half=Math.max(all.maxX-all.minX,all.maxZ-all.minZ)*.72;sun.position.set(ax-90,160,az+90);sun.target.position.set(ax,0,az);sun.target.updateMatrixWorld();Object.assign(sun.shadow.camera,{left:-half,right:half,top:half,bottom:-half,far:600});sun.shadow.camera.updateProjectionMatrix();}
  // Off screen, three skips tone mapping and the sRGB transfer; OutputPass applies the
  // renderer's own, so the photograph has the colours the player sees.
  const hdr=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,samples:4}),target=new THREE.WebGLRenderTarget(width,height),previous=r.getRenderTarget(),fog=this.scene.fog,pixels=new Uint8Array(width*height*4);this.scene.fog=null;this.output??=new OutputPass();
  try{r.setRenderTarget(hdr);r.clear();r.render(this.scene,cam);this.output.render(r,target,hdr);r.readRenderTargetPixels(target,0,0,width,height,pixels);}
  finally{r.setRenderTarget(previous);hdr.dispose();target.dispose();this.scene.fog=fog;if(sun){sun.position.copy(saved.p);sun.target.position.copy(saved.t);sun.target.updateMatrixWorld();Object.assign(sun.shadow.camera,{left:saved.c.left,right:saved.c.right,top:saved.c.top,bottom:saved.c.bottom,far:saved.c.far});sun.shadow.camera.updateProjectionMatrix();}}
  const image=new ImageData(width,height),row=width*4;for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-1-y)*row,(height-y)*row),y*row);return image;
 }
 photograph(){
  const b=this.bounds(),w=b.maxX-b.minX,d=b.maxZ-b.minZ,long=Math.min(this.renderer.capabilities.maxTextureSize,3072,Math.max(2048,Math.round(Math.max(innerWidth,innerHeight)*Math.min(2,devicePixelRatio||1)*1.4)));
  const width=Math.round(w>=d?long:long*w/d),height=Math.round(w>=d?long*d/w:long);
  this.photo={bounds:b,width,height};const image=this.render(b,width,height);
  this.base.width=width;this.base.height=height;this.base.getContext('2d').putImageData(image,0,0);this.detail.hidden=true;
  // The open sea at the photograph's corner continues past its edges.
  const [r,g,b2]=image.data;this.stage.style.background=`rgb(${r},${g},${b2})`;
 }
 /* ---- view ---------------------------------------------------------------- */
 layout(){const s=this.stage.getBoundingClientRect();this.sw=s.width;this.sh=s.height;if(!this.photo)return;const fit=Math.min(this.sw/this.photo.width,this.sh/this.photo.height);this.fw=this.photo.width*fit;this.fh=this.photo.height*fit;Object.assign(this.plane.style,{width:this.fw+'px',height:this.fh+'px'});}
 /** World x/z → map-plane CSS px at zoom 1. */
 toPlane(x,z){const b=this.photo.bounds;return [(x-b.minX)/(b.maxX-b.minX)*this.fw,(z-b.minZ)/(b.maxZ-b.minZ)*this.fh];}
 toScreen(x,z){const [px,py]=this.toPlane(x,z),v=this.view;return [this.sw/2+(px-v.cx)*v.zoom,this.sh/2+(py-v.cy)*v.zoom];}
 /** Stage CSS px → world x/z: the exact inverse of toScreen for the current zoom, pan and stage size (north up, no rotation). */
 toWorld(sx,sy){const v=this.view,b=this.photo.bounds,px=v.cx+(sx-this.sw/2)/v.zoom,py=v.cy+(sy-this.sh/2)/v.zoom;return {x:b.minX+px/this.fw*(b.maxX-b.minX),z:b.minZ+py/this.fh*(b.maxZ-b.minZ),inside:px>=0&&px<=this.fw&&py>=0&&py<=this.fh};}
 fit(){this.view={zoom:1,cx:this.fw/2,cy:this.fh/2};this.apply();}
 centreOnPlayer(){this.view={zoom:1,cx:this.fw/2,cy:this.fh/2};}
 clampView(){const v=this.view;v.zoom=clamp(v.zoom,MIN_ZOOM,MAX_ZOOM);const hx=Math.max(0,(this.fw-this.sw/v.zoom)/2),hy=Math.max(0,(this.fh-this.sh/v.zoom)/2);v.cx=clamp(v.cx,this.fw/2-hx,this.fw/2+hx);v.cy=clamp(v.cy,this.fh/2-hy,this.fh/2+hy);}
 zoomAt(factor,sx=this.sw/2,sy=this.sh/2){const v=this.view,px=v.cx+(sx-this.sw/2)/v.zoom,py=v.cy+(sy-this.sh/2)/v.zoom;v.zoom=clamp(v.zoom*factor,MIN_ZOOM,MAX_ZOOM);v.cx=px-(sx-this.sw/2)/v.zoom;v.cy=py-(sy-this.sh/2)/v.zoom;this.apply();}
 pan(dx,dy){this.view.cx-=dx/this.view.zoom;this.view.cy-=dy/this.view.zoom;this.apply();}
 apply(){
  if(!this.photo)return;this.clampView();const v=this.view;
  this.plane.style.transform=`translate(${this.sw/2-v.cx*v.zoom}px,${this.sh/2-v.cy*v.zoom}px) scale(${v.zoom})`;
  this.placePins();this.renderScale();
  // A sharper photograph of just what is on screen, once the gesture has settled.
  clearTimeout(this.detailTimer);if(v.zoom>1.6)this.detailTimer=setTimeout(()=>this.renderDetail(),180);else this.detail.hidden=true;
 }
 renderDetail(){
  if(!this.isOpen)return;const v=this.view,b=this.photo.bounds,toWorldX=px=>b.minX+px/this.fw*(b.maxX-b.minX),toWorldZ=py=>b.minZ+py/this.fh*(b.maxZ-b.minZ);
  const x0=Math.max(0,v.cx-this.sw/2/v.zoom),x1=Math.min(this.fw,v.cx+this.sw/2/v.zoom),y0=Math.max(0,v.cy-this.sh/2/v.zoom),y1=Math.min(this.fh,v.cy+this.sh/2/v.zoom);
  const dpr=Math.min(2,devicePixelRatio||1),width=Math.min(2048,Math.round((x1-x0)*v.zoom*dpr)),height=Math.min(2048,Math.round((y1-y0)*v.zoom*dpr));if(width<8||height<8)return;
  const image=this.render({minX:toWorldX(x0),maxX:toWorldX(x1),minZ:toWorldZ(y0),maxZ:toWorldZ(y1)},width,height);
  this.detail.width=width;this.detail.height=height;this.detail.getContext('2d').putImageData(image,0,0);
  Object.assign(this.detail.style,{left:x0+'px',top:y0+'px',width:(x1-x0)+'px',height:(y1-y0)+'px'});this.detail.hidden=false;
 }
 renderScale(){
  const b=this.photo.bounds,metresPerPx=(b.maxX-b.minX)/this.fw/this.view.zoom,steps=[5,10,20,25,50,100,200];let metres=steps.find(m=>m/metresPerPx>=70)??200;
  this.scale.querySelector('i').style.width=Math.round(metres/metresPerPx)+'px';this.scale.querySelector('span').textContent=metres+' m';
 }
 /* ---- markers ------------------------------------------------------------- */
 collectMarkers(){
  const list=(this.getMarkers?.()??[]).filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.z)),player=this.getPlayer?.(),places=[];
  // Prompts a few metres apart (four contact links on one sign) read as one place on a map.
  for(const m of list){const near=m.kind==='activity'&&places.find(o=>o.kind==='activity'&&Math.hypot(o.x-m.x,o.z-m.z)<5);if(near){near.members.push(m.name);near.name=`${near.members[0]} +${near.members.length-1}`;near.description=near.members.join(', ');}else places.push({...m,members:[m.name]});}
  return {places,player};
 }
 renderLegend(){
  const counts={};for(const m of this.markers.places)counts[m.kind]=(counts[m.kind]??0)+1;
  this.legend.replaceChildren(el('li',{},el('b',{class:'atlas-key atlas-key-player'}),'You are here'),...Object.entries(KINDS).filter(([k])=>counts[k]).map(([k,v])=>el('li',{},el('b',{class:'atlas-key',style:`background:${v.color}`}),`${v.label} · ${counts[k]}`)));
  this.status.textContent=`${this.markers.places.length} places · north is up${this.travelling?' · select one to travel there':''}`;
 }
 /** One element per place for as long as the map is open (focus survives panning and zooming), in reading order for Tab. */
 buildPins(){
  const order={activity:0,experience:1,place:2};this.ranked=[...this.markers.places].sort((a,b)=>(order[a.kind]??3)-(order[b.kind]??3)||(b.priority??0)-(a.priority??0));
  const travel=this.travelling,tab=[...this.markers.places].sort((a,b)=>a.z-b.z||a.x-b.x);
  this.pinEls=tab.map(m=>{const label=m.description?`${m.name} — ${m.description}`:m.name,pin=el(travel?'button':'div',travel?{type:'button',class:`atlas-pin atlas-pin-${m.kind}`,'aria-label':`Travel to ${label}`,title:`Travel to ${label}`}:{class:`atlas-pin atlas-pin-${m.kind}`,title:label},el('i',{'aria-hidden':'true',text:m.icon??''}),el('span',{text:m.name,'aria-hidden':travel?'true':null}));pin.style.setProperty('--pin',KINDS[m.kind]?.color??'#333');if(travel)pin.addEventListener('click',e=>{e.stopPropagation();if(performance.now()<this.suppressUntil)return;this.travel(m,this.pinPoint(pin));});return {m,pin};});
  this.playerEl=this.markers.player?el('div',{class:'atlas-player',role:'img','aria-label':'You are here'}):null;
  this.pins.replaceChildren(...this.pinEls.map(p=>p.pin),...(this.playerEl?[this.playerEl]:[]));
 }
 pinPoint(pin){return [parseFloat(pin.style.left)||this.sw/2,parseFloat(pin.style.top)||this.sh/2];}
 placePins(){
  const taken=[],fits=r=>!taken.some(t=>r.x<t.x+t.w&&r.x+r.w>t.x&&r.y<t.y+t.h&&r.y+r.h>t.y),byPlace=new Map(this.pinEls.map(p=>[p.m,p.pin]));
  const player=this.markers.player;if(player){const [x,y]=this.toScreen(player.x,player.z);taken.push({x:x-14,y:y-14,w:28,h:28});}
  // Activities first, then areas, then the rest: the label that makes the cut is the one worth reading.
  for(const m of this.ranked??[]){
   const pin=byPlace.get(m);if(!pin)continue;const [x,y]=this.toScreen(m.x,m.z),off=x<-20||y<-20||x>this.sw+20||y>this.sh+20;
   if(off){if(pin===document.activeElement)this.stage.focus({preventScroll:true});pin.hidden=true;continue;}pin.hidden=false;
   // Near the right edge the label goes on the pin's left rather than off the map.
   const label=m.name.length*6.4+18,flip=x+9+label>this.sw-6,box={x:flip?x-9-label:x+9,y:y-9,w:label,h:18},showLabel=fits(box);if(showLabel)taken.push(box);taken.push({x:x-7,y:y-7,w:14,h:14});
   Object.assign(pin.style,{left:x+'px',top:y+'px'});pin.dataset.label=showLabel?'true':'false';pin.dataset.flip=flip?'true':'false';
  }
  if(player&&this.playerEl){const [x,y]=this.toScreen(player.x,player.z),deg=-Math.atan2(-player.dz,player.dx)*180/Math.PI+90;Object.assign(this.playerEl.style,{left:x+'px',top:y+'px',transform:`translate(-50%,-50%) rotate(${deg}deg)`});}
 }
 /* ---- travel -------------------------------------------------------------- */
 /** Asks the host to travel; closes on success, says why not where it was asked otherwise. */
 travel(target,[sx,sy]=[this.sw/2,this.sh/2]){
  if(!this.travelling||!this.isOpen)return null;const result=this.onTravel(target)??{ok:false};
  if(result.ok){this.markers.player=this.getPlayer?.()??this.markers.player;this.close();}else this.say(result.message??'Can’t drive there',sx,sy);
  return result;
 }
 say(text,sx,sy){const f=this.feedback;f.textContent=text;f.hidden=false;Object.assign(f.style,{left:clamp(sx,90,this.sw-90)+'px',top:Math.max(44,sy)+'px'});f.classList.remove('show');void f.offsetWidth;f.classList.add('show');this.status.textContent=text;clearTimeout(this.feedbackTimer);this.feedbackTimer=setTimeout(()=>{f.hidden=true;f.classList.remove('show');},2800);}
 /* ---- gestures ------------------------------------------------------------ */
 bindGestures(){
  const s=this.stage,pointers=new Map();let last=null,pinch=null,press=null;
  const on=(t,type,fn,o)=>{t.addEventListener(type,fn,o);this.disposers.push(()=>t.removeEventListener(type,fn,o));};
  const capture=id=>{try{s.setPointerCapture(id);}catch{/* the pointer is already gone */}};
  on(s,'wheel',e=>{e.preventDefault();const r=s.getBoundingClientRect(),f=Math.exp(-e.deltaY*(e.deltaMode===1?.05:.0016));this.zoomAt(f,e.clientX-r.left,e.clientY-r.top);},{passive:false});
  on(s,'pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pointers.size===1){press={id:e.pointerId,x:e.clientX,y:e.clientY,type:e.pointerType,dragging:false,gesture:false};last=null;}
   else{if(press)press.gesture=true;const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)};for(const id of pointers.keys())capture(id);}});
  on(s,'pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y),r=s.getBoundingClientRect();if(pinch.d>0)this.zoomAt(d/pinch.d,(a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top);pinch.d=d;return;}
   if(!press||e.pointerId!==press.id||press.gesture)return;
   // Only past the threshold does a press become a drag (and the pointer get captured): below it, it is still a click.
   if(!press.dragging&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>(DRAG[press.type]??6)){press.dragging=true;last={x:press.x,y:press.y};capture(e.pointerId);s.classList.add('dragging');}
   if(press.dragging){this.pan(e.clientX-last.x,e.clientY-last.y);last={x:e.clientX,y:e.clientY};}});
  const end=e=>{if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
   // The click a browser sends straight after a drag or a pinch is not a choice of destination.
   if(press&&(press.dragging||press.gesture||e.type==='pointercancel'))this.suppressUntil=performance.now()+120;
   if(!pointers.size){press=null;last=null;s.classList.remove('dragging');}};
  on(s,'pointerup',end);on(s,'pointercancel',end);
  on(s,'click',e=>{if(!this.travelling||!this.photo||performance.now()<this.suppressUntil||e.target.closest?.('.atlas-pin'))return;const r=s.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,p=this.toWorld(sx,sy);if(!p.inside){this.say('Can’t drive there — outside the island',sx,sy);return;}this.travel({kind:'point',x:p.x,z:p.z,name:null},[sx,sy]);});
  // Keys while the map is open belong to the map: they never reach the car or the editor.
  on(window,'keydown',e=>{
   if(!this.isOpen)return;const k=e.code;
   if(k==='Escape'||k==='KeyM'||k==='Tab'&&!this.dialog.contains(document.activeElement)){e.preventDefault();e.stopImmediatePropagation();this.close();return;}
   if(k==='Tab'){const f=[...this.dialog.querySelectorAll('button,[tabindex="0"]')].filter(n=>!n.hidden&&!n.disabled&&n.offsetParent!==null);const i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1]?.focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0]?.focus();}e.stopImmediatePropagation();return;}
   // Enter and Space reach a focused button as its own activation (they are not prevented here): a place travels.
   const step=60,moves={ArrowLeft:[step,0],KeyA:[step,0],ArrowRight:[-step,0],KeyD:[-step,0],ArrowUp:[0,step],KeyW:[0,step],ArrowDown:[0,-step],KeyS:[0,-step]};
   if(moves[k]){e.preventDefault();this.pan(...moves[k]);}else if(k==='Equal'||k==='NumpadAdd')this.zoomAt(1.5);else if(k==='Minus'||k==='NumpadSubtract')this.zoomAt(1/1.5);else if(k==='Digit0')this.fit();
   e.stopImmediatePropagation();
  },{capture:true});
 }
 dispose(){this.close();this.output?.dispose();clearTimeout(this.detailTimer);clearTimeout(this.feedbackTimer);this.disposers.forEach(d=>d());this.disposers=[];}
}
/** Experience groups and the activity points registered by the runtime, from the live scene. A group's
 * marker stands where its meshes really are (runtime/placement.js areaOf: its floor, else its authored
 * origin inside its content) — never at a bounding box that hidden helpers or particles drag away. */
export function sceneMarkers(root,extra=[]){
 const out=[];root.updateMatrixWorld(true);
 root.traverse(n=>{
  if(!n.userData.worldExperience||!visibleInWorld(n))return;const area=areaOf(n);if(!area.box)return;
  out.push({id:n.userData.aw_id,kind:'experience',name:n.userData.mapLabel??n.name.replace(/\s+(Complete|Setup|Area)$/,''),icon:n.userData.icon??'',x:area.x,z:area.z,priority:1,group:n});
 });
 return [...out,...extra];
}
