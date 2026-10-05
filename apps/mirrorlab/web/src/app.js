import {DEFAULTS,LIMITS,validate,projectFromJSON,projectToJSON} from './physics.js';
import {footprint,eyebox,sweepPlot} from './plots.js';
const $=id=>document.getElementById(id);
const presets={
  birdbath:{...DEFAULTS},
  collimator:{...DEFAULTS,layout:'single',surface:'paraboloid',source:'point'},
  focus:{...DEFAULTS,layout:'single',surface:'sphere',source:'parallel',detectorZ:50},
  flat:{...DEFAULTS,layout:'single',surface:'flat',source:'parallel',pitch:9,aperture:42,detectorZ:80},
};
const titles={birdbath:['Birdbath study','The birdbath assembly','One display. One curved mirror. A folded path to the eye.'],collimator:['Collimator study','From a point to parallel','A parabolic surface collimates light from its on-axis focus.'],focus:['Focus study','Where parallel rays meet','A spherical mirror reveals the difference between focus and aberration.'],flat:['Reflection study','An angle changes everything','Rotate the surface and follow the exact reflected direction.']};
let parameters={...DEFAULTS},currentPreset='birdbath',result=null,view=null,sweep=null,sweepWorker=null,activeTab='footprint',traceId=0,timer,sweepId=0,pending=false;
try {const stored=localStorage.getItem('mirrorlab.project');if(stored)parameters=projectFromJSON(stored);}catch{}
const options={showRays:true,showGrid:true,showMisses:false,showNormals:false};
const controls={
  mirrorControls:[['radius','Curvature radius','mm',1],['aperture','Clear diameter','mm',1],['reflectivity','Reflectance','',.01]],
  tiltControls:[['pitch','Pitch','°',.1],['yaw','Yaw','°',.1]],
  sourceControls:[['distance','Source path length','mm',.1],['cone','Cone half-angle','°',1],['width','Display width','mm',.1],['height','Display height','mm',.1],['beamRadius','Beam radius','mm',.5]],
  splitterControls:[['splitterZ','Mirror → splitter','mm',.5],['splitterSize','Square side','mm',1],['splitterR','Reflectance R','',.01]],
  eyeControls:[['detectorZ','Eye plane · z','mm',.5],['pupil','Pupil diameter','mm',.5],['eyeX','Horizontal shift','mm',.5],['eyeY','Vertical shift','mm',.5]],
};
for(const [group,list]of Object.entries(controls))for(const [key,label,unit,step]of list){const [min,max]=LIMITS[key];const el=document.createElement('div');el.className='control';el.dataset.control=key;el.innerHTML=`<div class="control-line"><label for="${key}">${label}</label><div class="number-box"><input id="${key}" data-param="${key}" type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}"><span>${unit}</span></div></div><input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label} slider">`;
  $(group).append(el);
}
function fmt(v,n=2){return v===null||!Number.isFinite(v)?'—':v.toFixed(n);}
function setStatus(text,state=''){ $('statusText').textContent=text;$('statusDot').className=`micro-dot ${state}`;}
let toastTimer;function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function updateControls(){
  document.querySelectorAll('[data-param]').forEach(el=>el.value=parameters[el.dataset.param]);
  document.querySelectorAll('[data-range]').forEach(el=>el.value=parameters[el.dataset.range]);
  for(const [key,show] of Object.entries({radius:parameters.surface!=='flat',cone:parameters.source!=='parallel',width:parameters.source==='grid',height:parameters.source==='grid',beamRadius:parameters.source==='parallel'}))document.querySelector(`[data-control="${key}"]`).hidden=!show;
  $('splitterPanel').hidden=$('splitterTree').hidden=parameters.layout!=='birdbath';
  $('elementCount').textContent=parameters.layout==='birdbath'?'04 ELEMENTS':'03 ELEMENTS';
  $('mirrorTreeLabel').textContent=`${{sphere:'Spherical',paraboloid:'Parabolic',flat:'Plane'}[parameters.surface]} · Ø ${parameters.aperture} mm`;
  $('sourceTreeLabel').textContent={grid:'3 × 3 sampled display',point:'On-axis point source',parallel:'Uniform incident disk'}[parameters.source];
  $('label-source').lastChild.textContent=parameters.source==='grid'?'DISPLAY':'SOURCE';
  $('eyeTreeLabel').textContent=`Ø ${parameters.pupil} mm · z ${parameters.detectorZ} mm`;
  $('emissionNote').textContent=parameters.source==='parallel'?'Uniform-area disk with parallel rays.':'Uniform solid-angle cone. Each field carries equal power.';
  $('sweepBtn').disabled=parameters.surface==='flat'||parameters.source==='parallel';
  if($('sweepBtn').disabled)$('sweepStatus').textContent='Use a curved mirror and point/display source for this collimation sweep.';
}
function updateTitles(){const t=titles[currentPreset];$('projectTitle').textContent=t[0];$('sceneHeading').textContent=t[1];$('sceneSubheading').textContent=t[2];$('quickPreset').value=currentPreset;}
function cancelSweep(){if(sweepWorker){sweepWorker.terminate();sweepWorker=null;sweepId++;}$('sweepBtn').textContent='Run 13 × 13 sweep ↗';}
function invalidateSweep(){cancelSweep();delete document.body.dataset.sweepReady;sweep=null;$('applyBestBtn').disabled=true;$('sweepPlaceholder').hidden=false;$('sweepStatus').textContent='Uses the current field and ray sampling.';drawPlots();}
function change(next,{resetSweep=true}={}) {
  try {parameters=validate(next);}catch(e){toast(e.message);updateControls();return false;}
  if(resetSweep)invalidateSweep();updateControls();
  try {localStorage.setItem('mirrorlab.project',projectToJSON(parameters));}catch{toast('Local saving is unavailable. Use Save project to keep your design.');}
  schedule();return true;
}
document.querySelectorAll('[data-param]').forEach(el=>el.addEventListener('change',()=>{
  const key=el.dataset.param,value=typeof DEFAULTS[key]==='number'?Number(el.value):el.value;
  if(el.value===''){toast('Enter a value within the displayed range.');updateControls();return;}
  change({...parameters,[key]:value});
}));
document.querySelectorAll('[data-range]').forEach(el=>el.addEventListener('input',()=>change({...parameters,[el.dataset.range]:Number(el.value)})));
$('preset').addEventListener('change',()=>{currentPreset=$('preset').value;updateTitles();change(presets[currentPreset]);view?.cameraView('fit');});
$('quickPreset').addEventListener('change',()=>{$('preset').value=$('quickPreset').value;$('preset').dispatchEvent(new Event('change'));});
$('quickReset').addEventListener('click',()=>$('resetBtn').click());
$('resetBtn').addEventListener('click',()=>{change(presets[currentPreset]);view?.cameraView('fit');toast('Study reset.');});
document.querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-inspect]').forEach(el=>el.classList.remove('selected'));b.classList.add('selected');$(b.dataset.inspect).scrollIntoView({behavior:'smooth',block:'nearest'});}));
for(const key of Object.keys(options))$(key).addEventListener('change',()=>{options[key]=$(key).checked;if(result)view?.update(result,options);});
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='r'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!e.ctrlKey&&!e.metaKey){$('showRays').checked=!$('showRays').checked;$('showRays').dispatchEvent(new Event('change'));}});
document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>{view?.cameraView(b.dataset.camera);document.querySelectorAll('[data-camera]').forEach(el=>el.classList.toggle('active',el===b));}));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{activeTab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-selected',String(el===b)));for(const t of ['footprint','eyebox','sweep'])$(`tab-${t}`).hidden=t!==activeTab;drawPlots();}));
for(const name of ['guide','roadmap']){$(`${name}Btn`).addEventListener('click',()=>$(`${name}Dialog`).showModal());$(`${name}Dialog`).querySelector('.dialog-close').addEventListener('click',()=>$(`${name}Dialog`).close());$(`${name}Dialog`).addEventListener('click',e=>{if(e.target===$(`${name}Dialog`)){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('saveBtn').addEventListener('click',()=>{download(new Blob([projectToJSON(parameters)],{type:'application/json'}),'mirrorlab-project.json');toast('Project exported with all optical parameters.');});
$('importBtn').addEventListener('click',()=>$('projectFile').click());
$('projectFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1e6)throw new Error('Project is larger than 1 MB.');const p=projectFromJSON(await file.text());change(p);currentPreset=p.layout==='birdbath'?'birdbath':p.surface==='flat'?'flat':p.source==='parallel'?'focus':'collimator';$('preset').value=currentPreset;updateTitles();view?.cameraView('fit');toast('Project opened.');}catch(error){toast(error.message);}e.target.value='';});
$('snapshotBtn').addEventListener('click',()=>{if(!view)return toast('The 3D renderer is unavailable.');const a=document.createElement('a');a.href=view.png();a.download='mirrorlab-viewport.png';a.click();});
function csv(){if(activeTab==='sweep'&&sweep){const keys=['radius','distance','rms','pupilPower','outputPower','coverage','minOutput','feasible'];return '# Mirrorlab sweep: lengths mm; RMS arcmin; power fractions\n'+keys.join(',')+'\n'+sweep.cells.map(c=>keys.map(k=>c[k]??'').join(',')).join('\n');}
  const keys=['id','x','y','outputRms','eyeRms','received','pupilHits','outputHits'];return '# Mirrorlab fields: positions mm; RMS arcmin; received is fraction per field\n'+keys.join(',')+'\n'+result.fields.map(c=>keys.map(k=>c[k]??'').join(',')).join('\n');}
$('csvBtn').addEventListener('click',()=>{if(!result||pending)return toast('Wait for the current trace to finish.');download(new Blob([csv()],{type:'text/csv'}),activeTab==='sweep'&&sweep?'mirrorlab-sweep.csv':'mirrorlab-fields.csv');});
let worker;
try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});}catch(e){setStatus('A local HTTP server is required. Run npm run dev, then open the shown URL.','error');}
if(worker){worker.onmessage=({data})=>{
  if(data.id!==traceId)return;
  if(data.type==='error'){pending=false;setStatus(data.message,'error');return;}
  result=data.result;pending=false;renderResult();
};worker.onerror=()=>{pending=false;setStatus('The simulation worker failed. Reload the app from an HTTP server.','error');};}
function schedule(){pending=true;traceId++;clearTimeout(timer);setStatus('Tracing the current geometry…','busy');$('csvBtn').disabled=true;timer=setTimeout(()=>worker?.postMessage({type:'trace',id:traceId,parameters}),90);}
function renderResult(){
  const r=result,p=r.parameters;view?.update(r,options);$('rmsMetric').textContent=fmt(r.rms);$('powerMetric').textContent=`${fmt(r.ledger.captured*100,3)}%`;
  $('coverageMetric').textContent=`${r.fields.filter(f=>f.pupilHits>0).length} / ${r.fields.length}`;
  $('focusMetric').textContent=r.paraxial.f===null?'∞':`${fmt(r.paraxial.f,1)} mm`;
  $('focusCaption').textContent=p.surface==='flat'?'Plane mirror · no focusing power':'R / 2 · near-axis estimate';
  $('eyeRms').textContent=`${fmt(r.eyeRms,3)} arcmin`;$('minHits').textContent=r.minPupilHits;$('energyError').textContent=r.energyError.toExponential(1);
  $('samplingNote').textContent=r.minPupilHits<10?'Few pupil hits: increase rays per field before comparing eye quality.':'Ideal point fields; increase sampling to check convergence.';
  const visible=r.paths.filter(p=>p.success||options.showMisses).length;$('rayCount').textContent=`${r.total.toLocaleString()} traced · ${visible} shown`;
  $('csvBtn').disabled=false;drawPlots();
  setStatus(`Trace complete · ${r.total.toLocaleString()} rays · energy conserved to ${r.energyError.toExponential(0)}`);
  document.body.dataset.ready='true';
}
function drawPlots(){if(!result){if(activeTab==='sweep')sweepPlot($('sweepCanvas'),sweep);return;}if(activeTab==='footprint')footprint($('footprintCanvas'),result);if(activeTab==='eyebox')eyebox($('eyeboxCanvas'),result);if(activeTab==='sweep')sweepPlot($('sweepCanvas'),sweep);}
new ResizeObserver(drawPlots).observe(document.querySelector('.analysis-body'));
window.addEventListener('resize',drawPlots);
$('eyeboxCanvas').addEventListener('click',e=>{const q=$('eyeboxCanvas')._mapPoint?.(e);if(!q||Math.abs(q.x)>12||Math.abs(q.y)>12)return;change({...parameters,eyeX:Math.round(q.x*10)/10,eyeY:Math.round(q.y*10)/10});});
$('sweepCanvas').addEventListener('click',e=>{const c=$('sweepCanvas')._sweepCell?.(e);if(!c||!sweep)return;toast(`R ${c.radius.toFixed(1)} mm · L ${c.distance.toFixed(1)} mm · RMS ${fmt(c.rms)} arcmin${c.feasible?'':' · excluded'}`);});
$('sweepBtn').addEventListener('click',()=>{
  if(sweepWorker){cancelSweep();$('sweepStatus').textContent='Sweep cancelled.';return;}
  sweep=null;$('applyBestBtn').disabled=true;$('sweepPlaceholder').hidden=false;$('sweepPlaceholder').textContent='Tracing candidate designs…';drawPlots();
  const id=++sweepId;const snapshot={...parameters};sweepWorker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  $('sweepBtn').textContent='Cancel sweep';$('sweepStatus').textContent='Starting…';
  sweepWorker.onmessage=({data})=>{if(data.id!==id)return;if(data.type==='progress'){$('sweepStatus').textContent=`${Math.round(data.progress*100)}% · ${snapshot.samples.toLocaleString()} rays per field`;return;}
    if(data.type==='error'){cancelSweep();$('sweepStatus').textContent=data.message;return;}
    sweep=data.result;cancelSweep();$('sweepPlaceholder').hidden=true;$('applyBestBtn').disabled=!sweep.best;drawPlots();
    $('sweepStatus').textContent=sweep.best?`Best: R ${sweep.best.radius.toFixed(1)} · L ${sweep.best.distance.toFixed(1)} mm · ${fmt(sweep.best.rms)} arcmin. Verify with denser sampling.`:'No candidate passed the light and sampling gates.';
    document.body.dataset.sweepReady='true';
  };
  sweepWorker.onerror=()=>{cancelSweep();$('sweepStatus').textContent='Sweep worker failed. Try again or reduce sampling.';};
  sweepWorker.postMessage({type:'sweep',id,parameters:snapshot});
});
$('applyBestBtn').addEventListener('click',()=>{if(!sweep?.best)return;const c=sweep.best;change({...sweep.parameters,radius:c.radius,distance:c.distance},{resetSweep:false});toast('Best sampled candidate applied. Check the pupil and increase sampling.');});
// Read-only diagnostic snapshot used by the reproducible browser smoke test.
window.mirrorlab={get result(){return result;},get parameters(){return {...parameters};},get sweep(){return sweep;},get pending(){return pending;}};
async function boot(){
  updateControls();currentPreset=parameters.layout==='birdbath'?'birdbath':parameters.surface==='flat'?'flat':parameters.source==='parallel'?'focus':'collimator';$('preset').value=currentPreset;updateTitles();
  // Loading Three separately lets the numerical tools work even without WebGL.
  try{const {Viewport}=await import('./view.js');view=new Viewport($('viewport'));}catch(e){$('renderError').hidden=false;$('renderError').textContent='3D rendering needs WebGL 2. Try a browser with graphics acceleration. The numerical results and exports still work.';console.warn('Renderer unavailable:',e.message);}
  schedule();
}
boot();
