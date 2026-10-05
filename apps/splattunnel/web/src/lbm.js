// D3Q19 lattice Boltzmann solver on WebGPU.
// - pull streaming, A/B buffers, halfway bounce-back on solids
// - BGK collision + Smagorinsky LES (stable at high Reynolds numbers)
// - populations stored "shifted" (f_i - w_i) in f16 when the device supports
//   shader-f16, else f32 (the trick FluidX3D uses to keep FP16 accurate)
// No DOM access, so it runs headless (Deno) for tests.

export const FLAG = { FLUID: 0, BODY: 1, WALL: 2, FARFIELD: 3, OUTLET: 4 };

export const C = [
  [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, -1], [0, 1, 1], [0, -1, -1],
  [1, -1, 0], [-1, 1, 0], [1, 0, -1], [-1, 0, 1], [0, 1, -1], [0, -1, 1],
];
export const W = C.map((_, i) => (i === 0 ? 1 / 3 : i <= 6 ? 1 / 18 : 1 / 36));
export const OPP = C.map((_, i) => (i === 0 ? 0 : i % 2 === 1 ? i + 1 : i - 1));

const WG = 64;
const Q = 19;

export function lbmBytesPerCell(f16) {
  // two population buffers + u32 flags + packed half-float velocity/density
  return 2 * Q * (f16 ? 2 : 4) + 4 + 8;
}

// Largest cell count a device can hold in one population buffer.
export function maxCellsFor(limits, f16) {
  const lim = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  return Math.floor(lim / (Q * (f16 ? 2 : 4)));
}

const lit = (x) => {
  let s = Number(x).toPrecision(9);
  if (!/[.e]/.test(s)) s += '.0';
  return s;
};

// "cx*sx + cy*sy + cz*sz" as WGSL i32 expression (sx=1, sy=nx, sz=nx*ny)
function offsetExpr(i) {
  const [x, y, z] = C[i];
  const parts = [];
  if (x) parts.push(x > 0 ? 'sx' : '-sx');
  if (y) parts.push(y > 0 ? 'sy' : '-sy');
  if (z) parts.push(z > 0 ? 'sz' : '-sz');
  return parts.join(' + ').replace(/\+ -/g, '- ');
}

function dot(i, ux, uy, uz) {
  const [x, y, z] = C[i];
  const t = [];
  if (x) t.push((x > 0 ? '' : '-') + ux);
  if (y) t.push((y > 0 ? '' : '-') + uy);
  if (z) t.push((z > 0 ? '' : '-') + uz);
  return t.length ? t.join(' + ').replace(/\+ -/g, '- ') : '0.0';
}

function sumWhere(prefix, pred) {
  const t = [];
  for (let i = 1; i < Q; i++) {
    const v = pred(C[i]);
    if (v === 1) t.push(`${prefix}${i}`);
    else if (v === -1) t.push(`-${prefix}${i}`);
  }
  return t.join(' + ').replace(/\+ -/g, '- ');
}

function header(f16) {
  return `${f16 ? 'enable f16;\n' : ''}alias S = ${f16 ? 'f16' : 'f32'};
struct Params {
  nx: u32, ny: u32, nz: u32, n: u32,
  omega: f32, lesC: f32, ux: f32, uy: f32,
  uz: f32, stride: u32, count: u32, sponge: f32,
};
@group(0) @binding(0) var<uniform> P: Params;
`;
}

function stepWGSL(f16) {
  const L = [];
  L.push(header(f16));
  L.push(`@group(0) @binding(1) var<storage, read> fa: array<S>;
@group(0) @binding(2) var<storage, read_write> fb: array<S>;
@group(0) @binding(3) var<storage, read> flags: array<u32>;


@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x + g.y * P.stride;
  if (c >= P.n) { return; }
  let fl = flags[c];
  if (fl == 1u || fl == 2u) { return; }
  let N = P.n;
  let sx = 1i; let sy = i32(P.nx); let sz = i32(P.nx * P.ny);
  if (fl == 3u) {
    let ux = P.ux; let uy = P.uy; let uz = P.uz;
    let usq = 1.5 * (ux * ux + uy * uy + uz * uz);`);
  for (let i = 0; i < Q; i++) {
    const cu = `(${dot(i, 'ux', 'uy', 'uz')})`;
    L.push(`    { let cu = ${cu}; fb[${i}u * N + c] = S(${lit(W[i])} * (3.0 * cu + 4.5 * cu * cu - usq)); }`);
  }
  L.push(`    return;
  }
  if (fl == 4u) {`);
  for (let i = 0; i < Q; i++) L.push(`    fb[${i}u * N + c] = fa[${i}u * N + c - 1u];`);
  L.push(`    return;
  }
  let ci = i32(c);
  let f0 = f32(fa[c]);`);
  for (let i = 1; i < Q; i++) {
    // BODY: halfway bounce-back. WALL (the floor, only ever at y = 0): free-slip specular
    // reflection. A frictionless floor behaves like a rolling road without the moving-wall
    // corner singularity that a belt under stationary wheels creates, and it makes the floor
    // an exact mirror plane. Only directions with cy = +1 can pull from the floor.
    const [cx, cy, cz] = C[i];
    let wall = `f32(fa[${OPP[i]}u * N + c])`;
    if (cy === 1) {
      const j = C.findIndex(([a, b, d]) => a === cx && b === -1 && d === cz);
      const parts = [];
      if (cx) parts.push(cx > 0 ? 'sx' : '-sx');
      if (cz) parts.push(cz > 0 ? 'sz' : '-sz');
      const src = parts.length ? `u32(ci - (${parts.join(' + ').replace(/\+ -/g, '- ')}))` : 'c';
      wall = `select(f32(fa[${OPP[i]}u * N + c]), f32(fa[${j}u * N + ${src}]), flags[${src}] != 1u)`;
    }
    L.push(`  let n${i} = u32(ci - (${offsetExpr(i)}));
  var f${i}: f32;
  let fl${i} = flags[n${i}];
  if (fl${i} == 1u) { f${i} = f32(fa[${OPP[i]}u * N + c]); }
  else if (fl${i} == 2u) { f${i} = ${wall}; }
  else { f${i} = f32(fa[${i}u * N + n${i}]); }`);
  }
  const all = Array.from({ length: Q }, (_, i) => `f${i}`).join(' + ');
  L.push(`  let rho = 1.0 + (${all});
  let jx = ${sumWhere('f', (v) => v[0])};
  let jy = ${sumWhere('f', (v) => v[1])};
  let jz = ${sumWhere('f', (v) => v[2])};
  let ux = jx / rho; let uy = jy / rho; let uz = jz / rho;
  let usq = 1.5 * (ux * ux + uy * uy + uz * uz);`);
  for (let i = 0; i < Q; i++) {
    const cu = `(${dot(i, 'ux', 'uy', 'uz')})`;
    L.push(`  let q${i} = f${i} - ${lit(W[i])} * (rho * (1.0 + 3.0 * ${cu} + 4.5 * ${cu} * ${cu} - usq) - 1.0);`);
  }
  L.push(`  let pxx = ${sumWhere('q', (v) => (v[0] ? 1 : 0))};
  let pyy = ${sumWhere('q', (v) => (v[1] ? 1 : 0))};
  let pzz = ${sumWhere('q', (v) => (v[2] ? 1 : 0))};
  let pxy = ${sumWhere('q', (v) => v[0] * v[1])};
  let pxz = ${sumWhere('q', (v) => v[0] * v[2])};
  let pyz = ${sumWhere('q', (v) => v[1] * v[2])};
  let qn = pxx * pxx + pyy * pyy + pzz * pzz + 2.0 * (pxy * pxy + pxz * pxz + pyz * pyz);
  // sponge: extra viscosity ramping up over the last 10 cells before the inlet, outlet, top
  // and sides. It soaks up the acoustic noise that equilibrium boundaries otherwise reflect,
  // which is what destabilizes low-viscosity BGK at the inlet/floor corner.
  let px = i32(c % P.nx); let py = i32((c / P.nx) % P.ny); let pz = i32(c / (P.nx * P.ny));
  let dEdge = f32(min(min(min(px, i32(P.nx) - 1 - px), i32(P.ny) - 1 - py), min(pz, i32(P.nz) - 1 - pz)));
  let sp = clamp(1.0 - dEdge / 10.0, 0.0, 1.0);
  let tau0 = 1.0 / P.omega + 3.0 * P.sponge * sp * sp;
  let tau = 0.5 * (tau0 + sqrt(tau0 * tau0 + P.lesC * sqrt(qn) / rho));
  let om = 1.0 / tau;`);
  for (let i = 0; i < Q; i++) L.push(`  fb[${i}u * N + c] = S(f${i} - om * q${i});`);
  L.push('}');
  return L.join('\n');
}

function initWGSL(f16) {
  const L = [header(f16)];
  L.push(`@group(0) @binding(1) var<storage, read_write> fb: array<S>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x + g.y * P.stride;
  if (c >= P.n) { return; }
  let N = P.n;
  let ux = P.ux; let uy = P.uy; let uz = P.uz;
  let usq = 1.5 * (ux * ux + uy * uy + uz * uz);`);
  for (let i = 0; i < Q; i++) {
    const cu = `(${dot(i, 'ux', 'uy', 'uz')})`;
    L.push(`  { let cu = ${cu}; fb[${i}u * N + c] = S(${lit(W[i])} * (3.0 * cu + 4.5 * cu * cu - usq)); }`);
  }
  L.push('}');
  return L.join('\n');
}

// Macroscopic fields for visualization: vel[c] = (pack(ux,uy), pack(uz, rho-1))
function macroWGSL(f16) {
  const L = [header(f16)];
  L.push(`@group(0) @binding(1) var<storage, read> fa: array<S>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec2u>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x + g.y * P.stride;
  if (c >= P.n) { return; }
  let fl = flags[c];
  if (fl == 1u || fl == 2u) { vel[c] = vec2u(0u, 0u); return; }
  let N = P.n;`);
  for (let i = 0; i < Q; i++) L.push(`  let f${i} = f32(fa[${i}u * N + c]);`);
  const all = Array.from({ length: Q }, (_, i) => `f${i}`).join(' + ');
  L.push(`  let rho = 1.0 + (${all});
  let ux = (${sumWhere('f', (v) => v[0])}) / rho;
  let uy = (${sumWhere('f', (v) => v[1])}) / rho;
  let uz = (${sumWhere('f', (v) => v[2])}) / rho;
  vel[c] = vec2u(pack2x16float(vec2f(ux, uy)), pack2x16float(vec2f(uz, rho - 1.0)));
}`);
  return L.join('\n');
}

// Momentum-exchange force on BODY cells, reduced per workgroup.
function forceWGSL(f16) {
  const L = [header(f16)];
  L.push(`@group(0) @binding(1) var<storage, read> fa: array<S>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
@group(0) @binding(3) var<storage, read> cells: array<u32>;
@group(0) @binding(4) var<storage, read_write> partial: array<vec4f>;
var<workgroup> sh: array<vec3f, ${WG}>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u) {
  var F = vec3f(0.0, 0.0, 0.0);
  let k = g.x;
  if (k < P.count) {
    let c = cells[k];
    let ci = i32(c);
    let N = P.n;
    let sx = 1i; let sy = i32(P.nx); let sz = i32(P.nx * P.ny);`);
  for (let i = 1; i < Q; i++) {
    const [x, y, z] = C[i];
    // populations are stored shifted (f - w), which is exactly f minus the rest state at
    // freestream pressure: summing them gives gauge force, so bodies resting on the floor
    // aren't pushed down by the ambient pressure that has no fluid underneath to balance it
    L.push(`    if (flags[u32(ci - (${offsetExpr(i)}))] == 1u) { F -= 2.0 * f32(fa[${OPP[i]}u * N + c]) * vec3f(${lit(x)}, ${lit(y)}, ${lit(z)}); }`);
  }
  L.push(`  }
  sh[li] = F;
  workgroupBarrier();
  for (var s = ${WG / 2}u; s > 0u; s = s >> 1u) {
    if (li < s) { sh[li] = sh[li] + sh[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { partial[wg.x] = vec4f(sh[0], 0.0); }
}`);
  return L.join('\n');
}

export const shaders = { stepWGSL, initWGSL, macroWGSL, forceWGSL };

function dispatchDims(n) {
  const groups = Math.ceil(n / WG);
  if (groups <= 65535) return { x: groups, y: 1, stride: groups * WG };
  const y = Math.ceil(groups / 65535);
  return { x: 65535, y, stride: 65535 * WG };
}

export class LBM {
  // opts: { nx, ny, nz, f16 }
  constructor(device, opts) {
    this.device = device;
    this.nx = opts.nx; this.ny = opts.ny; this.nz = opts.nz;
    this.n = this.nx * this.ny * this.nz;
    this.f16 = !!opts.f16;
    this.dims = dispatchDims(this.n);
    this.cur = 0;
    this.stepCount = 0;
    this.boundaryCount = 0;
    this.forceGroups = 1;
    this.omega = 1.0; this.lesC = 0.7357; this.u = [0.08, 0, 0]; this.sponge = 0.02;
    const U = GPUBufferUsage;
    const popBytes = this.n * Q * (this.f16 ? 2 : 4);
    this.popBytes = popBytes;
    const lim = device.limits;
    if (popBytes > lim.maxStorageBufferBindingSize || popBytes > lim.maxBufferSize) {
      throw new Error(`Grid too large for this GPU: needs ${(popBytes / 2 ** 20).toFixed(0)} MB per buffer, limit is ${(Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize) / 2 ** 20).toFixed(0)} MB. Lower the resolution.`);
    }
    this.f = [0, 1].map(() => device.createBuffer({ size: popBytes, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST }));
    this.flags = device.createBuffer({ size: this.n * 4, usage: U.STORAGE | U.COPY_DST });
    this.vel = device.createBuffer({ size: this.n * 8, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.params = device.createBuffer({ size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.cells = device.createBuffer({ size: 4 * 64, usage: U.STORAGE | U.COPY_DST });
    this.partial = device.createBuffer({ size: 16 * 64, usage: U.STORAGE | U.COPY_SRC });
    this.staging = [];
    this.gpuBytes = popBytes * 2 + this.n * 12 + 48;
  }

  // sync=true creates pipelines synchronously (used by the headless tests)
  async build({ sync = false } = {}) {
    const d = this.device;
    const mk = async (code, label) => {
      const module = d.createShaderModule({ code, label });
      if (sync) return d.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' }, label });
      if (module.getCompilationInfo) {
        const info = await module.getCompilationInfo();
        const errs = info.messages.filter((m) => m.type === 'error');
        if (errs.length) throw new Error(`${label}: ${errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
      }
      return d.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' }, label });
    };
    this.pStep = await mk(stepWGSL(this.f16), 'lbm-step');
    this.pInit = await mk(initWGSL(this.f16), 'lbm-init');
    this.pMacro = await mk(macroWGSL(this.f16), 'lbm-macro');
    this.pForce = await mk(forceWGSL(this.f16), 'lbm-force');
    this._bindAll();
    this.writeParams();
    return this;
  }

  _bindAll() {
    const d = this.device;
    const b = (buffer) => ({ buffer });
    this.bgStep = [0, 1].map((k) => d.createBindGroup({
      layout: this.pStep.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: b(this.params) }, { binding: 1, resource: b(this.f[k]) },
        { binding: 2, resource: b(this.f[1 - k]) }, { binding: 3, resource: b(this.flags) }],
    }));
    this.bgInit = [0, 1].map((k) => d.createBindGroup({
      layout: this.pInit.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: b(this.params) }, { binding: 1, resource: b(this.f[k]) }],
    }));
    this.bgMacro = [0, 1].map((k) => d.createBindGroup({
      layout: this.pMacro.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: b(this.params) }, { binding: 1, resource: b(this.f[k]) },
        { binding: 2, resource: b(this.flags) }, { binding: 3, resource: b(this.vel) }],
    }));
    this._bindForce();
  }

  _bindForce() {
    const d = this.device;
    const b = (buffer) => ({ buffer });
    this.bgForce = [0, 1].map((k) => d.createBindGroup({
      layout: this.pForce.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: b(this.params) }, { binding: 1, resource: b(this.f[k]) },
        { binding: 2, resource: b(this.flags) }, { binding: 3, resource: b(this.cells) },
        { binding: 4, resource: b(this.partial) }],
    }));
  }

  writeParams() {
    const buf = new ArrayBuffer(48);
    const u = new Uint32Array(buf); const f = new Float32Array(buf);
    u[0] = this.nx; u[1] = this.ny; u[2] = this.nz; u[3] = this.n;
    f[4] = this.omega; f[5] = this.lesC; f[6] = this.u[0]; f[7] = this.u[1];
    f[8] = this.u[2]; u[9] = this.dims.stride; u[10] = this.boundaryCount; f[11] = this.sponge;
    this.device.queue.writeBuffer(this.params, 0, buf);
  }

  // nu: lattice kinematic viscosity; cs: Smagorinsky constant (0 disables LES)
  setPhysics({ nu, cs = 0.17, u }) {
    const tau = 0.5 + 3 * nu;
    this.omega = 1 / tau;
    this.lesC = 18 * Math.SQRT2 * cs * cs;
    if (u) this.u = u.slice();
    this.writeParams();
  }

  setInflow(u) { this.u = u.slice(); this.writeParams(); }

  // flags: Uint8Array(n) using FLAG values
  setFlags(flags) {
    const u32 = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) u32[i] = flags[i];
    this.device.queue.writeBuffer(this.flags, 0, u32);
  }

  // cells: Uint32Array of fluid cells adjacent to BODY (for drag/lift)
  setBoundaryCells(cells) {
    const count = cells.length;
    const need = Math.max(64, Math.ceil(count / 64) * 64);
    if (this.cells.size < need * 4) {
      this.cells.destroy?.();
      this.cells = this.device.createBuffer({ size: need * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    }
    const groups = Math.max(1, Math.ceil(count / 64));
    if (this.partial.size < groups * 16) {
      this.partial.destroy?.();
      this.partial = this.device.createBuffer({ size: groups * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    }
    for (const s of this.staging) s.buf.destroy?.();
    this.staging = [];
    if (count) this.device.queue.writeBuffer(this.cells, 0, cells);
    this.boundaryCount = count;
    this.forceGroups = groups;
    this._bindForce();
    this.writeParams();
  }

  // Fill both population buffers with equilibrium at the current inflow velocity.
  reset(encoder) {
    const own = !encoder;
    const enc = encoder || this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pInit);
    for (const k of [0, 1]) { pass.setBindGroup(0, this.bgInit[k]); pass.dispatchWorkgroups(this.dims.x, this.dims.y); }
    pass.end();
    if (own) this.device.queue.submit([enc.finish()]);
    this.cur = 0;
    this.stepCount = 0;
  }

  encodeSteps(encoder, k) {
    if (k <= 0) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pStep);
    for (let j = 0; j < k; j++) {
      pass.setBindGroup(0, this.bgStep[this.cur]);
      pass.dispatchWorkgroups(this.dims.x, this.dims.y);
      this.cur ^= 1;
    }
    pass.end();
    this.stepCount += k;
  }

  encodeMacro(encoder) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pMacro);
    pass.setBindGroup(0, this.bgMacro[this.cur]);
    pass.dispatchWorkgroups(this.dims.x, this.dims.y);
    pass.end();
  }

  // Encodes the force reduction + copy into a staging buffer.
  // Returns a handle to pass to readForce() after submit, or null if busy.
  encodeForce(encoder) {
    if (!this.boundaryCount) return null;
    let st = this.staging.find((s) => !s.busy);
    if (!st) {
      if (this.staging.length >= 3) return null;
      st = { buf: this.device.createBuffer({ size: this.forceGroups * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false };
      this.staging.push(st);
    }
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pForce);
    pass.setBindGroup(0, this.bgForce[this.cur]);
    pass.dispatchWorkgroups(this.forceGroups);
    pass.end();
    encoder.copyBufferToBuffer(this.partial, 0, st.buf, 0, this.forceGroups * 16);
    st.busy = true;
    st.groups = this.forceGroups;
    return st;
  }

  async readForce(st) {
    await st.buf.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(st.buf.getMappedRange().slice(0, st.groups * 16));
    st.buf.unmap();
    st.busy = false;
    let fx = 0, fy = 0, fz = 0;
    for (let i = 0; i < st.groups; i++) { fx += a[4 * i]; fy += a[4 * i + 1]; fz += a[4 * i + 2]; }
    return [fx, fy, fz];
  }

  async readVelocity() {
    const d = this.device;
    const st = d.createBuffer({ size: this.n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = d.createCommandEncoder();
    this.encodeMacro(enc);
    enc.copyBufferToBuffer(this.vel, 0, st, 0, this.n * 8);
    d.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const out = new Uint16Array(st.getMappedRange().slice(0));
    st.unmap(); st.destroy?.();
    return out; // 4 halves per cell: ux, uy, uz, rho-1
  }

  destroy() {
    for (const b of [...this.f, this.flags, this.vel, this.params, this.cells, this.partial]) b.destroy?.();
    for (const s of this.staging) s.buf.destroy?.();
  }
}

// IEEE half <-> float helpers
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
export function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}
export function floatToHalf(v) {
  _f32[0] = v;
  const x = _u32[0];
  const sign = (x >> 16) & 0x8000;
  const e = ((x >> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (((x >> 23) & 0xff) === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  const r = sign | (e << 10) | (m >> 13);
  return (m & 0x1000) ? r + 1 : r;
}
