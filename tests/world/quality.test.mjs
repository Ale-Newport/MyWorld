import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveQuality} from '../../public/archipelago/preview/runtime/quality.js';
test('quality responds to sustained frame cost, ignores isolated stalls and preserves recovery hysteresis',()=>{
 globalThis.devicePixelRatio=2;globalThis.innerWidth=1440;globalThis.innerHeight=900;globalThis.document={body:{dataset:{}}};
 const renderer={ratio:1.5,getPixelRatio(){return this.ratio},setPixelRatio(v){this.ratio=v}},sun={shadow:{mapSize:{x:2048,set(x,y){this.x=x;this.y=y}},map:null}};
 const q=new AdaptiveQuality(renderer,sun,{cores:8,memory:8});
 q.sample(9000);assert.equal(q.level,0);
 for(let i=0;i<160;i++)q.sample(40);
 assert.equal(q.level,2);assert.equal(sun.shadow.mapSize.x,512);assert.equal(renderer.ratio,.85);
 for(let i=0;i<100;i++)q.sample(16);assert.equal(q.level,2);
 for(let i=0;i<1300;i++)q.sample(16);assert.equal(q.level,1);
 q.reset();assert.equal(q.elapsed,0);
});
