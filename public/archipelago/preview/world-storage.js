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
 releasePromise??=fetch(CMS_CONFIG.release??'/api/world/release',{credentials:'same-origin',cache:'no-cache'}).then(async response=>{
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
async function body(response){return response.body&&response.headers.get('content-type')?.includes('gzip')?new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json():response.json();}
let worldDocumentPromise=null,assetDefinitionsPromise=null;
/** Start the large document downloads alongside the GLBs and physics WASM. */
export async function startWorldFileDownloads(){
 await loadRelease();
 worldDocumentPromise??=fetch(worldFiles().world,{credentials:'same-origin'}).then(response=>{
  if(!response.ok)throw Error(`No se pudo cargar Archipiélago (${response.status})`);
  return body(response);
 });
 assetDefinitionsPromise??=fetch(worldFiles().assets,{credentials:'same-origin'}).then(response=>{
  if(!response.ok)throw Error(`Asset definitions could not be loaded (${response.status})`);
  return response.json();
 });
 // The editor awaits both promises later; observing an early failure here
 // prevents a rejected download from surfacing as an unhandled rejection.
 void worldDocumentPromise.catch(()=>{});
 void assetDefinitionsPromise.catch(()=>{});
}
export async function loadWorldDocument(){
 await startWorldFileDownloads();
 return worldDocumentPromise;
}
export async function loadAssetDefinitions(){await startWorldFileDownloads();return assetDefinitionsPromise;}
