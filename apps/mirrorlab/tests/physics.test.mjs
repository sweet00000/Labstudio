import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,reflect,dot,norm,unit,sub,at,basis,toWorld,toLocal,sag,intersectMirror,intersectSplitter,foldPoint,traceRay,simulate,validate,quadratic,paraxial,projectFromJSON,projectToJSON,sweepCell,sweepAxes,launchRay,fieldsFor} from '../web/src/physics.js';
const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b} within ${tol}`);
const vectorNear=(a,b,tol=1e-10)=>a.forEach((v,i)=>near(v,b[i],tol));
const P=patch=>({...DEFAULTS,layout:'single',source:'point',samples:256,...patch});

test('specular reflection preserves unit length and tangential component; reverses normal component',()=>{
  for(const d of [[.3,.4,-Math.sqrt(.75)],[-.6,0,-.8],[0,0,-1]]){const n=unit([.1,.2,1]),r=reflect(d,n);near(norm(r),1);near(dot(r,n),-dot(d,n));vectorNear(sub(r,at([0,0,0],n,dot(r,n))),sub(d,at([0,0,0],n,dot(d,n))));}
});
test('stable quadratic retains small root and handles axial linear intersections',()=>{
  const [small,large]=quadratic(1,-1e8,1);near(small,1e-8,1e-20);near(large,1e8,1e-6);assert.deepEqual(quadratic(0,2,-4),[2]);assert.deepEqual(quadratic(1,0,1),[]);
});
test('rotation basis is orthonormal and reversible',()=>{
  const b=basis(P({pitch:17,yaw:-12}));vectorNear(toLocal(toWorld([4,8,12],b),b),[4,8,12]);near(dot(b[0],b[1]),0);near(norm(b[2]),1);
});
test('spherical intersection finds the physical near cap, not the rear sphere',()=>{
  const p=P({radius:100});const h=intersectMirror([0,0,250],[0,0,-1],p);near(h.point[2],0);near(h.t,250);vectorNear(h.normal,[0,0,1]);
  assert.equal(intersectMirror([50,0,50],[0,0,-1],p),null);
  assert.equal(intersectMirror([0,0,-10],[0,0,1],p),null);
});
test('curvature, aperture, and normals rotate with the analytic surface',()=>{
  const p=P({pitch:15,yaw:8}),b=basis(p),o=toWorld([8,2,50],b),d=toWorld([0,0,-1],b),h=intersectMirror(o,d,p);
  const q=toLocal(h.point,b);near(q[2],sag(Math.hypot(8,2),p));vectorNear(toLocal(h.normal,b),unit([-8,-2,100-q[2]]));
});
test('a plane mirror doubles a small mirror tilt',()=>{
  const p=P({surface:'flat',pitch:8});const h=intersectMirror([0,0,50],[0,0,-1],p),r=reflect([0,0,-1],h.normal);
  near(Math.atan2(-r[1],r[2])*180/Math.PI,16);
});
test('paraboloid collimates its focus across the full aperture to numerical precision',()=>{
  const p=P({surface:'paraboloid',radius:100,aperture:60}),o=[0,0,50];
  for(const [x,y]of [[0,0],[3,8],[12,-9],[25,4]]){const q=[x,y,sag(Math.hypot(x,y),p)],d=unit(sub(q,o)),h=intersectMirror(o,d,p);vectorNear(h.point,q,1e-9);vectorNear(reflect(d,h.normal),[0,0,1],1e-12);}
});
test('parallel rays focus at the paraboloid focus without a paraxial approximation',()=>{
  const p=P({surface:'paraboloid',radius:100,aperture:60});
  for(const x of [1,10,25]){const h=intersectMirror([x,0,90],[0,0,-1],p),d=reflect([0,0,-1],h.normal);vectorNear(at(h.point,d,(50-h.point[2])/d[2]),[0,0,50],1e-9);}
});
test('spherical mirror has paraxial focus R/2 and marginal spherical aberration',()=>{
  const p=P({radius:100,aperture:60});
  const focus=x=>{const h=intersectMirror([x,0,90],[0,0,-1],p),d=reflect([0,0,-1],h.normal);return h.point[2]-h.point[0]*d[2]/d[0];};
  near(focus(.001),50,1e-7);assert.ok(focus(25)<49);
});
test('birdbath folding maps display point to its unfolded virtual source',()=>{
  const p=DEFAULTS,o=[3,2,50];vectorNear(foldPoint(foldPoint(o,p),p),o);vectorNear(foldPoint([0,0,50],p),[0,28,22]);
});
test('birdbath central ray follows all surfaces and audits both unused splitter branches',()=>{
  const p=DEFAULTS,r=traceRay([0,28,22],[0,-1,0],p);assert.equal(r.points.length,5);vectorNear(r.points[1],[0,0,22]);vectorNear(r.points[2],[0,0,0]);vectorNear(r.screen,[0,0,72]);near(r.power,.5*.92*.5);near(r.ledger.otherPort,.5+.5*.92*.5);near(r.ledger.absorbed,.5*.08);near(Object.values(r.ledger).reduce((a,b)=>a+b),1);
});
test('finite splitter aperture clips rays on both in-plane axes',()=>{
  const p={...DEFAULTS,splitterSize:10};assert.equal(intersectSplitter([10,28,22],[0,-1,0],p),null);assert.equal(intersectSplitter([0,28,32],[0,-1,0],p),null);assert.ok(intersectSplitter([0,28,22],[0,-1,0],p));
});
test('uniform cone sampling has the correct mean cosine',()=>{
  const p=P({cone:30}),field=fieldsFor(p)[0],n=256;let mean=0;
  for(let i=0;i<n;i++){const r=launchRay(i,n,field,p);near(norm(r.direction),1);mean+=-r.direction[2]/n;}
  near(mean,(1+Math.cos(Math.PI/6))/2);
});
test('launch power closes for clipping, tilt, absorption, zero reflectivity, and splitter endpoints',()=>{
  for(const patch of [{},{pitch:15,yaw:-18},{reflectivity:0},{splitterR:0},{splitterR:1},{pupil:12,eyeX:10},{splitterSize:8},{surface:'flat',pitch:20}]){
    const r=simulate({...DEFAULTS,samples:64,...patch},{includeMap:false});near(Object.values(r.ledger).reduce((a,b)=>a+b),1,1e-11);for(const value of Object.values(r.ledger))assert.ok(value>=0&&value<=1+1e-11);
  }
});
test('on-axis parabolic collimator has zero angular spread; spherical one does not',()=>{
  const parabola=simulate(P({surface:'paraboloid'}),{includeMap:false}),sphere=simulate(P({surface:'sphere'}),{includeMap:false});assert.ok(parabola.rms<1e-9);assert.ok(sphere.rms>1);
});
test('extended display fields are analyzed separately instead of incorrectly merging field angles',()=>{
  const r=simulate({...DEFAULTS,samples:256},{includeMap:false});assert.equal(r.fields.length,9);assert.ok(r.fields[0].centroid[0]>0);assert.ok(r.fields[8].centroid[0]<0);assert.ok(r.rms<20);assert.ok(r.energyError<1e-11);
});
test('pupil power, eyebox center, and field statistics use the same normalization',()=>{
  const r=simulate(DEFAULTS);const center=r.eyebox.cells.find(c=>c.x===0&&c.y===0);near(center.power,r.ledger.captured,1e-12);near(r.fields.reduce((sum,f)=>sum+f.received,0)/r.fields.length,r.ledger.captured,1e-12);assert.equal(center.coverage,r.coverage);
});
test('paraxial real/virtual sign and collimation state are explicit',()=>{
  near(paraxial(P({distance:100})).image,100);near(paraxial(P({distance:25})).image,-50);assert.equal(paraxial(P({distance:50})).image,null);near(paraxial(P({source:'parallel'})).image,50);
});
test('grid objective prefers a true parabolic focus and rejects zero light',()=>{
  const p=P({surface:'paraboloid'}),good=sweepCell(p,100,50),bad=sweepCell(p,100,60),dark=sweepCell({...p,reflectivity:0},100,50);assert.equal(good.feasible,true);assert.ok(good.score<bad.score);assert.equal(dark.feasible,false);assert.equal(dark.score,null);assert.equal(sweepAxes(p).radii.length,13);
});
test('project export round trips with units, schema version, and parameter validation',()=>{
  assert.deepEqual(projectFromJSON(projectToJSON(DEFAULTS)),DEFAULTS);
  assert.throws(()=>projectFromJSON('{"schema":"mirrorlab.project","schemaVersion":2}'));
  assert.throws(()=>validate({...DEFAULTS,radius:NaN}));assert.throws(()=>validate({...DEFAULTS,samples:1024.5}));assert.throws(()=>validate({...DEFAULTS,distance:20}));assert.throws(()=>validate({...DEFAULTS,detectorZ:25}));assert.throws(()=>validate({...DEFAULTS,layout:'arbitrary'}));assert.throws(()=>validate({...DEFAULTS,surface:'sphere',radius:30,aperture:70}));
});
