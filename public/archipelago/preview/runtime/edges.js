/* THE COLOURS AT THE EDGES OF THE PICTURE

   The browser's own bars on a phone should continue the world, not stand over it in the hedge's green. So this reads the
   colours along the top and the foot of the frame the world has just drawn — the average of its top row and of its bottom
   row — and tells the host (WorldRoute, `archipelago:edges`), which colours the two bands iOS Safari paints its strips from
   (top and foot: archipelago.module.css) and hands the top one to theme-color (Chrome's bar).

   Read from the drawing buffer right after the frame is drawn (it is not kept: preserveDrawingBuffer is off) into a pixel-pack
   buffer, fenced, and collected on a later frame once the fence has passed: the GPU is never waited on, the frame never
   stalls. Twice a second at most, and the host is told only when a colour has moved enough to see. While the map or a dialog
   is open nothing is drawn; the host is told the last colours under the same dim the page's scrim puts over the picture. */

/** The page's scrim over the world while the map or a dialog is open (portfolio-theme.css: rgba(26,23,18,.36)). */
const SCRIM=[26,23,18],SCRIM_ALPHA=.36;
/** Smallest change, summed over the three channels of either edge, worth telling the host about. */
const NOTICEABLE=9;

const hex=rgb=>'#'+rgb.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
const veiled=rgb=>rgb.map((v,i)=>v+(SCRIM[i]-v)*SCRIM_ALPHA);

/** Returns {sample(now), veil(on), dispose()} for a WebGL2 renderer, or null where the context cannot read back asynchronously. */
export function edgeSampler({renderer,post,interval=500}){
 const gl=renderer.getContext();
 if(typeof WebGL2RenderingContext==='undefined'||!(gl instanceof WebGL2RenderingContext))return null;
 const canvas=gl.canvas;
 let buffer=null,bytes=null,width=0,fence=null,next=0,top=null,bottom=null,told='',isVeiled=false;
 const tell=()=>{if(!top||!bottom)return;const colours=isVeiled?{top:hex(veiled(top)),bottom:hex(veiled(bottom))}:{top:hex(top),bottom:hex(bottom)};const key=colours.top+colours.bottom;if(key===told)return;told=key;post(colours);};
 /** The average colour of one row of the read-back bytes. */
 const average=offset=>{let r=0,g=0,b=0;for(let i=0;i<width;i++){const o=offset+i*4;r+=bytes[o];g+=bytes[o+1];b+=bytes[o+2];}return [r/width,g/width,b/width];};
 const moved=(a,b)=>!b||Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2])>=NOTICEABLE;
 const reset=()=>{buffer=null;fence=null;width=0;};
 canvas.addEventListener('webglcontextrestored',reset);
 const collect=()=>{
  const status=gl.clientWaitSync(fence,0,0);
  if(status===gl.TIMEOUT_EXPIRED)return;
  gl.deleteSync(fence);fence=null;
  if(status===gl.WAIT_FAILED)return;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,bytes);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  // GL's rows count from the bottom: the first row read is the picture's foot, the second its top.
  const foot=average(0),head=average(width*4);
  if(moved(head,top)||moved(foot,bottom)){top=head;bottom=foot;tell();}
 };
 const read=()=>{
  const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  if(w<2||h<4)return;
  if(!buffer||w!==width){
   if(buffer)gl.deleteBuffer(buffer);
   buffer=gl.createBuffer();width=w;bytes=new Uint8Array(w*4*2);
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,bytes.byteLength,gl.STREAM_READ);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  }
  // One row in from each edge: the outermost can carry the antialiasing of the canvas's border.
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);
  gl.readPixels(0,1,w,1,gl.RGBA,gl.UNSIGNED_BYTE,0);
  gl.readPixels(0,h-2,w,1,gl.RGBA,gl.UNSIGNED_BYTE,w*4);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  gl.flush();
 };
 return {
  /** Right after a frame is drawn into the canvas. */
  sample(now){
   if(gl.isContextLost())return;
   if(isVeiled){isVeiled=false;tell();}
   if(fence){collect();return;}
   if(now<next)return;
   next=now+interval;
   read();
  },
  /** The map or a dialog is (not) over the picture. */
  veil(on){if(on===isVeiled)return;isVeiled=on;tell();},
  dispose(){canvas.removeEventListener('webglcontextrestored',reset);if(gl.isContextLost())return;if(fence)gl.deleteSync(fence);if(buffer)gl.deleteBuffer(buffer);reset();},
 };
}
