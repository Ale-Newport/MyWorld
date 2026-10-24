import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compressVehicleModels} from '../../scripts/world/compress-vehicle-models.mjs';
import {importsOf,moduleGraph,preloadBlock,currentBlock,PREVIEW,resolveSpecifier} from '../../scripts/world/build-modulepreload.mjs';

const html=fs.readFileSync(path.join(PREVIEW,'index.html'),'utf8');

test('the gzip copy of the corsair model matches the raw GLB the studio and Blender use',async()=>{
 assert.deepEqual(await compressVehicleModels({check:true}),[],'run node scripts/world/compress-vehicle-models.mjs');
});

test('index.html lists the player\'s whole module graph for the browser to fetch at once (node scripts/world/build-modulepreload.mjs)',()=>{
 const graph=moduleGraph(html);
 assert.equal(currentBlock(html),preloadBlock(graph),'the modulepreload list is stale: run node scripts/world/build-modulepreload.mjs');
 const names=graph.map(f=>path.relative(PREVIEW,f).split(path.sep).join('/'));
 for(const entry of ['player.js','main.js','runtime/host.js','runtime/loading.js','early-fetch.js','roads/road-plans.js','world-storage.js'])assert.ok(names.includes(entry),`${entry} is in the graph`);
 assert.ok(names.some(n=>n.startsWith('vendor/three/build/three.core.js')),'the import map is followed into vendored three');
 assert.ok(names.some(n=>n.includes('rapier')),'and rapier');
 assert.ok(!names.includes('board-editor.js'),'the studio\'s board editor is a dynamic import and is not preloaded');
 assert.ok(graph.every(f=>fs.existsSync(f)),'every module in the list exists');
 assert.equal(new Set(graph).size,graph.length);
});

test('the import scanner reads static imports in any layout and skips dynamic ones',()=>{
 const src=`import * as T from 'three';import {a,b}from'./a.js';\nimport {\n  c,\n  d,\n} from "./c.js";\nexport {e} from './e.js';export * from './f.js';import './g.js';\nconst x=await import('./dynamic.js');\n// import './commented.js';\n/* import './block.js'; */\nexport function from(){return 'import ./not-a-module.js'}`;
 assert.deepEqual(importsOf(src),['three','./a.js','./c.js','./e.js','./f.js','./g.js']);
 const map={imports:{three:'./vendor/three/build/three.module.js','three/addons/':'./vendor/three/examples/jsm/'}};
 assert.equal(resolveSpecifier('three',path.join(PREVIEW,'main.js'),map),path.join(PREVIEW,'vendor/three/build/three.module.js'));
 assert.equal(resolveSpecifier('three/addons/loaders/GLTFLoader.js',path.join(PREVIEW,'main.js'),map),path.join(PREVIEW,'vendor/three/examples/jsm/loaders/GLTFLoader.js'));
 assert.equal(resolveSpecifier('./x.js',path.join(PREVIEW,'roads/y.js'),map),path.join(PREVIEW,'roads/x.js'));
 assert.throws(()=>resolveSpecifier('unknown-package',path.join(PREVIEW,'main.js'),map),/cannot resolve/);
});

test('index.html starts, before any module runs, exactly the files the player cannot start without — and they all exist',()=>{
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const urls=[...script.matchAll(/'(\.\.\/[^']+)'/g)].map(m=>m[1]);
 assert.ok(urls.length>=6,'the models and small files');
 for(const url of urls)assert.ok(fs.existsSync(path.resolve(PREVIEW,url)),`${url} exists`);
 assert.ok(urls.includes('../exports/AlejandroWorld.glb.gz')&&urls.includes('../assets/environment/portfolio/models/world.glb.gz'),'the island and its world models');
 assert.ok(!urls.some(u=>/vegetation/.test(u)),'the vegetation model is for the studio only');
 assert.ok(script.includes("'/api/world/release'")&&script.includes("'release:'+kind"),'the release and the two files it names');
 // Everything it starts is taken by the runtime: the same URLs, resolved the same way.
 const taken=['../exports/AlejandroWorld.glb.gz','../exports/navigation.json','../assets/environment/portfolio/models/world.glb.gz','../assets/environment/portfolio/interactions.json','../assets/environment/portfolio/world-manifest.json'];
 const sources=['main.js','world2-catalog.js'].map(f=>fs.readFileSync(path.join(PREVIEW,f),'utf8')).join('\n');
 for(const url of taken)assert.ok(sources.includes(url)||sources.includes(url.replace('../assets/environment/portfolio/','')),`${url} is taken from the head start`);
 assert.ok(fs.readFileSync(path.join(PREVIEW,'runtime/plane-visual.js'),'utf8').includes("corsair.glb'")&&urls.includes('../assets/vehicles/plane/corsair.glb.gz'));
});

test('the studio page loads the same runtime without the head start and without the legacy map markup',()=>{
 const studio=fs.readFileSync(path.resolve(PREVIEW,'../../../src/server/world-studio/studio-template.ts'),'utf8');
 for(const page of [html,studio]){
  assert.ok(!/id="map-panel"|id="minimap"|id="map-legend"|id="close-map"/.test(page),'the dead legacy map markup is gone');
  for(const id of ['viewport','world','loading','load-message','notice','help-dialog','awards-dialog','validation-dialog'])assert.ok(page.includes(`id="${id}"`),`#${id} stays`);
 }
 assert.ok(!studio.includes('__archipelagoEarly')&&!studio.includes('modulepreload'),'the studio keeps its own, unhinted page');
 const main=fs.readFileSync(path.join(PREVIEW,'main.js'),'utf8');
 for(const gone of ['#map-panel','#minimap','#map-legend','#close-map','mapSnapshot','mapShape','mapRaster','drawMap'])assert.ok(!main.includes(gone),`main.js no longer touches ${gone}`);
});
