// Compile every render/compute shader with naga (Deno) and build pipelines.
import { getDevice } from './gpu.js';
import { renderShaders } from '../src/render.js';
const { device } = await getDevice({ f16: false });
let bad = 0;
device.pushErrorScope('validation');
for (const [name, code] of Object.entries(renderShaders)) {
  const m = device.createShaderModule({ code });
  const info = await m.getCompilationInfo();
  const errs = info.messages.filter((e) => e.type === 'error');
  if (errs.length) { bad++; console.log('FAIL', name, errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n')); continue; }
  if (name === 'TRACER_COMPUTE') device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  else {
    const buffers = name === 'MESH_RENDER' ? [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] : [];
    device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs', buffers }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
  }
  console.log('ok  ', name);
}
const err = await device.popErrorScope();
if (err) { console.log('VALIDATION', err.message); bad++; }
Deno.exit(bad ? 1 : 0);
