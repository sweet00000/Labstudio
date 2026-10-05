// WebGPU renderer for the tunnel: ground grid, body mesh, velocity slice,
// advected tracer streaks, and a scan-preview point cloud.
// World coordinates = lattice coordinates (x = flow direction, y = up).

const TRACER_WG = 64;

const COMMON = /* wgsl */`
struct View {
  vp: mat4x4f,
  eye: vec4f,
  grid: vec4u,          // nx, ny, nz, n
  slice: vec4f,         // z position, u0 (freestream speed), opacity, show (0/1)
  vp_px: vec4f,         // width, height, point size px, streak scale
  bg: vec4f, ink: vec4f, slow: vec4f, fast: vec4f, neutral: vec4f, body: vec4f, smoke: vec4f,
};
@group(0) @binding(0) var<uniform> V: View;

// speed ratio r = |u|/U. Below freestream -> slow color, above -> fast color.
fn speedColor(r: f32) -> vec3f {
  if (r < 1.0) { return mix(V.slow.rgb, V.neutral.rgb, smoothstep(0.0, 1.0, r)); }
  return mix(V.neutral.rgb, V.fast.rgb, smoothstep(1.0, 1.6, r));
}
`;

const VELSAMPLE = /* wgsl */`
@group(0) @binding(1) var<storage, read> vel: array<vec2u>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
fn cellVel(x: i32, y: i32, z: i32) -> vec3f {
  let nx = i32(V.grid.x); let ny = i32(V.grid.y); let nz = i32(V.grid.z);
  let c = u32(clamp(x, 0, nx - 1) + nx * (clamp(y, 0, ny - 1) + ny * clamp(z, 0, nz - 1)));
  let a = unpack2x16float(vel[c].x); let b = unpack2x16float(vel[c].y);
  return vec3f(a.x, a.y, b.x);
}
fn sampleVel(p: vec3f) -> vec3f {
  let q = floor(p); let f = p - q; let i = vec3i(q);
  let c000 = cellVel(i.x, i.y, i.z);         let c100 = cellVel(i.x + 1, i.y, i.z);
  let c010 = cellVel(i.x, i.y + 1, i.z);     let c110 = cellVel(i.x + 1, i.y + 1, i.z);
  let c001 = cellVel(i.x, i.y, i.z + 1);     let c101 = cellVel(i.x + 1, i.y, i.z + 1);
  let c011 = cellVel(i.x, i.y + 1, i.z + 1); let c111 = cellVel(i.x + 1, i.y + 1, i.z + 1);
  let x00 = mix(c000, c100, f.x); let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x); let x11 = mix(c011, c111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
fn isSolidAt(p: vec3f) -> bool {
  let nx = i32(V.grid.x); let ny = i32(V.grid.y); let nz = i32(V.grid.z);
  let i = vec3i(floor(p + 0.5));
  if (i.x < 0 || i.y < 0 || i.z < 0 || i.x >= nx || i.y >= ny || i.z >= nz) { return true; }
  let f = flags[u32(i.x + nx * (i.y + ny * i.z))];
  return f == 1u || f == 2u;
}
`;

const TRACER_COMPUTE = COMMON + VELSAMPLE + /* wgsl */`
struct Adv { steps: f32, seed: u32, count: u32, pad: u32 };
@group(0) @binding(3) var<uniform> A: Adv;
@group(0) @binding(4) var<storage, read_write> parts: array<vec4f>;   // xyz, age
@group(0) @binding(5) var<storage, read_write> pvel: array<vec4f>;    // velocity, speed ratio

fn hash(v: u32) -> u32 { var x = v * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; return (x >> 22u) ^ x; }
fn rnd(s: ptr<function, u32>) -> f32 { *s = hash(*s); return f32(*s) / 4294967295.0; }

@compute @workgroup_size(${TRACER_WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= A.count) { return; }
  var p = parts[i];
  var s = hash(i ^ (A.seed * 9781u));
  let dims = vec3f(f32(V.grid.x), f32(V.grid.y), f32(V.grid.z));
  // midpoint (RK2) advection through the flow field
  let v1 = sampleVel(p.xyz);
  let v2 = sampleVel(p.xyz + 0.5 * A.steps * v1);
  var np = p.xyz + A.steps * v2;
  var age = p.w + 1.0;
  let out = np.x > dims.x - 2.0 || np.y < 0.5 || np.z < 1.0 || np.y > dims.y - 2.0 || np.z > dims.z - 2.0;
  if (out || isSolidAt(np) || age > 900.0 + 300.0 * rnd(&s)) {
    // respawn on the inlet plane, mostly in a band around the body (like a smoke rake)
    let band = rnd(&s) < 0.8;
    let y = select(1.0 + rnd(&s) * (dims.y - 3.0), 1.0 + rnd(&s) * dims.y * 0.55, band);
    let z = select(1.0 + rnd(&s) * (dims.z - 2.0), dims.z * (0.3 + 0.4 * rnd(&s)), band);
    np = vec3f(1.5 + rnd(&s) * 2.0, y, z);
    age = 0.0;
  }
  parts[i] = vec4f(np, age);
  let v = sampleVel(np);
  pvel[i] = vec4f(v, length(v) / max(V.slice.y, 1e-6));
}
`;

const STREAK_RENDER = COMMON + /* wgsl */`
@group(0) @binding(1) var<storage, read> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read> pvel: array<vec4f>;
struct O { @builtin(position) pos: vec4f, @location(0) col: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> O {
  let p = parts[ii]; let v = pvel[ii];
  let head = V.vp * vec4f(p.xyz, 1.0);
  let tail = V.vp * vec4f(p.xyz - v.xyz * V.vp_px.w, 1.0);
  let a = head.xy / head.w; let b = tail.xy / tail.w;
  var dir = (a - b) * V.vp_px.xy;
  if (length(dir) < 1e-3) { dir = vec2f(1.0, 0.0); }
  let n = normalize(vec2f(-dir.y, dir.x)) / V.vp_px.xy * 1.6;
  let corner = array<vec2f, 6>(vec2f(0, -1), vec2f(1, -1), vec2f(1, 1), vec2f(0, -1), vec2f(1, 1), vec2f(0, 1))[vi];
  let base = select(tail, head, corner.x > 0.5);
  var o: O;
  o.pos = vec4f(base.xy + n * corner.y * base.w, base.z, base.w);
  let fade = min(1.0, p.w / 20.0);
  // smoke keeps its own color in free stream and takes the speed color where the flow deviates
  let dev = clamp(abs(v.w - 1.0) * 3.0, 0.0, 1.0);
  o.col = vec4f(mix(V.smoke.rgb, speedColor(v.w), dev), 0.75 * fade * select(0.35, 1.0, corner.x > 0.5));
  if (p.w < 0.5) { o.col.a = 0.0; }
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f { return vec4f(i.col.rgb * i.col.a, i.col.a); }
`;

const SLICE_RENDER = COMMON + VELSAMPLE + /* wgsl */`
struct O { @builtin(position) pos: vec4f, @location(0) w: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> O {
  let q = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[vi];
  let w = vec3f(q.x * f32(V.grid.x - 1u), q.y * f32(V.grid.y - 1u), V.slice.x);
  var o: O; o.pos = V.vp * vec4f(w, 1.0); o.w = w; return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  if (isSolidAt(i.w) || i.w.y < 1.0) { discard; }
  let v = sampleVel(i.w);
  let r = length(v) / max(V.slice.y, 1e-6);
  var c = speedColor(r);
  // faint contour lines every 0.1 U
  let k = fract(r * 10.0);
  let line = 1.0 - smoothstep(0.0, 0.08, min(k, 1.0 - k));
  c = mix(c, V.ink.rgb, 0.25 * line);
  let a = V.slice.z;
  return vec4f(c * a, a);
}
`;

const MESH_RENDER = COMMON + /* wgsl */`
struct I { @location(0) p: vec3f, @location(1) n: vec3f };
struct O { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) w: vec3f };
@vertex fn vs(i: I) -> O { var o: O; o.pos = V.vp * vec4f(i.p, 1.0); o.n = i.n; o.w = i.p; return o; }
@fragment fn fs(i: O) -> @location(0) vec4f {
  let n = normalize(i.n);
  let l = normalize(vec3f(0.35, 0.9, 0.45));
  let e = normalize(V.eye.xyz - i.w);
  let diff = 0.45 + 0.55 * max(dot(n, l), 0.0);
  let rim = pow(1.0 - max(dot(n, e), 0.0), 3.0);
  let c = V.body.rgb * diff + V.ink.rgb * rim * 0.35;
  return vec4f(c, 1.0);
}
`;

const GRID_RENDER = COMMON + /* wgsl */`
struct O { @builtin(position) pos: vec4f, @location(0) w: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> O {
  let q = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[vi];
  let w = vec2f(q.x * f32(V.grid.x - 1u), q.y * f32(V.grid.z - 1u));
  var o: O; o.pos = V.vp * vec4f(w.x, 0.5, w.y, 1.0); o.w = w; return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let g1 = abs(fract(i.w / 4.0 - 0.5) - 0.5) / fwidth(i.w / 4.0);
  let g2 = abs(fract(i.w / 20.0 - 0.5) - 0.5) / fwidth(i.w / 20.0);
  let l1 = 1.0 - min(min(g1.x, g1.y), 1.0);
  let l2 = 1.0 - min(min(g2.x, g2.y), 1.0);
  let c = mix(V.bg.rgb, V.ink.rgb, 0.10 * l1 + 0.22 * l2);
  return vec4f(c, 1.0);
}
`;

const POINTS_RENDER = COMMON + /* wgsl */`
@group(0) @binding(1) var<storage, read> pts: array<f32>;
@group(0) @binding(2) var<storage, read> cols: array<u32>;
struct O { @builtin(position) pos: vec4f, @location(0) col: vec4f, @location(1) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> O {
  let p = vec3f(pts[3u * ii], pts[3u * ii + 1u], pts[3u * ii + 2u]);
  let c = V.vp * vec4f(p, 1.0);
  let q = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1))[vi];
  var o: O;
  o.pos = vec4f(c.xy + q * V.vp_px.z / V.vp_px.xy * c.w, c.z, c.w);
  o.col = unpack4x8unorm(cols[ii]);
  o.uv = q;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  if (dot(i.uv, i.uv) > 1.0) { discard; }
  return vec4f(i.col.rgb, 1.0);
}
`;

// ---------- tiny matrix helpers (column-major) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0];
}
function lookAt(e, c, up) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]; };

export class Renderer {
  constructor(device, canvas, format) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;
    this.ctx = canvas.getContext('webgpu');
    this.ctx.configure({ device, format, alphaMode: 'opaque' });
    this.view = device.createBuffer({ size: 256 + 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.adv = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cam = { yaw: -0.65, pitch: 0.38, dist: 1, target: [0, 0, 0] };
    this.grid = [8, 8, 8];
    this.u0 = 0.08;
    this.sliceZ = 4; this.sliceAlpha = 0.9; this.showSlice = true; this.showTracers = true;
    this.theme = { bg: '#eef3ea', ink: '#2442a8', slow: '#c2410c', fast: '#2442a8', neutral: '#f4f6ef', body: '#9aa39a', smoke: '#4a5a50' };
    this.mesh = null; this.points = null; this.tracers = null; this.lbm = null;
    this.seed = 1;
    this._build();
  }

  _pipe(code, opts) {
    const d = this.device;
    const module = d.createShaderModule({ code });
    return d.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs', buffers: opts.buffers || [] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, blend: opts.blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: opts.depthWrite !== false, depthCompare: 'less' },
    });
  }

  _build() {
    const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    this.pGrid = this._pipe(GRID_RENDER, {});
    this.pMesh = this._pipe(MESH_RENDER, { buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] });
    this.pSlice = this._pipe(SLICE_RENDER, { blend: premul });
    this.pStreak = this._pipe(STREAK_RENDER, { blend: premul, depthWrite: false });
    this.pPoints = this._pipe(POINTS_RENDER, {});
    this.pAdvect = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code: TRACER_COMPUTE }), entryPoint: 'main' } });
    this.bgGrid = this.device.createBindGroup({ layout: this.pGrid.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.view } }] });
    this.bgMesh = this.device.createBindGroup({ layout: this.pMesh.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.view } }] });
  }

  setTheme(t) { Object.assign(this.theme, t); }

  setGrid(nx, ny, nz) {
    this.grid = [nx, ny, nz];
    this.sliceZ = nz / 2;
    this.cam.target = [nx * 0.42, ny * 0.22, nz / 2];
    this.cam.dist = Math.max(nx, nz) * 0.95;
  }

  // mesh in lattice coordinates
  setMesh(pos, idx) {
    this.mesh?.vb.destroy(); this.mesh?.ib.destroy();
    if (!pos || !idx.length) { this.mesh = null; return; }
    const nrm = computeNormals(pos, idx);
    const inter = new Float32Array(pos.length * 2);
    for (let i = 0; i < pos.length / 3; i++) inter.set([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]], 6 * i);
    const vb = this.device.createBuffer({ size: inter.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vb, 0, inter);
    const ib = this.device.createBuffer({ size: Math.ceil(idx.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ib, 0, idx);
    this.mesh = { vb, ib, count: idx.length };
  }

  // scan preview: pos Float32Array (lattice coords), col rgba8
  setPoints(pos, col) {
    this.points?.pb.destroy(); this.points?.cb.destroy();
    if (!pos) { this.points = null; return; }
    const n = pos.length / 3;
    const pb = this.device.createBuffer({ size: Math.max(16, pos.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(pb, 0, pos);
    const cb = this.device.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(cb, 0, col.buffer ? new Uint8Array(col.buffer, col.byteOffset, n * 4) : col);
    const bg = this.device.createBindGroup({ layout: this.pPoints.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.view } }, { binding: 1, resource: { buffer: pb } }, { binding: 2, resource: { buffer: cb } }] });
    this.points = { pb, cb, bg, count: n };
  }

  // Attach a running solver; tracers read its velocity/flag buffers directly.
  attachSolver(lbm, count = 24576) {
    this.lbm = lbm;
    this.tracers?.parts.destroy(); this.tracers?.pvel.destroy();
    if (!lbm) { this.tracers = null; return; }
    const d = this.device;
    const init = new Float32Array(4 * count);
    for (let i = 0; i < count; i++) init.set([-10, -10, -10, 1e9], 4 * i); // force respawn on first step
    const parts = d.createBuffer({ size: init.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(parts, 0, init);
    const pvel = d.createBuffer({ size: init.byteLength, usage: GPUBufferUsage.STORAGE });
    const bgAdv = d.createBindGroup({ layout: this.pAdvect.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.view } }, { binding: 1, resource: { buffer: lbm.vel } }, { binding: 2, resource: { buffer: lbm.flags } },
      { binding: 3, resource: { buffer: this.adv } }, { binding: 4, resource: { buffer: parts } }, { binding: 5, resource: { buffer: pvel } }] });
    const bgStreak = d.createBindGroup({ layout: this.pStreak.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.view } }, { binding: 1, resource: { buffer: parts } }, { binding: 2, resource: { buffer: pvel } }] });
    const bgSlice = d.createBindGroup({ layout: this.pSlice.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.view } }, { binding: 1, resource: { buffer: lbm.vel } }, { binding: 2, resource: { buffer: lbm.flags } }] });
    this.tracers = { parts, pvel, bgAdv, bgStreak, bgSlice, count };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h || !this.depth) {
      this.canvas.width = w; this.canvas.height = h;
      this.depth?.destroy();
      this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
  }

  _writeView(stepsPerFrame) {
    const { yaw, pitch, dist, target } = this.cam;
    const eye = [target[0] + dist * Math.cos(pitch) * Math.sin(yaw), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(pitch) * Math.cos(yaw)];
    const aspect = this.canvas.width / this.canvas.height;
    const vp = mul(perspective(0.8, aspect, dist * 0.02, dist * 8), lookAt(eye, target, [0, 1, 0]));
    const buf = new ArrayBuffer(256 + 64);
    const f = new Float32Array(buf), u = new Uint32Array(buf);
    f.set(vp, 0); f.set([...eye, 1], 16);
    u.set([this.grid[0], this.grid[1], this.grid[2], this.grid[0] * this.grid[1] * this.grid[2]], 20);
    f.set([this.sliceZ, this.u0, this.sliceAlpha, this.showSlice ? 1 : 0], 24);
    f.set([this.canvas.width, this.canvas.height, 2.2, Math.max(1, stepsPerFrame) * 2.5], 28);
    const t = this.theme;
    let o = 32;
    for (const k of ['bg', 'ink', 'slow', 'fast', 'neutral', 'body', 'smoke']) { f.set(hex(t[k]), o); o += 4; }
    this.device.queue.writeBuffer(this.view, 0, buf);
  }

  // Encode tracer advection (after solver steps) and draw a frame.
  frame(encoder, { stepsPerFrame = 0, flowReady = false } = {}) {
    this.resize();
    this._writeView(stepsPerFrame);
    const tr = this.tracers;
    if (tr && flowReady && this.showTracers && stepsPerFrame > 0) {
      const ab = new ArrayBuffer(16);
      new Float32Array(ab, 0, 1)[0] = stepsPerFrame;
      new Uint32Array(ab, 4, 3).set([this.seed++, tr.count, 0]);
      this.device.queue.writeBuffer(this.adv, 0, ab);
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pAdvect); pass.setBindGroup(0, tr.bgAdv);
      pass.dispatchWorkgroups(Math.ceil(tr.count / TRACER_WG));
      pass.end();
    }
    const bg = hex(this.theme.bg);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setPipeline(this.pGrid); pass.setBindGroup(0, this.bgGrid); pass.draw(6);
    if (this.mesh) {
      pass.setPipeline(this.pMesh); pass.setBindGroup(0, this.bgMesh);
      pass.setVertexBuffer(0, this.mesh.vb); pass.setIndexBuffer(this.mesh.ib, 'uint32'); pass.drawIndexed(this.mesh.count);
    }
    if (this.points && !this.mesh) {
      pass.setPipeline(this.pPoints); pass.setBindGroup(0, this.points.bg); pass.draw(6, this.points.count);
    }
    if (tr && flowReady) {
      if (this.showSlice) { pass.setPipeline(this.pSlice); pass.setBindGroup(0, tr.bgSlice); pass.draw(6); }
      if (this.showTracers) { pass.setPipeline(this.pStreak); pass.setBindGroup(0, tr.bgStreak); pass.draw(6, tr.count); }
    }
    pass.end();
  }

  // pointer orbit + pinch/wheel zoom
  bindControls(el) {
    const pts = new Map();
    let last = null;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
    el.addEventListener('pointerup', (e) => { pts.delete(e.pointerId); last = null; });
    el.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); last = null; });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        this.cam.yaw -= (e.clientX - prev[0]) * 0.008;
        this.cam.pitch = Math.max(-0.2, Math.min(1.45, this.cam.pitch + (e.clientY - prev[1]) * 0.008));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (last) this.cam.dist = Math.max(10, this.cam.dist * (last / d));
        last = d;
      }
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = Math.max(10, this.cam.dist * Math.exp(e.deltaY * 0.001)); }, { passive: false });
  }
}

export function computeNormals(pos, idx) {
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[3 * v] += nx; nrm[3 * v + 1] += ny; nrm[3 * v + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  return nrm;
}

export const renderShaders = { TRACER_COMPUTE, STREAK_RENDER, SLICE_RENDER, MESH_RENDER, GRID_RENDER, POINTS_RENDER };
