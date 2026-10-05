// Headless WebGPU for tests: Deno (wgpu) — run with `deno run --unstable-webgpu -A`
export async function getDevice({ f16 = true } = {}) {
  const adapter = await navigator.gpu.requestAdapter();
  const feats = [];
  if (f16 && adapter.features.has('shader-f16')) feats.push('shader-f16');
  const device = await adapter.requestDevice({
    requiredFeatures: feats,
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize },
  });
  return { adapter, device, f16: feats.includes('shader-f16') };
}
