/** The authored Archipelago is the only editable and published world. */
export const WORLD_SLOTS={archipelago:'Archipiélago'};
export const PLAYER_MODE=typeof document!=='undefined'&&document.body.dataset.player==='true';
/* Where the world comes from. The public player asks the portfolio which
   revision is published (/api/world/release); the admin's studio page sets
   ARCHIPELAGO_CONFIG to its authenticated draft endpoints instead. Either
   way the files are named by content hash. */
export const CMS_CONFIG=(typeof globalThis!=='undefined'&&globalThis.ARCHIPELAGO_CONFIG)||{};
let release=null;
export async function loadRelease(){
 if(release)return release;
 const response=await fetch(CMS_CONFIG.release??'/api/world/release',{credentials:'same-origin',cache:'no-cache'});
 if(!response.ok)throw Error(`The published world could not be read (${response.status})`);
 release=await response.json();return release;
}
export function setRelease(next){release=next;}
export function worldFiles(){
 const id='archipelago';
 return {id,name:WORLD_SLOTS[id],folder:'portfolio',world:release?.world.url,assets:release?.assets.url,revision:release?.revision??null};
}
async function body(response){return response.body&&response.headers.get('content-type')?.includes('gzip')?new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json():response.json();}
export async function loadWorldDocument(){
 await loadRelease();
 const response=await fetch(worldFiles().world,{credentials:'same-origin'});
 if(!response.ok)throw Error(`No se pudo cargar Archipiélago (${response.status})`);
 return body(response);
}
