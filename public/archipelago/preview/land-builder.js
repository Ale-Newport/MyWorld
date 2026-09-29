import * as THREE from 'three';
const TILE=16,STEP=2,COUNT=TILE/STEP,BOTTOM=-4;
/** Matching world-space vertices keep adjacent brush tiles watertight. */
export function paintLand(editor,point,radius,height,erase=false){
 const SEA=editor.root.userData.seaLevel??-1.2;
 const tiles=new Map();editor.root.traverse(o=>{if(o.userData.landTile&&editor.isVisible(o))tiles.set(o.userData.landTile,o);});
 const base=[];editor.root.traverse(o=>{if(o.isMesh&&o.userData.terrain&&!o.userData.landTile&&editor.isVisible(o))base.push(o);});
 editor.landBaseCache??=new Map();const baseHeight=(x,z)=>{const key=x+','+z;if(!editor.landBaseCache.has(key)){const hit=new THREE.Raycaster(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0)).intersectObjects(base,false)[0];editor.landBaseCache.set(key,hit?.point.y??-Infinity);}return editor.landBaseCache.get(key);};
 const minX=Math.floor((point.x-radius)/TILE),maxX=Math.floor((point.x+radius)/TILE),minZ=Math.floor((point.z-radius)/TILE),maxZ=Math.floor((point.z+radius)/TILE);
 const shared=new Map();for(const tile of tiles.values()){const a=tile.geometry.attributes.position;for(let i=0;i<a.count;i++)shared.set(a.getX(i)+','+a.getZ(i),a.getY(i));}
 for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
  const key=x+':'+z;let tile=tiles.get(key);if(!tile&&erase)continue;
  if(!tile){const positions=[],colors=[],indices=[];for(let j=0;j<=COUNT;j++)for(let i=0;i<=COUNT;i++){const px=x*TILE+i*STEP,pz=z*TILE+j*STEP;positions.push(px,shared.get(px+','+pz)??BOTTOM,pz);colors.push(.32,.45,.19);if(i<COUNT&&j<COUNT){const k=j*(COUNT+1)+i;indices.push(k,k+COUNT+1,k+1,k+1,k+COUNT+1,k+COUNT+2);}}
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
   tile=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));tile.name='Tierra '+key;tile.userData={landTile:key,terrain:true,sculptable:true,ground_surface:true,surface_type:'terrain',collision:true,physics_mode:'STATIC',geometryEdited:true};tile.receiveShadow=true;editor.register(tile);editor.root.add(tile);tiles.set(key,tile);
  }
  const a=tile.geometry.attributes.position,c=tile.geometry.attributes.color;for(let i=0;i<a.count;i++){
   const d=Math.hypot(a.getX(i)-point.x,a.getZ(i)-point.z);if(d>radius)continue;const w=THREE.MathUtils.smoothstep((radius-d)/(radius*.4),0,1),target=erase?BOTTOM:BOTTOM+(height-BOTTOM)*w;
   const ground=baseHeight(a.getX(i),a.getZ(i));const safeTarget=ground>=target-.03?Math.min(target,ground-.06):target;
   const value=erase?THREE.MathUtils.lerp(a.getY(i),BOTTOM,w):Math.max(a.getY(i),safeTarget);shared.set(a.getX(i)+','+a.getZ(i),value);a.setY(i,value);
  }
 }
 for(const tile of tiles.values()){const a=tile.geometry.attributes.position,c=tile.geometry.attributes.color;for(let i=0;i<a.count;i++){a.setY(i,shared.get(a.getX(i)+','+a.getZ(i))??a.getY(i));const color=new THREE.Color(a.getY(i)<SEA+.6?0xc8b78c:0x77984f);c.setXYZ(i,color.r,color.g,color.b);}a.needsUpdate=c.needsUpdate=true;tile.geometry.computeVertexNormals();tile.geometry.computeBoundingBox();tile.geometry.computeBoundingSphere();}
 return [...tiles.values()];
}
