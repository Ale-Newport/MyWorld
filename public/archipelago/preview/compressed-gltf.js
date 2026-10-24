import {fetchEarly} from './early-fetch.js';
/** Counts the bytes of a stream as they pass: the download's progress, measured before any decompression. The last call says `done`. */
export function countBytes(stream,onChunk){
 let loaded=0;
 return stream.pipeThrough(new TransformStream({transform(chunk,controller){loaded+=chunk.byteLength;onChunk(loaded,false);controller.enqueue(chunk);},flush(){onChunk(loaded,true);}}));
}
/** Where the bytes of `bytes` are 0x80 or more: [start, end, start, end, ...] of each run. Four bytes are tested at a time while nothing is wide. */
export function wideRuns(bytes){
 const runs=[],n=bytes.length;let i=0,open=-1;
 if((bytes.byteOffset&3)===0){
  const words=new Uint32Array(bytes.buffer,bytes.byteOffset,n>>>2);
  for(let w=0;w<words.length;w++){
   if(open<0&&(words[w]&0x80808080)===0)continue;
   for(let k=w*4,stop=k+4;k<stop;k++){const wide=bytes[k]>=0x80;if(wide&&open<0)open=k;else if(!wide&&open>=0){runs.push(open,k);open=-1;}}
  }
  i=words.length*4;
 }
 for(;i<n;i++){const wide=bytes[i]>=0x80;if(wide&&open<0)open=i;else if(!wide&&open>=0){runs.push(open,i);open=-1;}}
 if(open>=0)runs.push(open,n);
 return runs;
}
/** JSON text in UTF-8 with its non-ASCII characters (which can only be inside strings) written as \uXXXX escapes: the same value when parsed. */
export function escapeWideBytes(bytes,decoder=new TextDecoder('utf-8',{ignoreBOM:true})){
 const runs=wideRuns(bytes);if(!runs.length)return bytes;
 const texts=[];let extra=0;
 for(let r=0;r<runs.length;r+=2){const text=decoder.decode(bytes.subarray(runs[r],runs[r+1]));let escaped='';for(let u=0;u<text.length;u++)escaped+='\\u'+text.charCodeAt(u).toString(16).padStart(4,'0');texts.push(escaped);extra+=escaped.length-(runs[r+1]-runs[r]);}
 const out=new Uint8Array(bytes.length+extra);let at=0,from=0;
 for(let r=0,t=0;r<runs.length;r+=2,t++){out.set(bytes.subarray(from,runs[r]),at);at+=runs[r]-from;const text=texts[t];for(let u=0;u<text.length;u++)out[at++]=text.charCodeAt(u);from=runs[r+1];}
 out.set(bytes.subarray(from),at);
 return out;
}
/** The world document is ASCII but for a few hundred characters (82 symbols and emoji among 33 million), and one wide character makes a string two bytes
 * wide all through: 66 MB of text to parse a 33 MB document. Escaped on the way in (a character is never split between two chunks: a run of wide bytes at the
 * end of a chunk waits for the next one), the text is a one-byte string and parses to the same value. */
const BOM=[0xEF,0xBB,0xBF];
export function escapeWideCharacters(stream){
 let held=null,first=true;const decoder=new TextDecoder('utf-8',{ignoreBOM:true});
 return stream.pipeThrough(new TransformStream({
  transform(chunk,controller){
   let bytes=chunk;
   if(held){const joined=new Uint8Array(held.length+bytes.length);joined.set(held);joined.set(bytes,held.length);bytes=joined;held=null;}
   if(first&&bytes.length){
    // The byte order mark is only the first three bytes of the stream: a first chunk too short to tell waits for the next, and one that cannot be a mark ends the looking.
    if(bytes.length<3&&bytes.every((b,i)=>b===BOM[i])){held=bytes.slice();return;}
    first=false;if(bytes.length>=3&&bytes[0]===BOM[0]&&bytes[1]===BOM[1]&&bytes[2]===BOM[2])bytes=bytes.subarray(3);
   }
   let end=bytes.length;while(end>0&&bytes[end-1]>=0x80)end--;
   if(end<bytes.length){held=bytes.slice(end);bytes=bytes.subarray(0,end);}
   if(bytes.length)controller.enqueue(escapeWideBytes(bytes,decoder));
  },
  flush(controller){if(held)controller.enqueue(escapeWideBytes(held,decoder));},
 }));
}
/* The island's models arrive as scripts/world/compress-models.mjs wrote them: meshopt-compressed, positions/normals/uvs quantised, images
   WebP. inflateGLB turns one back into the ordinary GLB the Blender export is (Float32 attributes, the same accessors, indices and
   nodes) before GLTFLoader reads it, so every consumer (physics colliders, batch(), prefab terrain, the loader's own bounds) keeps
   seeing Float32 `.array`s. A plain GLB passes through untouched. */
const GLB_MAGIC=0x46546c67,JSON_CHUNK=0x4e4f534a,BIN_CHUNK=0x004e4942;
const PACK='PORTFOLIO_range_quantization',MESHOPT='EXT_meshopt_compression',OURS=[MESHOPT,'KHR_mesh_quantization',PACK,'EXT_texture_webp'];
const ELEMENTS={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},COMPONENT_BYTES={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
let decoder=null;
/** Runs `load(attempt)` until it succeeds, `tries` times at most, pausing a little longer after each failure. A browser remembers a module whose fetch failed
 * (the same URL fails again without a request), so every attempt has to ask for its own URL. */
export async function withRetries(load,tries=3,pause=300){for(let attempt=0;;attempt++){try{return await load(attempt);}catch(error){if(attempt+1>=tries)throw error;await new Promise(resolve=>setTimeout(resolve,pause*(attempt+1)));}}}
/** The decoder module as the page's import map resolves it; a repeat attempt adds a query. */
const decoderURL=attempt=>{const name='three/addons/libs/meshopt_decoder.module.js';let url=name;try{url=import.meta.resolve(name);}catch{}return attempt?url+'?attempt='+attempt:url;};
/** three's build of meshoptimizer's decoder (a 29 KB wasm module). Started when this module loads, so it is ready by the time a model has downloaded;
 * it is a dynamic import so that it stays off the page's critical module graph, and a failed fetch is tried again before the island gives up. */
export function meshoptDecoder(){return decoder??=withRetries(attempt=>import(decoderURL(attempt))).then(m=>m.MeshoptDecoder,error=>{decoder=null;throw error;});}
meshoptDecoder().catch(()=>{});
export function splitGLB(bytes){
 const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
 if(u8.length<20||view.getUint32(0,true)!==GLB_MAGIC)throw Error('Not a GLB file');
 let offset=12,json=null,bin=null;
 while(offset+8<=u8.length){const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true),start=offset+8;
  if(type===JSON_CHUNK)json=JSON.parse(new TextDecoder().decode(u8.subarray(start,start+length)));else if(type===BIN_CHUNK&&!bin)bin=u8.subarray(start,start+length);
  offset=start+((length+3)&~3);}
 return {json,bin:bin??new Uint8Array(0)};
}
const yieldNow=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();resolve();};channel.port2.postMessage(0);});
/** `getDecoder()` is only called for a file that needs it. Resolves to an ArrayBuffer holding an ordinary GLB. */
export async function inflateGLB(bytes,getDecoder=meshoptDecoder){
 const {json,bin}=splitGLB(bytes);
 if(!json.extensionsUsed?.includes(PACK))return bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const decode=await getDecoder();await decode.ready;
 const views=json.bufferViews??[],accessors=json.accessors??[];
 // Which accessors read each compressed view, and what each becomes: normals (octahedral int16) and range-quantised (normalised uint16 with
 // extras.portfolioRange) accessors turn back into Float32; indices and Float32 attributes come out of the decoder as they were.
 const readers=new Map();
 accessors.forEach((a,i)=>{if(a.bufferView!==undefined&&views[a.bufferView]?.extensions?.[MESHOPT])(readers.get(a.bufferView)??readers.set(a.bufferView,[]).get(a.bufferView)).push(i);});
 // The plan: where every byte of the plain GLB's BIN chunk goes, and the JSON that describes it, are settled before anything is decoded,
 // so the decoder writes straight into the final buffer.
 const plan=new Map(),outViews=[],remap=new Map(),keep=[];let total=0,largest=0;
 const reserve=size=>{const at=total;total+=(size+3)&~3;return at;};
 views.forEach((view,v)=>{if(!readers.has(v)){const at=reserve(view.byteLength),{extensions,...rest}=view;keep.push([v,at]);remap.set(v,outViews.push({...rest,buffer:0,byteOffset:at})-1);}});
 for(const [v,list] of readers){
  const ext=views[v].extensions[MESHOPT];largest=Math.max(largest,ext.count*ext.byteStride);
  for(const i of list){
   const a=accessors[i],n=ELEMENTS[a.type],kind=ext.filter==='OCTAHEDRAL'?'normal':a.componentType===5123&&a.normalized&&a.extras?.portfolioRange?'range':'copy';
   if(kind==='copy'&&ext.byteStride!==n*COMPONENT_BYTES[a.componentType])throw Error('Unsupported packed accessor '+i);
   const size=kind==='copy'?ext.count*ext.byteStride:ext.count*(kind==='normal'?3:n)*4,at=reserve(size);
   plan.set(i,{at,size,kind,range:kind==='range'?a.extras.portfolioRange:null});
   if(kind!=='copy'){a.componentType=5126;delete a.normalized;if(kind==='range'){delete a.extras.portfolioRange;if(!Object.keys(a.extras).length)delete a.extras;}}
   a.bufferView=outViews.push({buffer:0,byteOffset:at,byteLength:size,...(views[v].target?{target:views[v].target}:{})})-1;
  }
 }
 accessors.forEach((a,i)=>{if(!plan.has(i)&&a.bufferView!==undefined)a.bufferView=remap.get(a.bufferView);});
 for(const image of json.images??[])if(image.bufferView!==undefined)image.bufferView=remap.get(image.bufferView);
 for(const texture of json.textures??[]){const webp=texture.extensions?.EXT_texture_webp;if(webp){texture.source=webp.source;delete texture.extensions.EXT_texture_webp;if(!Object.keys(texture.extensions).length)delete texture.extensions;}}
 json.bufferViews=outViews;json.buffers=[{byteLength:total}];
 for(const key of ['extensionsUsed','extensionsRequired']){if(!json[key])continue;json[key]=json[key].filter(name=>!OURS.includes(name));if(!json[key].length)delete json[key];}
 // The GLB: header, JSON chunk, BIN chunk (the BIN starts on a multiple of 4, so Float32Arrays can view it in place).
 const text=new TextEncoder().encode(JSON.stringify(json)),jsonLength=(text.length+3)&~3,binStart=28+jsonLength,glb=new Uint8Array(binStart+total),view=new DataView(glb.buffer);
 view.setUint32(0,GLB_MAGIC,true);view.setUint32(4,2,true);view.setUint32(8,glb.length,true);
 view.setUint32(12,jsonLength,true);view.setUint32(16,JSON_CHUNK,true);glb.set(text,20);glb.fill(0x20,20+text.length,20+jsonLength);
 view.setUint32(20+jsonLength,total,true);view.setUint32(24+jsonLength,BIN_CHUNK,true);
 for(const [v,at] of keep){const start=views[v].byteOffset||0;glb.set(bin.subarray(start,start+views[v].byteLength),binStart+at);}
 const scratch=new Uint8Array(largest);let slice=performance.now();
 for(const [v,list] of readers){
  const ext=views[v].extensions[MESHOPT],source=bin.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),count=ext.count;
  decode.decodeGltfBuffer(scratch.subarray(0,count*ext.byteStride),count,ext.byteStride,source,ext.mode,ext.filter);
  for(const i of list){
   const {at,size,kind,range}=plan.get(i),n=ELEMENTS[accessors[i].type];
   if(kind==='copy')glb.set(scratch.subarray(0,size),binStart+at);
   else if(kind==='normal'){
    const src=new Int16Array(scratch.buffer,0,count*4),dst=new Float32Array(glb.buffer,binStart+at,count*3);
    for(let j=0;j<count;j++){const x=src[j*4],y=src[j*4+1],z=src[j*4+2],scale=1/(Math.sqrt(x*x+y*y+z*z)||1);dst[j*3]=x*scale;dst[j*3+1]=y*scale;dst[j*3+2]=z*scale;}
   }else{
    const stride=ext.byteStride/2,src=new Uint16Array(scratch.buffer,0,count*stride),dst=new Float32Array(glb.buffer,binStart+at,count*n);
    for(let c=0;c<n;c++){const low=range.min[c],span=range.max[c]-low;for(let j=0;j<count;j++)dst[j*n+c]=low+src[j*stride+c]/65535*span;}
   }
  }
  if(performance.now()-slice>12){await yieldNow();slice=performance.now();}
 }
 return glb.buffer;
}
/** The models are still ordinary GLBs for the studio; the player downloads
 * smaller copies (gzip of meshopt-packed GLBs) and decodes them before handing bytes to GLTFLoader. */
export async function loadCompressedGLB(loader, url, onProgress) {
 const response = await fetchEarly(url);
 if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
 const total = Number(response.headers.get('content-length')) || 0;
 onProgress?.({ loaded: 0, total, done: false });
 const source = response.body ?? new Blob([await response.arrayBuffer()]).stream();
 const stream = countBytes(source, (loaded, done) => onProgress?.({ loaded, total, done })).pipeThrough(new DecompressionStream('gzip'));
 const bytes = await inflateGLB(await new Response(stream).arrayBuffer());
 return loader.parseAsync(bytes, new URL('.', new URL(url, location.href)).href);
}
