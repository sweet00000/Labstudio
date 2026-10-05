import { makeSample } from '../src/samples.js';
import { toSTL } from '../src/export.js';
const s = makeSample(Deno.args[0] || 'car', 48);
await Deno.writeFile(Deno.args[1] || 'out/car.stl', toSTL(s));
console.log('tris', s.idx.length / 3);
