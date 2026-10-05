import * as THREE from 'three';
import {OrbitControls} from '../vendor/three/OrbitControls.js';
import {basis,toWorld,sag,foldPoint} from './physics.js';

export const FIELD_COLORS=['#8eacd9','#75c6d3','#d5b17c','#a1c29b','#efbf78','#d79ba3','#9a99cd','#6dbfa6','#bbbd86'];
const V = p => new THREE.Vector3(...p);
export class Viewport {
  constructor(container) {
    this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#111c20');
    this.camera=new THREE.PerspectiveCamera(39,1,0.1,3000);
    this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.setClearColor('#111c20');
    this.canvas=this.renderer.domElement;container.prepend(this.canvas);
    this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=false;
    this.controls.minDistance=20;this.controls.maxDistance=900;this.controls.target.set(0,2,35);
    this.controls.addEventListener('change',()=>this.draw());
    this.scene.add(new THREE.HemisphereLight(0xdbfff0,0x18262b,2.5));
    const key=new THREE.DirectionalLight(0xffffff,3.3);key.position.set(60,110,50);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x83a9cf,2);rim.position.set(-70,5,-30);this.scene.add(rim);
    this.model=new THREE.Group();this.scene.add(this.model);this.options={showRays:true,showGrid:true,showMisses:false,showNormals:false};
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.cameraView('perspective');this.resize();
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();document.getElementById('renderError').hidden=false;document.getElementById('renderError').textContent='The 3D graphics context was lost. Reload the page to restore the viewport; your local parameters are saved.';});
  }
  resize(){const {width,height}=this.container.getBoundingClientRect();this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.draw();}
  cameraView(name) {
    const p=this.p, z=p?p.detectorZ/2:36,scale=p?Math.max(75,p.detectorZ,p.distance):85;
    this.controls.target.set(0,3,z);
    if(name==='side'){this.camera.up.set(0,1,0);this.camera.position.set(scale*2,3,z);}
    else if(name==='front'){this.camera.up.set(0,1,0);this.camera.position.set(0,3,z+scale*2.1);}
    else {this.camera.up.set(0,1,0);this.camera.position.set(scale*1.3,scale*.88,z+scale*1.55);}
    this.controls.update();this.draw();
  }
  disposeModel(){this.model.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.model.clear();}
  line(points,color,opacity=1){const g=new THREE.BufferGeometry().setFromPoints(points.map(V));const l=new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));this.model.add(l);return l;}
  mesh(geometry,color,options={}){const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.45,metalness:.35,...options}));this.model.add(mesh);return mesh;}
  ring(r,z,b,color,tube=.28){const g=new THREE.TorusGeometry(r,tube,8,128),mesh=this.mesh(g,color);const matrix=new THREE.Matrix4().makeBasis(V(b[0]),V(b[1]),V(b[2]));mesh.setRotationFromMatrix(matrix);mesh.position.copy(V(toWorld([0,0,z],b)));return mesh;}
  update(result,options=this.options) {
    this.p=result.parameters;this.result=result;this.options=options;this.disposeModel();
    const p=this.p,b=basis(p),a=p.aperture/2,N=96,rings=24,pos=[],idx=[];
    for(let j=0;j<=rings;j++) for(let i=0;i<=N;i++) {
      const r=a*j/rings,t=i*2*Math.PI/N;
      pos.push(...toWorld([r*Math.cos(t),r*Math.sin(t),sag(r,p)],b));
    }
    for(let j=0;j<rings;j++)for(let i=0;i<N;i++){const k=j*(N+1)+i;idx.push(k,k+1,k+N+1,k+1,k+N+2,k+N+1);}
    const mirrorG=new THREE.BufferGeometry();mirrorG.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));mirrorG.setIndex(idx);mirrorG.computeVertexNormals();
    this.mesh(mirrorG,0x8dbdad,{side:THREE.DoubleSide,transparent:true,opacity:.65,metalness:.8,roughness:.23,depthWrite:false});
    this.ring(a+.2,sag(a,p),b,0x84978c,.8);this.ring(a+1.5,sag(a,p)-.5,b,0x273a38,.5);
    for(const frac of [.25,.5,.75]){
      const r=a*frac,points=Array.from({length:97},(_,i)=>toWorld([r*Math.cos(i*2*Math.PI/96),r*Math.sin(i*2*Math.PI/96),sag(r,p)+.03],b));
      this.line(points,0xb0e0ca,.19);
    }
    for(let i=0;i<8;i++){const t=i*Math.PI/4;this.line(Array.from({length:25},(_,j)=>{const r=j*a/24;return toWorld([r*Math.cos(t),r*Math.sin(t),sag(r,p)+.05],b);}),0xb0e0ca,.12);}
    const floor=-a-10,benchLength=Math.max(120,p.detectorZ+40,p.distance+40);
    if(options.showGrid){const grid=new THREE.GridHelper(Math.max(160,benchLength),20,0x3b5154,0x27383c);grid.position.set(0,floor,benchLength/2-30);grid.material.transparent=true;grid.material.opacity=.48;this.model.add(grid);}
    const base=this.mesh(new THREE.BoxGeometry(p.aperture+10,2,12),0x233332);base.position.set(0,floor+1,0);
    const stand=this.mesh(new THREE.CylinderGeometry(1.3,1.6,10,16),0x6a7e73);stand.position.set(0,-a-4,0);
    // The decorative stand and optical bench do not participate in tracing.
    this.line([[0,0,-8],[0,0,p.detectorZ+12]],0x587771,.23);
    const displayCenter=p.layout==='birdbath'?foldPoint([0,0,p.distance],p):[0,0,p.distance];
    const displayW=p.source==='parallel'?p.beamRadius*2:p.source==='point'?4:p.width;
    const displayH=p.source==='parallel'?p.beamRadius*2:p.source==='point'?4:p.height;
    const panel=this.mesh(new THREE.BoxGeometry(displayW+3,displayH+3,.7),0x483d29,{metalness:.35});
    const emitter=this.mesh(new THREE.PlaneGeometry(displayW,displayH),0xeeb563,{emissive:0xb96d27,emissiveIntensity:.65,side:THREE.DoubleSide,transparent:true,opacity:.8});
    panel.position.copy(V(displayCenter));emitter.position.copy(V(displayCenter));
    if(p.layout==='birdbath'){panel.rotation.x=Math.PI/2;emitter.rotation.x=Math.PI/2;emitter.position.y-=.4;}
    else{emitter.position.z-=.4;}
    if(p.layout==='birdbath') {
      const splitter=this.mesh(new THREE.PlaneGeometry(p.splitterSize,p.splitterSize),0x6dacbc,{transparent:true,opacity:.16,side:THREE.DoubleSide,metalness:.1,roughness:.2,depthWrite:false});
      splitter.rotation.x=Math.PI/4;splitter.position.set(0,0,p.splitterZ);
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(splitter.geometry),new THREE.LineBasicMaterial({color:0x78bac4,transparent:true,opacity:.5}));edges.rotation.copy(splitter.rotation);edges.position.copy(splitter.position);this.model.add(edges);
    }
    const eyePlane=this.mesh(new THREE.PlaneGeometry(42,42),0x9686bc,{side:THREE.DoubleSide,transparent:true,opacity:.035,depthWrite:false});eyePlane.position.z=p.detectorZ;
    const pupil=this.mesh(new THREE.TorusGeometry(p.pupil/2,.2,8,80),0xc9b9e9,{emissive:0x6c508a,emissiveIntensity:.4});pupil.position.set(p.eyeX,p.eyeY,p.detectorZ);
    for(const line of [[[-21,0,p.detectorZ],[21,0,p.detectorZ]],[[0,-21,p.detectorZ],[0,21,p.detectorZ]]])this.line(line,0x9383b2,.23);
    for(const side of [-1,1])for(const x of [-1,1]){const z=p.detectorZ;this.line([[21*x,16*side,z],[21*x,21*side,z],[16*x,21*side,z]],0x9383b2,.65);}
    if(options.showRays) {
      const groups=new Map();
      for(const path of result.paths) {
        if(!path.success && !options.showMisses) continue;
        const key=path.success?path.field:-1;if(!groups.has(key))groups.set(key,[]);
        for(let i=1;i<path.points.length;i++)groups.get(key).push(...path.points[i-1],...path.points[i]);
      }
      for(const [key,points] of groups){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const m=new THREE.LineBasicMaterial({color:key<0?'#9e6970':FIELD_COLORS[key],transparent:true,opacity:key<0?.12:.36,depthWrite:false});this.model.add(new THREE.LineSegments(g,m));}
    }
    if(options.showNormals)for(let i=0;i<result.paths.length;i+=12){const path=result.paths[i];if(!path.success)continue;const q=path.points[p.layout==='birdbath'?2:1];const local=b.map(axis=>axis[0]*q[0]+axis[1]*q[1]+axis[2]*q[2]);const n=V(toWorld(p.surface==='flat'?[0,0,1]:p.surface==='sphere'?[-local[0],-local[1],p.radius-local[2]]:[-local[0]/p.radius,-local[1]/p.radius,1],b)).normalize();this.line([q,V(q).addScaledVector(n,5).toArray()],0xe7ecd0,.8);}
    this.anchors={source:V(displayCenter).add(new THREE.Vector3(displayW/2+3,3,0)),mirror:V(toWorld([-a-4,4,sag(a,p)],b)),splitter:new THREE.Vector3(p.splitterSize/2+2,1,p.splitterZ),eye:new THREE.Vector3(p.eyeX+p.pupil/2+3,p.eyeY,p.detectorZ)};
    this.draw();
  }
  draw(){if(!this.renderer)return;this.renderer.render(this.scene,this.camera);if(!this.anchors)return;const w=this.container.clientWidth,h=this.container.clientHeight;for(const [name,anchor]of Object.entries(this.anchors)){const el=document.getElementById(`label-${name}`),v=anchor.clone().project(this.camera);el.hidden=v.z>1||v.z<-1||(name==='splitter'&&this.p.layout!=='birdbath');el.style.left=`${Math.min(w-92,Math.max(5,(v.x+1)*w/2))}px`;el.style.top=`${Math.min(h-50,Math.max(110,(-v.y+1)*h/2))}px`;}}
  png(){this.draw();return this.canvas.toDataURL('image/png');}
}
