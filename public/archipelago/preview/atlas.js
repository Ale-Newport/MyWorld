import * as THREE from 'three';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {authoredWorldBounds,landFootprint,visibleInWorld} from './world-bounds.js';
import {areaOf} from './runtime/placement.js';
/* THE ATLAS — the M map.
   An orthographic photograph of the world itself, north up, framed from the
   island's real footprint (land and its visible shallows, a little sea around
   it, a hair above centre), the way /world2's top-down camera sees its island:
   the same scene, materials, lights and shadows the car drives through, never
   a second drawing of it. It is taken when the map first opens and kept until
   the world changes; zooming in re-photographs only the visible rectangle at
   screen resolution, once the gesture has settled. Nothing renders for the
   map while it is closed.

   OPENING. The dialog paints first. Then a small photograph (1024 px) takes the
   stage in one frame and the full-resolution one is drawn behind it in a few
   horizontal bands across frames (same orthographic scale, same sun frustum,
   shadows rendered once, pixels read back without stalling and written into
   one reused buffer), then fades in over the small one. No task is longer than
   a band. The render-target variants of the scene's shaders (three compiles
   a second set when it draws off screen) are warmed in small idle slices by
   prewarm(), which the runtime calls once the world is ready.

   Vehicles, prompts and other transient runtime objects live on MAP_HIDDEN, a
   layer the driving camera enables and the map camera does not, so the map
   shows the island and the car is drawn as an arrow instead. Nothing in the
   world changes material or visibility for the photograph; only the sun's
   shadow frustum is re-centred for those renders and put back.

   Markers come from the scene graph: visible experience groups (placed where
   their meshes really are, see sceneMarkers), the activity points the runtime
   registered, and the player. Moving a group in the editor moves its marker;
   publishing a world publishes its map.

   LABELS. Places compete for a label in rank order (rankPlaces). placeLabels gives
   each the first free side of its dot (right, left, above, below, then the corners),
   where free means covering no other place's dot, no earlier label and not the
   arrow, and staying on the stage; with no free side the label waits for hover or
   focus. Widths are measured with the page's own font (measureLabels). On a touch
   screen every pin has an invisible margin to aim at, and hitMargins cuts it back
   where it would lie over the dot of a pin painted beneath it.

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
   Every transform (pins, hit test, detail, sun frustum) derives from
   photo.bounds, so framing the island there keeps travel exact.
   Keys while the map is open belong to the map and never reach the car: Esc
   and M close it; Tab and Shift+Tab move through the map, its places and its
   buttons (focus stays inside); Enter or Space on a place travels there;
   arrows/WASD pan; + − zoom and 0 shows the whole island. */
export const MAP_HIDDEN=2;
const KINDS={experience:{label:'Areas',color:'#1d3c46'},activity:{label:'Activities',color:'#d9542b'},place:{label:'Places',color:'#2f7f74'}};
const MIN_ZOOM=1,MAX_ZOOM=7,DRAG={mouse:5,pen:6,touch:10};
/** Framing: the sea around the footprint (shares of its longer side) and how far above the middle the island sits (share of the plane's height).
 * North and south carry the lift, so they get the roomier margin. East and west get the thin one: on a portrait stage the plane's width is what limits the
 * island's size, and every metre of sea there is a metre taken from the island, so a phone would show it smaller than it needs to be. */
const FRAME={pad:.034,padX:.01,lift:.017};
const PREVIEW_LONG=1024,BAND_PIXELS=1.6e6,MAX_BANDS=4,DETAIL_AFTER=1.6;
const clamp=THREE.MathUtils.clamp;
function el(tag,attrs={},...children){const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v!==undefined&&v!==null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...children);return e;}
/** The next frame, or `ms` later where frames do not come (hidden tab). */
const frame=(ms=120)=>new Promise(resolve=>{let done=false;const go=()=>{if(done)return;done=true;clearTimeout(timer);resolve();},timer=setTimeout(go,ms);requestAnimationFrame(go);});
/** After the frame that was just requested has been painted. */
const afterPaint=()=>frame(100).then(()=>new Promise(resolve=>setTimeout(resolve,0)));
const idle=(fn,timeout=600)=>typeof requestIdleCallback==='function'?requestIdleCallback(fn,{timeout}):setTimeout(fn,40);
const coarse=()=>!!globalThis.matchMedia?.('(pointer:coarse)').matches;
/** Flips an image's rows in place (GL reads bottom row first). */
export function flipRows(u8,width,rows,spare){const row=width*4;for(let a=0,b=rows-1;a<b;a++,b--){spare.set(u8.subarray(a*row,a*row+row));u8.copyWithin(a*row,b*row,b*row+row);u8.set(spare,b*row);}}
/** The photograph's bounds for an island footprint: a little sea all round (the thinner margin east and west, see FRAME), and more of it to the south (z grows down the map) so the island sits a hair above the middle. */
export function frameFootprint(land,{pad,padX,lift}=FRAME){
 const w=land.maxX-land.minX,d=land.maxZ-land.minZ,long=Math.max(w,d),marginX=long*padX,margin=long*pad,raise=(d+2*margin)*lift;
 return {minX:land.minX-marginX,maxX:land.maxX+marginX,minZ:land.minZ-margin,maxZ:land.maxZ+margin+2*raise};
}
const KIND_ORDER={activity:0,experience:1,place:2};
/** Which place gets its label first when two compete: activities, then areas, then the rest, higher priority first. Ties keep the order the world lists its places in (the sort is stable), so pass the list in that order. */
export function rankPlaces(places){return [...places].sort((a,b)=>(KIND_ORDER[a.kind]??3)-(KIND_ORDER[b.kind]??3)||(b.priority??0)-(a.priority??0));}
/** The order Tab walks the pins in: north to south, then west to east. */
export function readingOrder(places){return [...places].sort((a,b)=>a.z-b.z||a.x-b.x);}
/* A label is a pill 18.3 px tall (atlas.css: 11 px type at 1.3, 2 px padding), 6 px beside its dot, or 4 px above or below it. The dot is 14 px. */
const DOT=7,LABEL_H=18.3,SIDE_GAP=6,STACK_GAP=4,CORNER=4,SIDES=['right','left','above','below','above-right','above-left','below-right','below-left'];
/** Half the size of the square a pin keeps other labels out of: the dot (a diamond reaches 10 px from its centre), and a little air, so that a label ends 9 px from every other dot's centre, which is how far a finger's invisible margin reaches. */
export const dotClearance=kind=>kind==='activity'?10:9;
/** The box (x0, y0, x1, y1 into `out`) of a label of width w on a side of a dot centred at (x, y). The sides: right, left, above, below, and the four corners (above-right ...). */
function labelBox(side,x,y,w,out){
 if(side==='right'||side==='left'){out[0]=side==='right'?x+DOT+SIDE_GAP:x-DOT-SIDE_GAP-w;out[1]=y-LABEL_H/2;out[2]=out[0]+w;out[3]=y+LABEL_H/2;}
 else{
  // Above or below: centred on the dot, or with one end 4 px past its centre and the label reaching away from it (…-right / …-left).
  if(side.endsWith('right')){out[0]=x-CORNER;out[2]=out[0]+w;}else if(side.endsWith('left')){out[2]=x+CORNER;out[0]=out[2]-w;}else{out[0]=x-w/2;out[2]=x+w/2;}
  if(side.startsWith('above')){out[3]=y-DOT-STACK_GAP;out[1]=out[3]-LABEL_H;}else{out[1]=y+DOT+STACK_GAP;out[3]=out[1]+LABEL_H;}
 }
}
const probe=new Float64Array(4);let obstacles=new Float64Array(256);
/** Gives each visible place's label the first side of its dot where it fits (SIDES: right, left, above, below, then the corners). A label never covers another place's dot (the ones
 * ranked after it as much as the ones before), the player's arrow or another label, and stays on the stage; when no side is free the place has no label (side null)
 * and shows it on hover or focus. `recs` are in rank order: the first has the first choice. Reads x, y, off (not on the stage), lw (label width) and r (dot
 * clearance) of each; writes side. Nothing is allocated once it has run. `arrow` is the player's {x, y} or null. */
export function placeLabels(recs,{width,height,arrow=null}){
 const n=recs.length,need=4*(2*n+1);if(obstacles.length<need)obstacles=new Float64Array(need);
 const o=obstacles;let used=n+1;   // slot 0 the arrow, slots 1..n every dot (by rank), then the labels as they are handed out
 if(arrow){o[0]=arrow.x-14;o[1]=arrow.y-14;o[2]=arrow.x+14;o[3]=arrow.y+14;}else o[0]=o[1]=o[2]=o[3]=-1e9;
 for(let i=0;i<n;i++){const r=recs[i],s=4*(i+1);if(r.off){o[s]=o[s+1]=o[s+2]=o[s+3]=-1e9;continue;}o[s]=r.x-r.r;o[s+1]=r.y-r.r;o[s+2]=r.x+r.r;o[s+3]=r.y+r.r;}
 for(let i=0;i<n;i++){
  const r=recs[i];r.side=null;if(r.off)continue;
  for(let k=0;k<SIDES.length&&r.side===null;k++){
   labelBox(SIDES[k],r.x,r.y,r.lw,probe);
   if(probe[0]<2||probe[2]>width-6||probe[1]<2||probe[3]>height-2)continue;
   let free=true;
   for(let j=0;j<used&&free;j++){if(j===i+1)continue;const s=4*j;if(o[s]<probe[2]&&o[s+2]>probe[0]&&o[s+1]<probe[3]&&o[s+3]>probe[1])free=false;}
   if(!free)continue;
   r.side=SIDES[k];const s=4*used++;o[s]=probe[0]-1;o[s+1]=probe[1]-1;o[s+2]=probe[2]+1;o[s+3]=probe[3]+1;
  }
 }
}
/** How far each pin's invisible touch margin (atlas.css, coarse pointers) may reach, up to `reach` px, into rec.hit. Pins are painted one over the next, so a pin's margin lies
 * over every pin before it: where it would cover the centre of one of those, a finger aimed at that dot would travel somewhere else, so it is cut back to stop 1 px short.
 * `ordered` is the pins in the order they are painted (first = bottom), with x, y, off, lw and side set (a pin's box is its dot and its label, when it has one). */
export function hitMargins(ordered,reach=9){
 for(let i=0;i<ordered.length;i++){
  const r=ordered[i];r.hit=reach;if(r.off)continue;
  let x0=r.x-DOT,y0=r.y-DOT,x1=r.x+DOT,y1=r.y+DOT;
  if(r.side){labelBox(r.side,r.x,r.y,r.lw,probe);x0=Math.min(x0,probe[0]);y0=Math.min(y0,probe[1]);x1=Math.max(x1,probe[2]);y1=Math.max(y1,probe[3]);}
  for(let j=0;j<i;j++){const a=ordered[j];if(a.off)continue;const gap=Math.max(x0-a.x,a.x-x1,y0-a.y,a.y-y1,0);if(gap-1<r.hit)r.hit=Math.max(0,Math.floor(gap-1));}
 }
}
export class WorldAtlas{
 constructor({renderer,scene,root,sun,getPlayer,getMarkers,onOpen=()=>{},onClose=()=>{},onTravel=null,canTravel=()=>true,title='Archipiélago',autoWarm=true}){
  Object.assign(this,{renderer,scene,root,sun,getPlayer,getMarkers,onOpen,onClose,onTravel,canTravel});this.isOpen=false;this.photo=null;this.view={zoom:1,cx:0,cy:0};this.detailTimer=0;this.disposers=[];this.pinEls=[];this.suppressUntil=0;this.travelling=false;this.gen=0;this.openGen=0;this.frameBounds=null;this.places=null;this.detailInfo=null;this.front=0;this.viewChanged=0;this.raf=0;this.pumping=false;
  const link=el('link',{rel:'stylesheet',href:new URL('./atlas.css',import.meta.url).href});document.head.append(link);this.disposers.push(()=>link.remove());
  this.preview=el('canvas',{class:'atlas-preview','aria-hidden':'true'});this.base=el('canvas',{class:'atlas-base','aria-hidden':'true'});this.details=[el('canvas',{class:'atlas-detail','aria-hidden':'true',hidden:true}),el('canvas',{class:'atlas-detail','aria-hidden':'true',hidden:true})];
  this.plane=el('div',{class:'atlas-plane'},this.preview,this.base,...this.details);this.pins=el('div',{class:'atlas-pins',role:'group'});
  this.feedback=el('p',{class:'atlas-feedback',role:'alert',hidden:true});
  this.stage=el('div',{class:'atlas-stage',tabindex:'0'},this.plane,this.pins,this.feedback);
  const zoomIn=el('button',{type:'button','aria-label':'Zoom in',text:'+'}),zoomOut=el('button',{type:'button','aria-label':'Zoom out',text:'−'}),fit=el('button',{type:'button','aria-label':'Show the whole island',text:'⤢'});
  this.scaleBar=el('i');this.scaleText=el('span');this.scale=el('div',{class:'atlas-scale','aria-hidden':'true'},this.scaleBar,this.scaleText);
  this.legend=el('ul',{class:'atlas-legend','aria-label':'Legend'});
  this.status=el('p',{class:'atlas-status',role:'status'});
  const close=el('button',{type:'button',class:'atlas-close',text:'Close'},el('kbd',{text:'Esc'}));
  this.scrim=el('div',{class:'atlas-scrim','aria-hidden':'true',hidden:true});
  this.dialog=el('section',{class:'atlas',role:'dialog','aria-modal':'true','aria-labelledby':'atlas-title',hidden:true,'data-photo':'pending'},
   el('header',{class:'atlas-head'},el('div',{},this.eyebrow=el('p',{class:'atlas-eyebrow',text:'Find your way'}),el('h2',{id:'atlas-title',text:title})),close),
   this.stage,
   el('aside',{class:'atlas-side'},el('div',{class:'atlas-zoom',role:'group','aria-label':'Zoom'},zoomIn,zoomOut,fit),el('p',{class:'atlas-north','aria-hidden':'true',text:'N ↑'}),this.scale,this.legend,this.status));
  document.body.append(this.scrim,this.dialog);this.disposers.push(()=>this.scrim.remove(),()=>this.dialog.remove());
  close.onclick=()=>this.close();zoomIn.onclick=()=>this.zoomAt(1.5);zoomOut.onclick=()=>this.zoomAt(1/1.5);fit.onclick=()=>this.fit();
  this.bindGestures();
  // The stage can change size after it was measured (a rotated phone, a legend that wraps, a scale label that grows): measure again, once per frame.
  this.measure=0;const observer=new ResizeObserver(()=>{if(!this.isOpen||!this.photo||this.measure||(this.stage.clientWidth===this.sw&&this.stage.clientHeight===this.sh))return;this.measure=requestAnimationFrame(()=>{this.measure=0;if(this.isOpen&&this.photo){this.layout();this.apply(true);}});});
  observer.observe(this.stage);this.disposers.push(()=>observer.disconnect(),()=>cancelAnimationFrame(this.measure));
  // A webfont that arrives after the labels were measured changes their widths: measure again.
  if(document.fonts?.addEventListener){const refit=()=>{if(this.isOpen&&this.photo&&this.pinEls?.length){this.measureLabels();this.apply(true);}};document.fonts.addEventListener('loadingdone',refit);this.disposers.push(()=>document.fonts.removeEventListener('loadingdone',refit));}
  // Once the world is ready and has had a moment to settle, warm the render-target shaders in idle slices (idempotent: the runtime may call prewarm() itself).
  if(autoWarm){const start=()=>{const t=setTimeout(()=>idle(()=>this.prewarm()),3000);this.disposers.push(()=>clearTimeout(t));};
   if(document.body.dataset.ready==='true')start();else{const watch=new MutationObserver(()=>{if(document.body.dataset.ready==='true'){watch.disconnect();start();}});watch.observe(document.body,{attributes:true,attributeFilter:['data-ready']});this.disposers.push(()=>watch.disconnect());}}
 }
 /** The world changed (editor edit, new revision): the next opening re-photographs it. */
 invalidate(){this.reset();if(this.isOpen)this.reopen();}
 reset(){this.gen++;this.photo=null;this.frameBounds=null;this.places=null;this.releaseDetail();this.base.classList.remove('ready');this.base.width=this.base.height=1;this.preview.width=this.preview.height=1;}
 /** Nothing to show yet: the dialog is up (or about to be) and the photograph follows the next paint. */
 reopen(){this.dialog.dataset.photo='pending';this.stage.setAttribute('aria-busy','true');const gen=++this.openGen;afterPaint().then(()=>{if(this.isOpen&&gen===this.openGen)this.begin();});}
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
  // The editor may have changed the world since the last photograph; a driving visitor's world is fixed (enterDrive invalidates).
  if(this.photo&&!this.travelling)this.reset();
  this.scrim.hidden=false;this.dialog.hidden=false;this.stage.focus({preventScroll:true});
  if(this.photo){this.present(true);return;}
  this.reopen();   // first opening: the dialog paints now; the photograph follows it
 }
 close(){if(!this.isOpen)return;this.isOpen=false;clearTimeout(this.detailTimer);clearTimeout(this.feedbackTimer);cancelAnimationFrame(this.raf);this.raf=0;this.feedback.hidden=true;this.dialog.hidden=true;this.scrim.hidden=true;this.releaseDetail();this.onClose();this.returnFocus?.focus?.({preventScroll:true});}
 /** Ready to look at: layout, places, pins, then whatever sharpening is left. */
 present(cached){
  this.dialog.dataset.photo=this.photo.state==='pending'?'pending':'ready';this.markers=this.collectMarkers(cached?this.places:null);this.renderLegend();this.layout();this.buildPins();this.centreOnPlayer();this.apply(true);this.pump();
  if(cached)idle(()=>this.refreshMarkers(),400);
 }
 /** After the dialog has painted (first opening only): frame the island, lay out the places, start the photographs. */
 begin(){
  const b=this.bounds(),w=b.maxX-b.minX,d=b.maxZ-b.minZ,long=Math.min(this.renderer.capabilities.maxTextureSize,3072,Math.max(2048,Math.round(Math.max(innerWidth,innerHeight)*Math.min(2,devicePixelRatio||1)*1.4)));
  const width=Math.round(w>=d?long:long*w/d),height=Math.round(w>=d?long*d/w:long);
  this.photo={bounds:b,width,height,state:'pending',band:0};this.base.width=width;this.base.height=height;this.base.classList.remove('ready');this.preview.hidden=false;
  this.present(!!this.places);
 }
 /* ---- photograph --------------------------------------------------------- */
 /** The island's footprint with a little sea around it and a little more of it to the south, so the island sits a hair above the middle. */
 bounds(){
  if(this.frameBounds)return this.frameBounds;
  const land=landFootprint(this.root);
  if(!land){const a=authoredWorldBounds(this.root),m=6;return this.frameBounds={minX:a.minX-m,maxX:a.maxX+m,minZ:a.minZ-m,maxZ:a.maxZ+m};}
  return this.frameBounds=frameFootprint(land);
 }
 /** One horizontal band of a photograph: `rows` rows from row y0 of a width×height image of `rect`, drawn into hdr (height `per`), tone mapped into target. */
 exposeBand(rect,width,height,y0,per,sunBounds,fresh,hdr,target){
  const r=this.renderer,sun=this.sun,dz=(rect.maxZ-rect.minZ)/height,z0=rect.minZ+y0*dz,z1=z0+per*dz,cx=(rect.minX+rect.maxX)/2,cz=(z0+z1)/2;
  const cam=this.camera??=new THREE.OrthographicCamera(-1,1,1,-1,1,1200);cam.left=-(rect.maxX-rect.minX)/2;cam.right=-cam.left;cam.top=(z1-z0)/2;cam.bottom=-cam.top;
  cam.up.set(0,0,-1);cam.position.set(cx,500,cz);cam.lookAt(cx,0,cz);cam.layers.set(0);cam.updateMatrixWorld(true);cam.updateProjectionMatrix();
  const saved=this.savedSun??={p:new THREE.Vector3(),t:new THREE.Vector3(),c:{}},shadows=r.shadowMap,keep={auto:shadows.autoUpdate,need:shadows.needsUpdate},previous=r.getRenderTarget(),fog=this.scene.fog;
  if(sun){saved.p.copy(sun.position);saved.t.copy(sun.target.position);const c=sun.shadow.camera;saved.c={left:c.left,right:c.right,top:c.top,bottom:c.bottom,far:c.far};
   // One sun frustum for every band of every photograph of this world: no seams, and the shadow map is drawn once (the bands that follow reuse it).
   const ax=(sunBounds.minX+sunBounds.maxX)/2,az=(sunBounds.minZ+sunBounds.maxZ)/2,half=Math.max(sunBounds.maxX-sunBounds.minX,sunBounds.maxZ-sunBounds.minZ)*.72;
   sun.position.set(ax-90,160,az+90);sun.target.position.set(ax,0,az);sun.target.updateMatrixWorld();Object.assign(c,{left:-half,right:half,top:half,bottom:-half,far:600});c.updateProjectionMatrix();}
  shadows.autoUpdate=fresh;shadows.needsUpdate=false;this.scene.fog=null;this.output??=new OutputPass();
  // Off screen, three skips tone mapping and the sRGB transfer; OutputPass applies the
  // renderer's own, so the photograph has the colours the player sees.
  try{r.setRenderTarget(hdr);r.clear();r.render(this.scene,cam);this.output.render(r,target,hdr);}
  finally{r.setRenderTarget(previous);this.scene.fog=fog;shadows.autoUpdate=keep.auto;shadows.needsUpdate=keep.need;if(sun){sun.position.copy(saved.p);sun.target.position.copy(saved.t);sun.target.updateMatrixWorld();const c=sun.shadow.camera;Object.assign(c,saved.c);c.updateProjectionMatrix();}}
 }
 /** A photograph of `rect` in one piece, synchronously, as ImageData: for tools that want a region of the world from above (scripts/qa/world-photo.mjs). The map itself uses shoot(). */
 render(rect,width,height){
  const r=this.renderer,hdr=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,samples:4}),target=new THREE.WebGLRenderTarget(width,height),pixels=new Uint8Array(width*height*4);
  try{this.exposeBand(rect,width,height,0,height,this.photo?.bounds??rect,true,hdr,target);r.readRenderTargetPixels(target,0,0,width,height,pixels);}finally{hdr.dispose();target.dispose();}
  const image=new ImageData(width,height),row=width*4;for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-1-y)*row,(height-y)*row),y*row);return image;
 }
 /** Resolves when the full photograph of the open map is drawn (or after `timeout` ms). */
 whenSharp(timeout=20000){
  return new Promise(resolve=>{const t0=performance.now(),check=()=>{if(this.photo?.state==='sharp')resolve(this.photo);else if(performance.now()-t0>timeout)resolve(null);else setTimeout(check,30);};check();});
 }
 /** Kept for tools that used to time the blocking photograph: it is now a few tasks, so this resolves when they are done. */
 photograph(){return this.whenSharp();}
 /** The pixels of a render target, without stalling the page for the GPU (a blocking read where the browser cannot fence). */
 async read(target,width,rows,y,u8){
  const r=this.renderer;
  if(this.asyncRead!==false&&r.readRenderTargetPixelsAsync){try{await r.readRenderTargetPixelsAsync(target,0,y,width,rows,u8);return;}catch{this.asyncRead=false;}}
  r.readRenderTargetPixels(target,0,y,width,rows,u8);
 }
 /** Photographs `rect` at width×height into ctx in bands, one task each with a frame between; false when cancelled (closed, world changed). */
 async shoot({rect,width,height,ctx,sunBounds,start=0,live,onBand}){
  const r=this.renderer,bands=clamp(Math.ceil(width*height/BAND_PIXELS),1,MAX_BANDS),per=Math.ceil(height/bands);
  const buffer=this.buffer=this.buffer?.width===width&&this.buffer.height>=per?this.buffer:new ImageData(width,per),spare=this.spare=this.spare?.length===width*4?this.spare:new Uint8Array(width*4);
  const hdr=new THREE.WebGLRenderTarget(width,per,{type:THREE.HalfFloatType,samples:4}),target=new THREE.WebGLRenderTarget(width,per);let seen=-1;
  try{
   for(let i=start;i<bands;i++){
    if(!live())return false;
    const y0=i*per,rows=Math.min(per,height-y0);
    // Something else drew since the last band (the game, another photograph): the shadow map is no longer ours.
    this.exposeBand(rect,width,height,y0,per,sunBounds,r.info.render.frame!==seen,hdr,target);seen=r.info.render.frame;
    const u8=new Uint8Array(buffer.data.buffer,buffer.data.byteOffset,width*rows*4);
    await this.read(target,width,rows,per-rows,u8);if(!live())return false;
    flipRows(u8,width,rows,spare);ctx.putImageData(buffer,0,y0,0,0,width,rows);onBand?.(i,bands,u8);
    if(i<bands-1)await frame();
   }
   return true;
  }finally{hdr.dispose();target.dispose();}
 }
 /** Works through what the open map still needs, one stage at a time: warm shaders, small photograph, full photograph, detail. */
 async pump(){
  if(this.pumping)return;this.pumping=true;
  try{
   while(this.isOpen&&this.photo){
    const p=this.photo,gen=this.gen,live=()=>this.isOpen&&this.gen===gen&&this.photo===p;
    // Each stage returns when done or when the map closed / the world changed; either way look again at what is current (a newer photograph may be waiting).
    if(p.state==='pending'){await this.drawPreview(p,live);if(live()&&p.state==='pending')break;continue;}
    if(p.state==='preview'){await this.drawFull(p,live);if(live()&&p.state!=='sharp')break;continue;}
    const want=this.detailWanted();if(!want)break;
    await this.drawDetail(want,live);
   }
  }catch(error){console.warn('The map could not be photographed.',error);}
  finally{this.pumping=false;if(this.photo?.state==='sharp'||!this.isOpen)this.buffer=this.spare=null;}
 }
 async drawPreview(p,live){
  const w=p.bounds.maxX-p.bounds.minX,d=p.bounds.maxZ-p.bounds.minZ,width=Math.round(w>=d?PREVIEW_LONG:PREVIEW_LONG*w/d),height=Math.round(w>=d?PREVIEW_LONG*d/w:PREVIEW_LONG);
  // The first open waits (without blocking) for the render-target shader variants if the idle warm-up has not finished.
  await this.prewarm({urgent:true});await frame();if(!live())return;   // a frame between laying the map out and the first render: the dialog and its places are presented first
  this.preview.width=width;this.preview.height=height;const ctx=this.preview.getContext('2d',{alpha:false});let sea=null;
  const done=await this.shoot({rect:p.bounds,width,height,ctx,sunBounds:p.bounds,live,onBand:(i,n,u8)=>{sea=[u8[0],u8[1],u8[2]];}});
  if(!done||!live())return;
  // The open sea at the photograph's corner continues past its edges.
  if(sea)this.stage.style.background=`rgb(${sea[0]},${sea[1]},${sea[2]})`;
  p.state='preview';this.stage.removeAttribute('aria-busy');this.dialog.dataset.photo='ready';
 }
 async drawFull(p,live){
  const ctx=this.base.getContext('2d',{alpha:false});
  const done=await this.shoot({rect:p.bounds,width:p.width,height:p.height,ctx,sunBounds:p.bounds,start:p.band,live,onBand:i=>{p.band=i+1;}});
  if(!done||!live())return;
  p.state='sharp';this.base.classList.add('ready');
  const hide=()=>{if(this.photo===p)this.preview.hidden=true;this.base.removeEventListener('transitionend',hide);};this.base.addEventListener('transitionend',hide);setTimeout(hide,400);
 }
 /** The rectangle (plane px) worth re-photographing for the view, or null: not zoomed, still settling, or the detail we have already covers it. */
 detailWanted(){
  const v=this.view;if(v.zoom<=DETAIL_AFTER||!this.photo||this.photo.state!=='sharp'||performance.now()-this.viewChanged<150)return null;
  const dpr=Math.min(2,devicePixelRatio||1),cap=coarse()?1536:2048,vw=this.sw/v.zoom,vh=this.sh/v.zoom;
  const x0=Math.max(0,v.cx-vw/2),x1=Math.min(this.fw,v.cx+vw/2),y0=Math.max(0,v.cy-vh/2),y1=Math.min(this.fh,v.cy+vh/2),have=this.detailInfo;
  // Screen resolution, or as much of it as the pixel budget allows.
  const need=Math.min(v.zoom*dpr,cap/(x1-x0),cap/(y1-y0));
  if(have&&have.x0<=x0+.5&&have.x1>=x1-.5&&have.y0<=y0+.5&&have.y1>=y1-.5&&have.density>=need*.9)return null;
  // A little beyond the view while the budget allows, so a small pan is already covered.
  const ex=clamp((cap/need-(x1-x0))/2,0,(x1-x0)*.15),ey=clamp((cap/need-(y1-y0))/2,0,(y1-y0)*.15);
  const rx0=Math.max(0,x0-ex),rx1=Math.min(this.fw,x1+ex),ry0=Math.max(0,y0-ey),ry1=Math.min(this.fh,y1+ey);
  const width=Math.min(cap,Math.round((rx1-rx0)*need)),height=Math.min(cap,Math.round((ry1-ry0)*need));if(width<8||height<8)return null;
  return {x0:rx0,x1:rx1,y0:ry0,y1:ry1,width,height,density:Math.min(width/(rx1-rx0),height/(ry1-ry0))};
 }
 async drawDetail(d,live){
  const b=this.photo.bounds,wx=px=>b.minX+px/this.fw*(b.maxX-b.minX),wz=py=>b.minZ+py/this.fh*(b.maxZ-b.minZ),back=this.details[1-this.front],front=this.details[this.front];
  back.hidden=true;back.width=d.width;back.height=d.height;
  const done=await this.shoot({rect:{minX:wx(d.x0),maxX:wx(d.x1),minZ:wz(d.y0),maxZ:wz(d.y1)},width:d.width,height:d.height,ctx:back.getContext('2d',{alpha:false}),sunBounds:b,live:()=>live()&&this.view.zoom>DETAIL_AFTER});
  if(!done)return;
  Object.assign(back.style,{left:d.x0+'px',top:d.y0+'px',width:(d.x1-d.x0)+'px',height:(d.y1-d.y0)+'px'});back.hidden=false;front.hidden=true;this.front=1-this.front;this.detailInfo=d;
 }
 releaseDetail(){this.detailInfo=null;this.details.forEach(c=>{c.hidden=true;c.width=c.height=1;});}
 /* ---- view ---------------------------------------------------------------- */
 /** The stage's padding box: where the plane and the pins live (its border is 1 px). */
 layout(){
  const s=this.stage,was=this.fw;this.sw=s.clientWidth;this.sh=s.clientHeight;if(!this.photo)return;
  const fit=Math.min(this.sw/this.photo.width,this.sh/this.photo.height);this.fw=this.photo.width*fit;this.fh=this.photo.height*fit;Object.assign(this.plane.style,{width:this.fw+'px',height:this.fh+'px'});
  // The same part of the island stays in view when the stage is resized.
  if(was&&this.fw!==was){const k=this.fw/was;this.view.cx*=k;this.view.cy*=k;}
 }
 /** Viewport px of the stage's padding-box corner. */
 origin(){const r=this.stage.getBoundingClientRect();return [r.left+this.stage.clientLeft,r.top+this.stage.clientTop];}
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
 /** The view is clamped at once (hit tests see it) and drawn once per frame, however many gesture events came. */
 apply(now=false){
  if(!this.photo)return;this.clampView();this.viewChanged=performance.now();
  if(now){cancelAnimationFrame(this.raf);this.raf=0;this.flush();return;}
  if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;if(this.isOpen&&this.photo)this.flush();});
 }
 flush(){
  const v=this.view;
  this.plane.style.transform=`translate(${this.sw/2-v.cx*v.zoom}px,${this.sh/2-v.cy*v.zoom}px) scale(${v.zoom})`;
  this.placePins();this.renderScale();
  // A sharper photograph of just what is on screen, once the gesture has settled and the machine is idle.
  clearTimeout(this.detailTimer);
  if(v.zoom>DETAIL_AFTER)this.detailTimer=setTimeout(()=>idle(()=>this.pump(),500),180);else if(this.detailInfo)this.releaseDetail();
 }
 renderScale(){
  const b=this.photo.bounds,metresPerPx=(b.maxX-b.minX)/this.fw/this.view.zoom,steps=[5,10,20,25,50,100,200];let metres=steps.find(m=>m/metresPerPx>=70)??200;
  const width=Math.round(metres/metresPerPx)+'px',text=metres+' m';if(this.scaleBar.style.width!==width)this.scaleBar.style.width=width;if(this.scaleText.textContent!==text)this.scaleText.textContent=text;
 }
 /* ---- markers ------------------------------------------------------------- */
 /** The places of the world, kept with the photograph; refreshMarkers() re-reads them once the map is on screen. */
 collectMarkers(known){
  const player=this.getPlayer?.();if(known)return {places:known,player};
  const list=(this.getMarkers?.()??[]).filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.z)),places=[];
  // Prompts a few metres apart (four contact links on one sign) read as one place on a map.
  for(const m of list){const near=m.kind==='activity'&&places.find(o=>o.kind==='activity'&&Math.hypot(o.x-m.x,o.z-m.z)<5);if(near){near.members.push(m.name);near.name=`${near.members[0]} +${near.members.length-1}`;near.description=near.members.join(', ');}else places.push({...m,members:[m.name]});}
  this.places=places;return {places,player};
 }
 /** Prompts hide and show while the game is played: look again, in idle time, and redraw the pins only if a place came or went. */
 refreshMarkers(){
  if(!this.isOpen||!this.photo)return;const key=l=>l.map(m=>`${m.id}|${m.name}|${Math.round(m.x)}|${Math.round(m.z)}`).join(';'),before=key(this.markers.places);this.places=null;
  const fresh=this.collectMarkers();if(key(fresh.places)===before){this.markers.places=fresh.places;this.places=fresh.places;return;}
  this.markers=fresh;this.renderLegend();this.buildPins();this.apply(true);
 }
 renderLegend(){
  const counts={};for(const m of this.markers.places)counts[m.kind]=(counts[m.kind]??0)+1;
  this.legend.replaceChildren(el('li',{},el('b',{class:'atlas-key atlas-key-player'}),'You are here'),...Object.entries(KINDS).filter(([k])=>counts[k]).map(([k,v])=>el('li',{},el('b',{class:'atlas-key',style:`background:${v.color}`}),`${v.label} · ${counts[k]}`)));
  this.status.textContent=`${this.markers.places.length} places · north is up${this.travelling?' · select one to travel there':''}`;
 }
 /** One element per place for as long as the map is open (focus survives panning and zooming), in reading order for Tab. */
 buildPins(){
  const travel=this.travelling,byPlace=new Map();
  for(const m of this.markers.places){const label=m.description?`${m.name} — ${m.description}`:m.name,pin=el(travel?'button':'div',travel?{type:'button',class:`atlas-pin atlas-pin-${m.kind}`,'aria-label':`Travel to ${label}`,title:`Travel to ${label}`}:{class:`atlas-pin atlas-pin-${m.kind}`,title:label},el('i',{'aria-hidden':'true',text:m.icon??''}),el('span',{text:m.name,'aria-hidden':travel?'true':null})),rec={m,pin,x:0,y:0,off:false,gone:null,side:null,place:'',label:null,at:'',lw:m.name.length*6+16,r:dotClearance(m.kind),hit:9,hitSet:null};pin.style.setProperty('--pin',KINDS[m.kind]?.color??'#333');if(travel)pin.addEventListener('click',e=>{e.stopPropagation();if(performance.now()<this.suppressUntil)return;this.travel(m,[rec.x,rec.y]);});byPlace.set(m,rec);}
  // Labels are handed out in rank order, and a tie keeps the order the world lists its places in; only the DOM (and so Tab) reads north to south.
  this.ranked=rankPlaces(this.markers.places).map(m=>byPlace.get(m));this.pinEls=readingOrder(this.markers.places).map(m=>byPlace.get(m));
  // The order they are painted in (atlas.css raises the round pins of areas and places over the diamonds of activities): what hitMargins needs.
  this.paintEls=[...this.pinEls.filter(r=>r.m.kind==='activity'),...this.pinEls.filter(r=>r.m.kind!=='activity')];
  this.playerEl=this.markers.player?el('div',{class:'atlas-player',role:'img','aria-label':'You are here'}):null;this.playerAt='';
  this.pins.replaceChildren(...this.pinEls.map(p=>p.pin),...(this.playerEl?[this.playerEl]:[]));
  this.measureLabels();
 }
 /** The width of every label as the browser sets it (type, weight and padding from the page's own style: a webfont arriving later measures again). */
 measureLabels(){
  const span=this.pinEls?.[0]?.pin.querySelector?.('span');if(!span||!globalThis.getComputedStyle)return;
  const cs=getComputedStyle(span),ctx=(this.measurer??=document.createElement('canvas').getContext('2d')),pad=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);
  ctx.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  for(const rec of this.pinEls)rec.lw=Math.ceil(ctx.measureText(rec.m.name).width+pad)+1;
 }
 /** Pins move by transform only (no layout), and only when they moved. Their labels are placed anew every time (placeLabels), and on a touch screen
  * each pin's invisible margin is cut back where it would cover another pin's dot (hitMargins). */
 placePins(){
  const ranked=this.ranked;if(!ranked)return;
  const player=this.markers.player,arrow=player?(this.arrow??={x:0,y:0}):null;if(arrow){const [x,y]=this.toScreen(player.x,player.z);arrow.x=x;arrow.y=y;}
  for(const rec of ranked){const [x,y]=this.toScreen(rec.m.x,rec.m.z);rec.x=x;rec.y=y;rec.off=x<-20||y<-20||x>this.sw+20||y>this.sh+20;}
  placeLabels(ranked,{width:this.sw,height:this.sh,arrow});
  const touch=!!(this.touchQuery??=globalThis.matchMedia?.('(pointer:coarse)'))?.matches;if(touch)hitMargins(this.paintEls);
  for(const rec of ranked){
   const {pin,x,y}=rec;
   if(rec.off){if(rec.gone!==true){if(pin===document.activeElement)this.stage.focus({preventScroll:true});pin.hidden=true;rec.gone=true;}continue;}
   if(rec.gone!==false){pin.hidden=false;rec.gone=false;}
   // A place without a label shows it on hover or focus, on its right, or on its left near the right edge of the map.
   const showLabel=rec.side!==null,place=showLabel?rec.side:x+DOT+SIDE_GAP+rec.lw>this.sw-6?'left':'right';
   const at=place==='left'?`translate(calc(${Math.round(x)+7}px - 100%),${Math.round(y)-7}px)`:`translate(${Math.round(x)-7}px,${Math.round(y)-7}px)`;
   if(rec.at!==at){pin.style.transform=at;rec.at=at;}
   if(rec.label!==showLabel){pin.dataset.label=showLabel?'true':'false';rec.label=showLabel;}
   if(rec.place!==place){pin.dataset.side=place;rec.place=place;}
   if(touch&&rec.hitSet!==rec.hit){pin.style.setProperty('--hit',rec.hit+'px');rec.hitSet=rec.hit;}
  }
  if(player&&this.playerEl){const [x,y]=this.toScreen(player.x,player.z),deg=-Math.atan2(-player.dz,player.dx)*180/Math.PI+90,at=`translate(${x}px,${y}px) translate(-50%,-50%) rotate(${deg}deg)`;if(at!==this.playerAt){this.playerEl.style.transform=at;this.playerAt=at;}}
 }
 /* ---- warm-up ------------------------------------------------------------- */
 /** Compiles the scene's render-target shader variants in small idle slices (three builds a second set when it draws off screen), then the tone-mapping pass:
  * the first photograph then finds everything ready. Idempotent; `urgent` (the map is open and waiting) runs the slices at frame pace. */
 prewarm({urgent=false}={}){
  if(urgent&&!this.urgent){this.urgent=true;this.wake?.();}
  return this.warming??=this.warm().catch(error=>console.warn('The map could not warm its shaders.',error));
 }
 tick(){return this.urgent?frame(80):new Promise(resolve=>{const done=()=>{if(this.wake===done)this.wake=null;resolve();};this.wake=done;idle(done,700);});}
 async warm(){
  const r=this.renderer,scene=this.scene,parallel=!!r.extensions?.has?.('KHR_parallel_shader_compile'),cam=new THREE.OrthographicCamera(-10,10,10,-10,1,100);cam.layers.set(0);
  await this.tick();this.bounds();                               // the footprint scan
  await this.tick();if(!this.places)this.collectMarkers();         // the places (re-read in idle time when the map opens)
  await this.tick();
  // One representative per distinct (material, geometry layout) among what a photograph can see.
  const reps=[],seen=new Set();
  scene.traverseVisible(o=>{
   if(!(o.isMesh||o.isPoints||o.isLine||o.isSprite)||!o.material||!o.layers.test(cam.layers))return;
   const g=o.geometry?.attributes??{},m=o.geometry?.morphAttributes??{},key=[o.material].flat().map(x=>x.uuid).join()+(o.isInstancedMesh?'i'+(o.instanceColor?'c':'')+(o.morphTexture?'m':''):'')+(o.isBatchedMesh?'b':'')+(o.isSkinnedMesh?'s':'')+Object.keys(m).join('')+(g.color?'v'+g.color.itemSize:'')+(g.uv?'u':'')+(g.uv1?'1':'')+(g.uv2?'2':'')+(g.uv3?'3':'')+(g.tangent?'t':'')+(g.normal?'':'n')+(o.isPoints?'p':o.isLine?'l':o.isSprite?'x':'');
   if(!seen.has(key)){seen.add(key);reps.push(o);}
  });
  const rt=new THREE.WebGLRenderTarget(16,16,{type:THREE.HalfFloatType}),programs=new Set();
  try{
   for(let i=0;i<reps.length;){
    await this.tick();const t0=performance.now(),budget=this.urgent?10:3.5,previous=r.getRenderTarget(),fog=scene.fog;
    r.setRenderTarget(rt);scene.fog=null;
    try{while(i<reps.length&&performance.now()-t0<budget){for(const material of r.compile(reps[i++],cam,scene)){const program=r.properties.get(material).currentProgram;if(program)programs.add(program);}}}
    finally{scene.fog=fog;r.setRenderTarget(previous);}
   }
   // Parallel compile: wait for the GPU process to finish linking; without it the program is "ready" at once and links on first use, so link it here, a few at a time.
   while(programs.size){
    await this.tick();const t0=performance.now(),budget=this.urgent?10:3.5;
    for(const program of programs){if(!program.isReady())continue;try{program.getUniforms();}catch{/* a failed link surfaces when it is used */}programs.delete(program);if(performance.now()-t0>budget)break;}
    if(programs.size&&parallel)await new Promise(resolve=>setTimeout(resolve,this.urgent?8:30));
   }
   // The tone-mapping pass and the first uses of a half-float target.
   await this.tick();const hdr=new THREE.WebGLRenderTarget(16,16,{type:THREE.HalfFloatType}),target=new THREE.WebGLRenderTarget(16,16),previous=r.getRenderTarget();
   try{this.output??=new OutputPass();r.setRenderTarget(hdr);r.clear();this.output.render(r,target,hdr);}finally{r.setRenderTarget(previous);hdr.dispose();target.dispose();}
  }finally{rt.dispose();}
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
  on(s,'wheel',e=>{e.preventDefault();if(!this.photo)return;const [ox,oy]=this.origin(),f=Math.exp(-e.deltaY*(e.deltaMode===1?.05:.0016));this.zoomAt(f,e.clientX-ox,e.clientY-oy);},{passive:false});
  on(s,'pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pointers.size===1){press={id:e.pointerId,x:e.clientX,y:e.clientY,type:e.pointerType,dragging:false,gesture:false};last=null;}
   else{if(press)press.gesture=true;const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)};for(const id of pointers.keys())capture(id);}});
  on(s,'pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y),[ox,oy]=this.origin();if(pinch.d>0&&this.photo)this.zoomAt(d/pinch.d,(a.x+b.x)/2-ox,(a.y+b.y)/2-oy);pinch.d=d;return;}
   if(!press||e.pointerId!==press.id||press.gesture)return;
   // Only past the threshold does a press become a drag (and the pointer get captured): below it, it is still a click.
   if(!press.dragging&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>(DRAG[press.type]??6)){press.dragging=true;last={x:press.x,y:press.y};capture(e.pointerId);s.classList.add('dragging');}
   if(press.dragging&&this.photo){this.pan(e.clientX-last.x,e.clientY-last.y);last={x:e.clientX,y:e.clientY};}});
  const end=e=>{if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
   // The click a browser sends straight after a drag or a pinch is not a choice of destination.
   if(press&&(press.dragging||press.gesture||e.type==='pointercancel'))this.suppressUntil=performance.now()+120;
   if(!pointers.size){press=null;last=null;s.classList.remove('dragging');}};
  on(s,'pointerup',end);on(s,'pointercancel',end);
  on(s,'click',e=>{if(!this.travelling||!this.photo||performance.now()<this.suppressUntil||e.target.closest?.('.atlas-pin'))return;const [ox,oy]=this.origin(),sx=e.clientX-ox,sy=e.clientY-oy,p=this.toWorld(sx,sy);if(!p.inside){this.say('Can’t drive there — outside the island',sx,sy);return;}this.travel({kind:'point',x:p.x,z:p.z,name:null},[sx,sy]);});
  // Keys while the map is open belong to the map: they never reach the car or the editor.
  on(window,'keydown',e=>{
   if(!this.isOpen)return;const k=e.code;
   if(k==='Escape'||k==='KeyM'||k==='Tab'&&!this.dialog.contains(document.activeElement)){e.preventDefault();e.stopImmediatePropagation();this.close();return;}
   if(k==='Tab'){const f=[...this.dialog.querySelectorAll('button,[tabindex="0"]')].filter(n=>!n.hidden&&!n.disabled&&n.offsetParent!==null);const i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1]?.focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0]?.focus();}e.stopImmediatePropagation();return;}
   // Enter and Space reach a focused button as its own activation (they are not prevented here): a place travels.
   const step=60,moves={ArrowLeft:[step,0],KeyA:[step,0],ArrowRight:[-step,0],KeyD:[-step,0],ArrowUp:[0,step],KeyW:[0,step],ArrowDown:[0,-step],KeyS:[0,-step]};
   if(moves[k]){e.preventDefault();if(this.photo)this.pan(...moves[k]);}else if(this.photo&&(k==='Equal'||k==='NumpadAdd'))this.zoomAt(1.5);else if(this.photo&&(k==='Minus'||k==='NumpadSubtract'))this.zoomAt(1/1.5);else if(this.photo&&k==='Digit0')this.fit();
   e.stopImmediatePropagation();
  },{capture:true});
 }
 dispose(){this.close();this.gen++;this.output?.dispose();clearTimeout(this.detailTimer);clearTimeout(this.feedbackTimer);this.disposers.forEach(d=>d());this.disposers=[];}
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
