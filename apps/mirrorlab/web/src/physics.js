/** Mirrorlab reference kernel. All lengths are millimetres, angles in degrees.
 * Pure Float64 JavaScript; no renderer, DOM, or external numerical dependencies.
 * Steady-state geometrical optics with a prescribed main optical path.
 */
export const VERSION = 'mirrorlab-optics/0.1.0';
export const DEFAULTS = Object.freeze({
  layout: 'birdbath', surface: 'sphere', source: 'grid', radius: 100,
  aperture: 36, distance: 50, pitch: 0, yaw: 0, reflectivity: 0.92,
  cone: 24, width: 8, height: 4.5, beamRadius: 22, samples: 1024,
  splitterZ: 22, splitterSize: 46, splitterR: 0.5,
  detectorZ: 72, pupil: 5, eyeX: 0, eyeY: 0,
});
export const LIMITS = Object.freeze({
  radius: [30, 300], aperture: [4, 70], distance: [20, 180],
  pitch: [-20, 20], yaw: [-20, 20], reflectivity: [0, 1],
  cone: [2, 55], width: [0.1, 24], height: [0.1, 18],
  beamRadius: [2, 45], samples: [64, 4096], splitterZ: [5, 45],
  splitterSize: [8, 100], splitterR: [0, 1], detectorZ: [25, 220],
  pupil: [1, 12], eyeX: [-25, 25], eyeY: [-25, 25],
});
const D2R = Math.PI / 180;
const EPS = 1e-8;
export const add = (a,b) => a.map((v,i)=>v+b[i]);
export const sub = (a,b) => a.map((v,i)=>v-b[i]);
export const mul = (a,s) => a.map(v=>v*s);
export const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const norm = a => Math.hypot(...a);
export function unit(a) { const n=norm(a); if(n<EPS) throw new Error('Zero direction'); return mul(a,1/n); }
export const reflect = (d,n) => sub(d,mul(n,2*dot(d,n)));
export const at = (o,d,t) => add(o,mul(d,t));

export function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected a parameter object.');
  const p = {...DEFAULTS};
  for (const key of Object.keys(DEFAULTS)) if (Object.hasOwn(raw,key)) p[key]=raw[key];
  for (const [k,[lo,hi]] of Object.entries(LIMITS)) {
    if(typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k]<lo || p[k]>hi)
      throw new Error(`${k} must be a finite number between ${lo} and ${hi}.`);
  }
  for(const [key,options] of Object.entries({layout:['single','birdbath'],surface:['flat','sphere','paraboloid'],source:['point','grid','parallel']}))
    if(!options.includes(p[key])) throw new Error(`Unknown ${key}.`);
  if(!Number.isInteger(p.samples)) throw new Error('Samples must be an integer.');
  if(p.surface==='sphere' && p.aperture/2>=p.radius) throw new Error('Mirror aperture radius must be smaller than curvature radius.');
  if(p.layout==='birdbath' && p.distance<=p.splitterZ+5) throw new Error('Display path must be at least 5 mm longer than mirror–splitter spacing.');
  if(p.layout==='birdbath' && p.detectorZ<=p.splitterZ+5) throw new Error('Eye plane must be at least 5 mm beyond the splitter.');
  return p;
}

export function basis(p) {
  const a=p.pitch*D2R, b=p.yaw*D2R, ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
  return [[cb,0,-sb],[sb*sa,ca,cb*sa],[sb*ca,-sa,cb*ca]]; // columns Ry * Rx
}
export const toLocal = (v,b) => b.map(axis=>dot(v,axis));
export const toWorld = (v,b) => [0,1,2].map(i=>b[0][i]*v[0]+b[1][i]*v[1]+b[2][i]*v[2]);
export function sag(r,p) {
  if(p.surface==='flat') return 0;
  if(p.surface==='paraboloid') return r*r/(2*p.radius);
  return r*r/(p.radius+Math.sqrt(Math.max(0,p.radius*p.radius-r*r))); // stable R - sqrt(...)
}

export function quadratic(a,b,c) {
  if(Math.abs(a)<1e-15) return Math.abs(b)<1e-15?[]:[-c/b];
  const disc=b*b-4*a*c;
  if(disc<0) return [];
  if(disc===0) return [-b/(2*a)];
  const q=-0.5*(b+(b>=0?1:-1)*Math.sqrt(disc));
  return [q/a,c/q].sort((x,y)=>x-y);
}

export function intersectMirror(origin,direction,p) {
  const b=basis(p), o=toLocal(origin,b), d=toLocal(direction,b), a=p.aperture/2;
  let roots;
  if(p.surface==='flat') roots=Math.abs(d[2])<EPS?[]:[-o[2]/d[2]];
  else if(p.surface==='sphere') {
    const q=sub(o,[0,0,p.radius]);
    roots=quadratic(dot(d,d),2*dot(q,d),dot(q,q)-p.radius*p.radius);
  } else {
    roots=quadratic(d[0]**2+d[1]**2,2*(o[0]*d[0]+o[1]*d[1])-2*p.radius*d[2],o[0]**2+o[1]**2-2*p.radius*o[2]);
  }
  for(const t of roots) {
    if(t<=EPS) continue;
    const q=at(o,d,t), r=Math.hypot(q[0],q[1]);
    if(r>a+EPS) continue;
    if(p.surface==='sphere' && q[2]>p.radius) continue; // discard the far sphere cap
    let n=p.surface==='flat'?[0,0,1]:p.surface==='sphere'?[-q[0],-q[1],p.radius-q[2]]:[-q[0]/p.radius,-q[1]/p.radius,1];
    n=unit(n);
    if(dot(d,n)>=-EPS) continue; // front coating only
    return {t,point:toWorld(q,b),normal:toWorld(n,b)};
  }
  return null;
}

const SQRT2=Math.sqrt(2);
export const SPLITTER_N=[0,1/SQRT2,-1/SQRT2];
export function foldPoint(v,p) {
  const c=[0,0,p.splitterZ];
  return sub(v,mul(SPLITTER_N,2*dot(sub(v,c),SPLITTER_N)));
}
export function intersectSplitter(o,d,p) {
  const c=[0,0,p.splitterZ], den=dot(d,SPLITTER_N);
  if(Math.abs(den)<EPS) return null;
  const t=dot(sub(c,o),SPLITTER_N)/den;
  if(t<=EPS) return null;
  const point=at(o,d,t), q=sub(point,c), half=p.splitterSize/2;
  if(Math.abs(q[0])>half+EPS || Math.abs((q[1]+q[2])/SQRT2)>half+EPS) return null;
  return {point,t,normal:SPLITTER_N};
}

export function fieldsFor(p) {
  if(p.source!=='grid') return [{x:0,y:0,id:0}];
  const fields=[];
  for(const y of [-p.height/2,0,p.height/2]) for(const x of [-p.width/2,0,p.width/2]) fields.push({x,y,id:fields.length});
  return fields;
}
export function launchRay(i,count,field,p) {
  const phi=i*Math.PI*(3-Math.sqrt(5)), u=(i+0.5)/count;
  let origin, direction;
  if(p.source==='parallel') {
    const r=p.beamRadius*Math.sqrt(u);
    origin=[r*Math.cos(phi),r*Math.sin(phi),p.distance]; direction=[0,0,-1];
  } else {
    const cos=1-u*(1-Math.cos(p.cone*D2R)), sin=Math.sqrt(Math.max(0,1-cos*cos));
    origin=[field.x,field.y,p.distance]; direction=[sin*Math.cos(phi),sin*Math.sin(phi),-cos];
  }
  if(p.layout==='birdbath') {origin=foldPoint(origin,p); direction=reflect(direction,SPLITTER_N);}
  return {origin,direction};
}

/** Trace only the designed path. Other splitter ports are audited, not traced. */
export function traceRay(origin,direction,p) {
  const points=[origin];
  let o=origin,d=unit(direction),power=1;
  const ledger={captured:0,exit:0,missed:0,absorbed:0,otherPort:0};
  const stop=reason=>({points:[...points,at(o,d,30)],direction:d,power:0,ledger,reason});
  if(p.layout==='birdbath') {
    const h=intersectSplitter(o,d,p);
    if(!h){ledger.missed=power; return stop('splitter-in');}
    points.push(h.point); ledger.otherPort+=power*(1-p.splitterR); power*=p.splitterR;
    o=h.point; d=reflect(d,h.normal);
  }
  const hit=intersectMirror(o,d,p);
  if(!hit){ledger.missed+=power;return stop('mirror');}
  points.push(hit.point);ledger.absorbed+=power*(1-p.reflectivity);power*=p.reflectivity;
  o=hit.point;d=unit(reflect(d,hit.normal));
  if(p.layout==='birdbath') {
    const h=intersectSplitter(o,d,p);
    if(!h){ledger.missed+=power;return stop('splitter-out');}
    points.push(h.point); ledger.otherPort+=power*p.splitterR;power*=1-p.splitterR;o=h.point;
  }
  const t=Math.abs(d[2])<EPS?-1:(p.detectorZ-o[2])/d[2];
  if(t<=EPS) {ledger.exit+=power;return {...stop('away'),power:0};}
  const screen=at(o,d,t);points.push(screen);
  const captured=(screen[0]-p.eyeX)**2+(screen[1]-p.eyeY)**2<=(p.pupil/2)**2;
  ledger[captured?'captured':'exit']+=power;
  return {points,direction:d,power,ledger,screen,captured,reason:'exit'};
}

function angularStats(directions) {
  if(directions.length<2) return {rms:null,centroid:null};
  const centroid=unit(directions.reduce((a,d)=>add(a,d),[0,0,0]));
  // atan2 avoids loss of precision near a perfectly collimated ray bundle.
  const angles=directions.map(d=>Math.atan2(norm(sub(d,mul(centroid,dot(d,centroid)))),dot(d,centroid)));
  return {rms:Math.sqrt(angles.reduce((s,a)=>s+a*a,0)/angles.length)/D2R*60,centroid};
}

export function simulate(raw,{includePaths=true,includeMap=true}={}) {
  const p=validate(raw),fields=fieldsFor(p),total=p.samples*fields.length,weight=1/total;
  const ledger={captured:0,exit:0,missed:0,absorbed:0,otherPort:0};
  const paths=[],screenHits=[],fieldStats=[];
  const stride=Math.max(1,Math.ceil(total/330));
  let reflected=0;
  for(const field of fields) {
    const directions=[],eyeDirections=[];let fieldPower=0,hits=0;
    for(let i=0;i<p.samples;i++) {
      const ray=launchRay(i,p.samples,field,p),r=traceRay(ray.origin,ray.direction,p);
      for(const key of Object.keys(ledger)) ledger[key]+=r.ledger[key]*weight;
      if(r.screen && r.power>0) {
        reflected++;directions.push(r.direction);
        screenHits.push({x:r.screen[0],y:r.screen[1],field:field.id,weight:r.power*weight});
        if(r.captured){eyeDirections.push(r.direction);fieldPower+=r.power/p.samples;hits++;}
      }
      if(includePaths && i%stride===0) paths.push({points:r.points,field:field.id,success:!!r.screen,power:r.power});
    }
    const full=angularStats(directions),eye=angularStats(eyeDirections);
    fieldStats.push({...field,outputRms:full.rms,eyeRms:eye.rms,centroid:full.centroid,received:fieldPower,pupilHits:hits,outputHits:directions.length});
  }
  const valid=fieldStats.filter(f=>f.outputRms!==null), rms=valid.length===fields.length?Math.sqrt(valid.reduce((s,f)=>s+f.outputRms**2,0)/fields.length):null;
  const eyeValid=fieldStats.filter(f=>f.eyeRms!==null),eyeRms=eyeValid.length===fields.length?Math.sqrt(eyeValid.reduce((s,f)=>s+f.eyeRms**2,0)/fields.length):null;
  const outPower=ledger.captured+ledger.exit;
  const result={version:VERSION,parameters:p,fields:fieldStats,total,reflected,paths,screenHits,ledger,
    energyError:Math.abs(Object.values(ledger).reduce((a,b)=>a+b,0)-1),
    rms,eyeRms,outputPower:outPower,coverage:fieldStats.filter(f=>f.pupilHits>0).length/fields.length,
    minPupilHits:Math.min(...fieldStats.map(f=>f.pupilHits)),
    paraxial:paraxial(p),
  };
  if(includeMap) result.eyebox=eyeboxMap(screenHits,p,fields.length);
  return result;
}

export function paraxial(p) {
  if(p.surface==='flat') return {f:null,image:-p.distance,fov:null};
  const f=p.radius/2,s=p.source==='parallel'?Infinity:p.distance;
  return {f,image:s===Infinity?f:Math.abs(s-f)<1e-9?null:f*s/(s-f),fov:2*Math.atan(p.width/(2*f))/D2R};
}

export function eyeboxMap(hits,p,fieldCount,size=21,extent=12) {
  const cells=[];const r2=(p.pupil/2)**2;
  for(let j=0;j<size;j++) for(let i=0;i<size;i++) {
    const x=-extent+i*extent*2/(size-1),y=-extent+j*extent*2/(size-1);
    let power=0;const seen=new Set();
    for(const h of hits) if((h.x-x)**2+(h.y-y)**2<=r2){power+=h.weight;seen.add(h.field);}
    cells.push({x,y,power,coverage:seen.size/fieldCount});
  }
  return {size,extent,cells,max:Math.max(0,...cells.map(c=>c.power))};
}

export function sweepAxes(p,n=13) {
  const make=(v,lo,hi)=>Array.from({length:n},(_,i)=>Math.max(lo,Math.min(hi,v*0.76+i*v*0.48/(n-1))));
  return {radii:make(p.radius,30,300),distances:make(p.distance,Math.max(20,p.layout==='birdbath'?p.splitterZ+5.1:20),180)};
}
export function sweepCell(raw,radius,distance) {
  const p={...raw,radius,distance};
  const r=simulate(p,{includePaths:false,includeMap:false});
  const minOutput=Math.min(...r.fields.map(f=>f.outputHits));
  // Full exit-bundle RMS prevents selecting a design just because its pupil clips bad rays.
  // Do not reward almost-dark designs. These are exploration gates, not product requirements.
  const feasible=r.rms!==null && r.outputPower>=0.03 && minOutput>=20;
  return {radius,distance,rms:r.rms,pupilPower:r.ledger.captured,outputPower:r.outputPower,coverage:r.coverage,minOutput,feasible,score:feasible?r.rms:null};
}

export function projectFromJSON(text) {
  const doc=JSON.parse(text);
  if(doc.schema!=='mirrorlab.project' || doc.schemaVersion!==1 || doc.units!=='mm') throw new Error('Expected a Mirrorlab v1 project in mm.');
  return validate(doc.parameters);
}
export function projectToJSON(p) {
  return JSON.stringify({schema:'mirrorlab.project',schemaVersion:1,units:'mm',solver:VERSION,parameters:validate(p)},null,2);
}
