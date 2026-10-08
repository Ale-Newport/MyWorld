/** Exact nearest-segment query. A balanced AABB tree prunes distant segments;
 * segment order breaks ties exactly as the previous linear scan did. */
export function roadSampler(samples) {
 const segments = [];
 for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i];
  segments.push({a,b,i,dx:b.p.x-a.p.x,dz:b.p.z-a.p.z,minX:Math.min(a.p.x,b.p.x),maxX:Math.max(a.p.x,b.p.x),minZ:Math.min(a.p.z,b.p.z),maxZ:Math.max(a.p.z,b.p.z)});
 }
 function build(items) {
  const box={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const s of items){box.minX=Math.min(box.minX,s.minX);box.maxX=Math.max(box.maxX,s.maxX);box.minZ=Math.min(box.minZ,s.minZ);box.maxZ=Math.max(box.maxZ,s.maxZ);}
  if(items.length<=8)return {...box,items};
  const x=box.maxX-box.minX>=box.maxZ-box.minZ;
  items.sort((a,b)=>x?(a.minX+a.maxX)-(b.minX+b.maxX):(a.minZ+a.maxZ)-(b.minZ+b.maxZ));
  const mid=items.length>>1;
  return {...box,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
 }
 const root=build(segments);
 return (x,z)=>{
  let distance2=Infinity,best=null,fraction=0,index=Infinity;
  const lower=box=>{const dx=Math.max(box.minX-x,0,x-box.maxX),dz=Math.max(box.minZ-z,0,z-box.maxZ);return dx*dx+dz*dz;};
  function visit(node) {
   if(lower(node)>distance2)return;
   if(node.items){for(const s of node.items){const t=Math.max(0,Math.min(1,((x-s.a.p.x)*s.dx+(z-s.a.p.z)*s.dz)/(s.dx*s.dx+s.dz*s.dz||1))),dx=x-(s.a.p.x+s.dx*t),dz=z-(s.a.p.z+s.dz*t),d=dx*dx+dz*dz;if(d<distance2||(d===distance2&&s.i<index)){distance2=d;best=s;fraction=t;index=s.i;}}return;}
   const left=lower(node.left),right=lower(node.right);
   if(left<=right){visit(node.left);visit(node.right);}else{visit(node.right);visit(node.left);}
  }
  visit(root);
  if(!best)return {distance:Infinity,s:0,y:0,lateral:0,tx:1,tz:0};
  const {a,b,dx,dz}=best,len=Math.hypot(dx,dz)||1,px=a.p.x+dx*fraction,pz=a.p.z+dz*fraction;
  return {distance:Math.sqrt(distance2),s:a.s+(b.s-a.s)*fraction,y:(1-fraction)*a.p.y+fraction*b.p.y,lateral:((x-px)*-dz+(z-pz)*dx)/len,tx:dx/len,tz:dz/len};
 };
}
