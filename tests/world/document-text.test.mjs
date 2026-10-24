import {test} from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {setRelease,loadWorldDocument,loadAssetDefinitions,observeWorldDownloads} from '../../public/archipelago/preview/world-storage.js';

/* The document and the definitions are parsed from a text with its wide characters escaped (a one-byte string instead of a two-byte one), and the
   value that comes out is the one the plain text holds. */
const doc={schema:2,base:'AlejandroWorld-v4',states:{a:{name:'Archipiélago · año ★ 🐧',data:{emoji:'🌅',list:[1,2.5,-3e-7],escaped:'\\u00e9 \\n'}}},added:[{name:'日本語 ♜'}]};
const defs={definitions:[{id:'world2:tree',name:'Árbol ❄'}]};
const RealResponse=globalThis.Response;
const respond=(bytes,type)=>new RealResponse(new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),{headers:{'content-type':type,'content-length':String(bytes.length)}});

for(const observed of [true,false])test(`the document and the definitions keep their wide characters (${observed?'with':'without'} a progress observer)`,async()=>{
 const progress=[];observeWorldDownloads(observed?(key,loaded,total,done)=>progress.push([key,loaded,total,done]):null);
 // What reaches the JSON parser: every stream world-storage.js hands to a Response is read here too.
 const fed=[];globalThis.Response=class extends RealResponse{constructor(body,init){if(body instanceof ReadableStream){const [seen,rest]=body.tee();fed.push((async()=>{const parts=[];for await(const c of seen)parts.push(Buffer.from(c));return Buffer.concat(parts);})());super(rest,init);}else super(body,init);}};
 const real=globalThis.fetch,gz=zlib.gzipSync(Buffer.from(JSON.stringify(doc))),plain=Buffer.from(JSON.stringify(defs)),asked=[];
 globalThis.fetch=async url=>{asked.push(String(url));return String(url).includes('world')?respond(new Uint8Array(gz),'application/gzip'):respond(new Uint8Array(plain),'application/json');};
 try{
  setRelease({revision:null,world:{url:'/seed/world.json.gz',size:gz.length},assets:{url:'/seed/defs.json',size:plain.length}});
  const [loadedDoc,loadedDefs]=await Promise.all([loadWorldDocument(),loadAssetDefinitions()]);
  assert.deepEqual(loadedDoc,doc);assert.deepEqual(loadedDefs,defs);
  assert.equal(loadedDoc.states.a.name,'Archipiélago · año ★ 🐧');
  assert.equal(asked.length,2,'each file is asked for once');
  const texts=await Promise.all(fed);assert.equal(texts.length,2,'one text for the document and one for the definitions');
  for(const text of texts)assert.ok(text.every(byte=>byte<0x80),'the parser is given ASCII only');
  if(observed)assert.ok(progress.some(p=>p[0]==='doc'&&p[3]===true)&&progress.some(p=>p[0]==='defs'&&p[3]===true),'both downloads report that they are done');
 }finally{globalThis.fetch=real;globalThis.Response=RealResponse;observeWorldDownloads(null);}
});
