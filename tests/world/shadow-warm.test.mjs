import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {casterKind,assignDepthMaterials,depthMaterialFor} from '../../public/archipelago/preview/runtime/shadow-warm.js';

const box=(material,at=[0,0,0])=>{const m=new THREE.Mesh(new THREE.BoxGeometry(),material);m.castShadow=true;m.position.set(...at);return m;};

test('casters are told apart by what a depth shader sees: instancing, the side that shades, the map, the attributes',()=>{
 const double=new THREE.MeshStandardMaterial({side:THREE.DoubleSide}),front=new THREE.MeshStandardMaterial(),mapped=new THREE.MeshStandardMaterial({side:THREE.DoubleSide,map:new THREE.Texture()});
 const a=casterKind(box(double)),b=casterKind(box(double,[3,0,0])),c=casterKind(box(front)),d=casterKind(box(mapped));
 assert.equal(a.key,b.key,'the same kind');assert.notEqual(a.key,c.key,'the side');assert.notEqual(a.key,d.key,'a map');
 const inst=new THREE.InstancedMesh(new THREE.BoxGeometry(),double,2);inst.castShadow=true;
 assert.notEqual(casterKind(inst).key,a.key,'instancing');assert.match(casterKind(inst).key,/^I\|/);
 const colored=new THREE.InstancedMesh(new THREE.BoxGeometry(),double,2);colored.setColorAt(0,new THREE.Color());assert.match(casterKind(colored).key,/^Ic\|/);
 const plain=new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)),double);
 assert.notEqual(casterKind(plain).key,a.key,'the geometry\'s attributes');
 assert.equal(a.plain,true);
 assert.equal(casterKind(box(new THREE.MeshStandardMaterial({alphaTest:.5,map:new THREE.Texture()}))).plain,false,'an alpha test needs its own');
 assert.equal(casterKind(box(new THREE.MeshStandardMaterial({displacementMap:new THREE.Texture(),displacementScale:1}))).plain,false);
 const skinned=new THREE.SkinnedMesh(new THREE.BoxGeometry(),front);assert.equal(casterKind(skinned).plain,false);
});

test('every caster gets the depth material of its kind; what needs its own, and what is not a caster, keep three\'s; hidden templates are given one but are not warmed',()=>{
 const scene=new THREE.Scene(),double=new THREE.MeshStandardMaterial({side:THREE.DoubleSide}),front=new THREE.MeshStandardMaterial(),alpha=new THREE.MeshStandardMaterial({alphaTest:.5,map:new THREE.Texture()});
 const a=box(double),b=box(double,[2,0,0]),c=box(front),d=box(alpha),debris=new THREE.InstancedMesh(new THREE.BoxGeometry(),front,4);debris.castShadow=true;debris.visible=false;
 const noShadow=new THREE.Mesh(new THREE.BoxGeometry(),double);
 const template=new THREE.Group();template.visible=false;const hidden=box(new THREE.MeshStandardMaterial({side:THREE.DoubleSide,map:new THREE.Texture()}));template.add(hidden);
 scene.add(a,b,c,d,debris,noShadow,template);
 const {assigned,reps}=assignDepthMaterials(scene);
 assert.equal(a.customDepthMaterial,b.customDepthMaterial);assert.notEqual(a.customDepthMaterial,c.customDepthMaterial);
 assert.equal(a.customDepthMaterial,depthMaterialFor(casterKind(a).key));
 assert.ok(a.customDepthMaterial.isMeshDepthMaterial&&a.customDepthMaterial.depthPacking===THREE.BasicDepthPacking,'the same as three\'s own');
 assert.equal(d.customDepthMaterial,undefined,'an alpha-tested caster keeps the shared one');assert.equal(noShadow.customDepthMaterial,undefined);
 assert.ok(debris.customDepthMaterial,'a hidden caster under visible ancestors');assert.ok(hidden.customDepthMaterial,'a template\'s caster is given one for when it shows');
 assert.equal(assigned,5);
 const warmed=[...reps.values()];assert.ok(warmed.includes(debris),'the debris is warmed');assert.ok(!warmed.includes(hidden),'a hidden template is not');
 assert.equal(reps.size,3);
 // a second pass finds nothing to do and the same kinds
 assert.equal(assignDepthMaterials(scene).assigned,0);
});
