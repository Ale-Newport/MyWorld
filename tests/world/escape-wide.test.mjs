import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wideRuns,escapeWideBytes,escapeWideCharacters} from '../../public/archipelago/preview/compressed-gltf.js';

/* The world document is 33 MB of ASCII with 82 symbols and emoji in it, and one wide character makes the whole text a two-byte JS string (66 MB) while
   it is parsed. The player writes those characters as \uXXXX escapes on the way in: a one-byte string that parses to the same value. */
const random=seed=>()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const naive=bytes=>{const runs=[];let open=-1;for(let i=0;i<bytes.length;i++){const wide=bytes[i]>=0x80;if(wide&&open<0)open=i;else if(!wide&&open>=0){runs.push(open,i);open=-1;}}if(open>=0)runs.push(open,bytes.length);return runs;};
const stream=chunks=>new ReadableStream({start(controller){for(const c of chunks)controller.enqueue(c);controller.close();}});
const collect=async s=>{const parts=[];for await(const c of s)parts.push(c);const out=new Uint8Array(parts.reduce((n,c)=>n+c.length,0));let at=0;for(const c of parts){out.set(c,at);at+=c.length;}return out;};
const cut=(bytes,rnd,max)=>{const chunks=[];for(let at=0;at<bytes.length;){const n=1+Math.floor(rnd()*max);chunks.push(bytes.slice(at,at+n));at+=n;}return chunks;};
const sample={name:'Archipiélago · año ★ ♜ ❄ 🌅 🐧 ⛳ ✉',nested:{list:['ñ','日本語',' ','🌅'],plain:'ascii only',escaped:'already \\u00e9 \\n \\" done',n:[1,2.5,-3e-7]},emoji:'🌳🌳🌳'};

test('wideRuns finds exactly the runs of bytes of 0x80 or more, aligned or not, at every length',()=>{
 const rnd=random(5);
 for(let round=0;round<400;round++){
  const length=Math.floor(rnd()*70),pad=Math.floor(rnd()*4),buffer=new Uint8Array(pad+length+8);
  for(let i=0;i<buffer.length;i++)buffer[i]=rnd()<(round%4===0?.5:.03)?128+Math.floor(rnd()*128):32+Math.floor(rnd()*90);
  const view=buffer.subarray(pad,pad+length);
  assert.deepEqual(wideRuns(view),naive(view),`round ${round}: offset ${view.byteOffset&3}, length ${length}`);
 }
 assert.deepEqual(wideRuns(new Uint8Array(0)),[]);assert.deepEqual(wideRuns(new Uint8Array(64).fill(0x41)),[]);assert.deepEqual(wideRuns(new Uint8Array(64).fill(0xC3)),[0,64]);
});

test('escaped bytes are ASCII and parse to the value the plain text parses to',()=>{
 const text=JSON.stringify(sample),bytes=new TextEncoder().encode(text),out=escapeWideBytes(bytes);
 assert.ok(out.every(b=>b<0x80),'nothing wide is left');assert.ok(out.length>bytes.length);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(out)),JSON.parse(text));
 const plain=new TextEncoder().encode('{"a":"only ascii","b":[1,2,3]}');assert.equal(escapeWideBytes(plain),plain,'a chunk with nothing wide in it is passed on as it is, not copied');
});

test('invalid UTF-8 becomes the same replacement characters the browser would decode',()=>{
 const head=new TextEncoder().encode('{"a":"x'),tail=new TextEncoder().encode('y","b":"é★"}');
 for(const bad of [[0xFF],[0xC3],[0xE2,0x98],[0xC3,0x41].slice(0,1),[0x80,0x80,0x80],[0xF0,0x9F,0x8C]]){
  const bytes=new Uint8Array([...head,...bad,...tail]),expected=JSON.parse(new TextDecoder().decode(bytes));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(escapeWideBytes(bytes))),expected,'bytes '+bad.map(b=>b.toString(16)).join(' '));
 }
});

test('the stream form gives the same text however the bytes are cut, even in the middle of a character',async()=>{
 const doc={states:Object.fromEntries(Array.from({length:300},(_,i)=>['id'+i,{name:i%7?'plain '+i:'café ★ '+i,list:[i,i/3],emoji:i%11?'':'🐧'}])),added:[sample,sample]};
 const bytes=new TextEncoder().encode(JSON.stringify(doc)),expected=JSON.parse(JSON.stringify(doc)),rnd=random(11);
 for(const max of [1,2,3,5,17,64,1000,1e9]){
  const out=await collect(escapeWideCharacters(stream(cut(bytes,rnd,max))));
  assert.ok(out.every(b=>b<0x80),`cut at most ${max} bytes: ASCII`);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(out)),expected,`cut at most ${max} bytes`);
 }
});

test('a leading byte order mark is dropped like the browser drops it, and an empty stream stays empty',async()=>{
 const bytes=new Uint8Array([0xEF,0xBB,0xBF,...new TextEncoder().encode('{"é":1}')]);
 const out=await collect(escapeWideCharacters(stream([bytes])));assert.deepEqual(JSON.parse(new TextDecoder().decode(out)),{'é':1});
 assert.equal((await collect(escapeWideCharacters(stream([])))).length,0);
 assert.equal((await collect(escapeWideCharacters(stream([new Uint8Array(0)])))).length,0);
});

test('only the first three bytes of the stream can be a byte order mark, however the first chunks are cut',async()=>{
 const enc=new TextEncoder(),bom=[0xEF,0xBB,0xBF],run=async chunks=>JSON.parse(new TextDecoder().decode(await collect(escapeWideCharacters(stream(chunks)))));
 // a real mark cut at every place, down to one byte a chunk
 const marked=new Uint8Array([...bom,...enc.encode('{"a":"é"}')]);
 for(const size of [1,2,3,4,100])assert.deepEqual(await run(cut(marked,()=>0,size)),{a:'é'},`mark then text, chunks of ${size}`);
 // the same three bytes later in the stream are a character (U+FEFF at the start of a key), whatever the size of the first chunk
 const inside=new Uint8Array([...enc.encode('{"'),...bom,...enc.encode('z":1}')]);
 for(const first of [1,2])assert.deepEqual(await run([inside.slice(0,first),inside.slice(first,2),inside.slice(2)]),{'﻿z':1},`a first chunk of ${first} byte(s), then the three bytes`);
 for(const size of [1,2,3,100])assert.deepEqual(await run(cut(inside,()=>0,size)),{'﻿z':1},`chunks of ${size}`);
 // a stream that is only the start of a mark ends without losing what it had
 assert.equal((await collect(escapeWideCharacters(stream([new Uint8Array([0xEF,0xBB])])))).length>0,true);
});
