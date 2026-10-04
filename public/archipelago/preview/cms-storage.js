import {CMS_CONFIG,setRelease} from './world-storage.js';
/* SAVING TO THE PORTFOLIO
   HelloWorld's editor saved by POSTing to its local Python server. Inside the
   portfolio's admin it saves here instead: the world document is gzipped in
   the browser, both files are hashed (SHA-256) and uploaded as blobs, and
   one request makes them the new draft revision on top of the one this
   editor loaded. If another tab or session saved in between, the server
   answers 409 and nothing is overwritten. Publishing is the admin's separate,
   validated step. */
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function bytesOf(text,gzip){const raw=new TextEncoder().encode(text);if(!gzip)return raw;return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());}
async function upload(bytes){
 const sha=hex(await crypto.subtle.digest('SHA-256',bytes));
 const r=await fetch(CMS_CONFIG.blobs,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/octet-stream','x-content-sha256':sha,'x-csrf-token':CMS_CONFIG.csrf},body:bytes});
 if(!r.ok)throw Error((await r.json().catch(()=>({}))).error??`Upload failed (${r.status})`);
 return r.json();
}
export class ConflictError extends Error{constructor(message,head){super(message);this.name='ConflictError';this.head=head;}}
let base=null;
export function setBaseRevision(id){base=id;}
export function baseRevision(){return base;}
export async function saveWorldToPortfolio(world,assets,{message,force=false}={}){
 if(!CMS_CONFIG.draft)throw Error('This world is read-only here.');
 const [w,a]=await Promise.all([upload(await bytesOf(JSON.stringify(world),true)),upload(await bytesOf(JSON.stringify(assets),false))]);
 const r=await fetch(CMS_CONFIG.draft,{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':CMS_CONFIG.csrf},body:JSON.stringify({base,world:w,assets:a,message,force})});
 const data=await r.json().catch(()=>({}));
 if(r.status===409)throw new ConflictError(data.error??'Someone else saved this world.',data.head);
 if(!r.ok)throw Error(data.error??`Save failed (${r.status})`);
 base=data.revision.id;setRelease({revision:base,world:{url:`/api/admin/world/blob/${w.sha}`,...w},assets:{url:`/api/admin/world/blob/${a.sha}`,...a}});
 try{if(parent!==window)parent.postMessage({type:'archipelago:saved',revision:data.revision},location.origin);}catch{}
 return data.revision;
}
/** A file the browser saves, for GLB and document exports (no server write). */
export function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
