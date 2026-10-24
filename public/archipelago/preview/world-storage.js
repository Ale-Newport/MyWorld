import {fetchEarly,fetchReleaseFile} from './early-fetch.js';
import {countBytes,escapeWideCharacters} from './compressed-gltf.js';
/** The authored Archipelago is the only editable and published world. */
export const WORLD_SLOTS={archipelago:'Archipiélago'};
export const PLAYER_MODE=typeof document!=='undefined'&&document.body.dataset.player==='true';
/* Where the world comes from. The public player asks the portfolio which
   revision is published (/api/world/release); the admin's studio page sets
   ARCHIPELAGO_CONFIG to its authenticated draft endpoints instead. Either
   way the files are named by content hash. */
export const CMS_CONFIG=(typeof globalThis!=='undefined'&&globalThis.ARCHIPELAGO_CONFIG)||{};
let release=null;
let releasePromise=null;
export async function loadRelease(){
 if(release)return release;
 // index.html asks for the release while the module graph downloads; this takes that answer.
 releasePromise??=fetchEarly(CMS_CONFIG.release??'/api/world/release',{credentials:'same-origin',cache:'no-cache'}).then(async response=>{
  if(!response.ok)throw Error(`The published world could not be read (${response.status})`);
  release=await response.json();return release;
 }).catch(error=>{releasePromise=null;throw error;});
 return releasePromise;
}
export function setRelease(next){release=next;releasePromise=Promise.resolve(next);worldDocumentPromise=null;assetDefinitionsPromise=null;}
export function worldFiles(){
 const id='archipelago';
 return {id,name:WORLD_SLOTS[id],folder:'portfolio',world:release?.world.url,assets:release?.assets.url,revision:release?.revision??null};
}
/** The player reports how many bytes of each large file have arrived (compressed), for an honest progress bar. */
let downloadObserver=null;
export function observeWorldDownloads(fn){downloadObserver=fn;}
/* The text goes to the parser escaped to ASCII (escapeWideCharacters): the document has 82 symbols and emoji among its 33 million characters, and with
   them the text is a two-byte string, 66 MB while it is parsed, instead of 33 MB. The value that comes out is the same. */
async function body(response,key,size=0){
 if(!response.body)return response.json();
 let stream=response.body;
 if(downloadObserver){
  const total=Number(response.headers.get('content-length'))||size;downloadObserver(key,0,total,false);
  stream=countBytes(stream,(loaded,done)=>downloadObserver(key,loaded,total,done));
 }
 if(response.headers.get('content-type')?.includes('gzip'))stream=stream.pipeThrough(new DecompressionStream('gzip'));
 return new Response(escapeWideCharacters(stream)).json();
}
let worldDocumentPromise=null,assetDefinitionsPromise=null;
/* The two large files are asked for separately: a player that has let go of one (below) must not start the other again by asking for it. */
function startDocument(){
 if(worldDocumentPromise)return;
 downloadObserver?.('doc',0,release?.world.size??0,false);
 worldDocumentPromise=fetchReleaseFile('world',worldFiles().world,{credentials:'same-origin'}).then(response=>{
  if(!response.ok)throw Error(`No se pudo cargar Archipiélago (${response.status})`);
  return body(response,'doc',release?.world.size);
 });
 // The editor awaits the promise later; observing an early failure here prevents a rejected download from surfacing as an unhandled rejection.
 void worldDocumentPromise.catch(()=>{});
}
function startDefinitions(){
 if(assetDefinitionsPromise)return;
 downloadObserver?.('defs',0,release?.assets.size??0,false);
 assetDefinitionsPromise=fetchReleaseFile('assets',worldFiles().assets,{credentials:'same-origin'}).then(response=>{
  if(!response.ok)throw Error(`Asset definitions could not be loaded (${response.status})`);
  return body(response,'defs',release?.assets.size);
 });
 void assetDefinitionsPromise.catch(()=>{});
}
/** Start the large document downloads alongside the GLBs and physics WASM. */
export async function startWorldFileDownloads(){
 await loadRelease();
 startDocument();startDefinitions();
}
export async function loadWorldDocument(){
 await loadRelease();
 startDocument();
 return worldDocumentPromise;
}
export async function loadAssetDefinitions(){await loadRelease();startDefinitions();return assetDefinitionsPromise;}
/** The player reads each large file once, while it starts. The module's promise keeps what it resolved to (the parsed trees: tens of MB of small
 * objects, 31 of the 143 MB the ready world held) for as long as the page lives, so the player lets go of it when the world has been restored
 * from it. The studio keeps both: it saves from the live editor and may ask again. A player that asks again after this simply downloads the
 * file again (from the HTTP cache) and holds that one. */
export function releaseWorldDocument(){if(PLAYER_MODE)worldDocumentPromise=null;}
export function releaseAssetDefinitions(){if(PLAYER_MODE)assetDefinitionsPromise=null;}
