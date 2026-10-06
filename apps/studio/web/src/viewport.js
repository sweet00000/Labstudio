// Three.js viewport for the CAD workspace. Z up, millimetres. Display only: the meshes
// here are copies of the kernel's output and never feed back into geometry.
import * as THREE from 'three';
import { OrbitControls } from '../../../mirrorlab/web/vendor/three/OrbitControls.js';

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e5);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(140, -180, 120);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(1, -2, 3);
    this.camera.add(sun); this.scene.add(this.camera);
    this.grid = new THREE.GridHelper(400, 40, 0x888888, 0x888888);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.25;
    this.scene.add(this.grid, new THREE.AxesHelper(20));
    this.partMat = new THREE.MeshStandardMaterial({ color: 0xd0d4da, metalness: 0.05, roughness: 0.55, flatShading: false });
    this.refMat = new THREE.MeshStandardMaterial({ color: 0x4a8cff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    this.selMat = new THREE.LineBasicMaterial({ color: 0xff8a1f });
    this.objects = { part: null, reference: null, selection: null };
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }

  setTheme({ bg, part, grid }) {
    this.scene.background = new THREE.Color(bg);
    this.partMat.color.set(part);
    this.grid.material.color.set(grid);
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // X-ray: see the reference optics through the part.
  setXray(on) {
    Object.assign(this.partMat, { transparent: on, opacity: on ? 0.28 : 1, depthWrite: !on });
    this.partMat.needsUpdate = true;
  }

  set(slot, mesh) {
    const old = this.objects[slot];
    if (old) { this.scene.remove(old); old.geometry.dispose(); }
    this.objects[slot] = null;
    if (!mesh || !mesh.idx.length) return;
    let obj;
    if (slot === 'selection') {
      // Outline the selected feature: its sharp edges, or its box if it's a smooth scan.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(mesh.pos, 3));
      g.setIndex(new THREE.BufferAttribute(mesh.idx, 1));
      const edges = new THREE.EdgesGeometry(g, 25);
      g.dispose();
      if (edges.attributes.position.count > 2 * mesh.idx.length / 3 * 0.2 || edges.attributes.position.count === 0) {
        edges.dispose();
        const box = new THREE.Box3().setFromArray(mesh.pos);
        obj = new THREE.Box3Helper(box, this.selMat.color);
      } else obj = new THREE.LineSegments(edges, this.selMat);
    } else {
      obj = new THREE.Mesh(creased(mesh.pos, mesh.idx, 30), slot === 'part' ? this.partMat : this.refMat);
      if (slot === 'reference') obj.renderOrder = 1;
    }
    this.scene.add(obj);
    this.objects[slot] = obj;
  }

  // Frame everything that's visible.
  fit() {
    const box = new THREE.Box3();
    for (const o of [this.objects.part, this.objects.reference]) if (o) box.expandByObject(o);
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50));
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 50;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(0.55, -0.7, 0.45);
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, (r / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.1);
    this.camera.near = r / 100; this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
    const step = 10 ** Math.floor(Math.log10(Math.max(r / 2, 1)));
    this.grid.scale.setScalar(step / 10);
    this.grid.position.set(Math.round(c.x / step) * step, Math.round(c.y / step) * step, 0);
  }

  view(name) {
    const dirs = { iso: [0.55, -0.7, 0.45], front: [0, -1, 0.0001], top: [0, -0.0001, 1], right: [1, 0, 0.0001] };
    const t = this.controls.target, d = this.camera.position.distanceTo(t);
    this.camera.position.copy(t).addScaledVector(new THREE.Vector3(...dirs[name]).normalize(), d);
  }

  png() { return this.canvas.toDataURL('image/png'); }
}

// Non-indexed geometry whose normals are smoothed across shallow angles and kept sharp
// across creases, so boxes look crisp and cylinders and scans look smooth.
function creased(pos, idx, angleDeg) {
  const nTri = idx.length / 3, cos = Math.cos((angleDeg * Math.PI) / 180);
  const fn = new Float32Array(nTri * 3), area = new Float32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[3 * t] = nx / l; fn[3 * t + 1] = ny / l; fn[3 * t + 2] = nz / l; area[t] = l;
  }
  const nV = pos.length / 3, start = new Uint32Array(nV + 1);
  for (let i = 0; i < idx.length; i++) start[idx[i] + 1]++;
  for (let v = 0; v < nV; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nV), faces = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) faces[fill[idx[i]]++] = (i / 3) | 0;
  const outP = new Float32Array(idx.length * 3), outN = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i], t = (i / 3) | 0;
    let nx = 0, ny = 0, nz = 0;
    for (let k = start[v]; k < start[v + 1]; k++) {
      const s = faces[k];
      if (fn[3 * s] * fn[3 * t] + fn[3 * s + 1] * fn[3 * t + 1] + fn[3 * s + 2] * fn[3 * t + 2] < cos) continue;
      nx += fn[3 * s] * area[s]; ny += fn[3 * s + 1] * area[s]; nz += fn[3 * s + 2] * area[s];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    outN[3 * i] = nx / l; outN[3 * i + 1] = ny / l; outN[3 * i + 2] = nz / l;
    outP[3 * i] = pos[3 * v]; outP[3 * i + 1] = pos[3 * v + 1]; outP[3 * i + 2] = pos[3 * v + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  return g;
}
