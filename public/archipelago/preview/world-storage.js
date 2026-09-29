/** The authored Archipelago is the only editable and published world. */
export const WORLD_SLOTS={archipelago:'Archipiélago'};
export const PLAYER_MODE=typeof document!=='undefined'&&document.body.dataset.player==='true';
export function worldFiles(){
 const id='archipelago',folder='exports/worlds/archipelago';
 return {id,name:WORLD_SLOTS[id],folder,world:`../${folder}/editor-world.json.gz`,assets:`../${folder}/asset-definitions.json`,api:kind=>`/api/${kind}?world=${id}`};
}
export async function loadWorldDocument(){
 const response=await fetch(worldFiles().world);
 if(!response.ok)throw Error(`No se pudo cargar Archipiélago (${response.status})`);
 const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
 return new Response(stream).json();
}
