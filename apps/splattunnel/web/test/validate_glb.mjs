import validator from 'gltf-validator';
import fs from 'node:fs';
const data = new Uint8Array(fs.readFileSync('out/body.glb'));
const r = await validator.validateBytes(data);
console.log('glTF validator:', 'errors', r.issues.numErrors, 'warnings', r.issues.numWarnings, 'infos', r.issues.numInfos);
for (const m of r.issues.messages.filter(m => m.severity <= 1)) console.log(' ', m.severity, m.code, m.message, m.pointer);
process.exit(r.issues.numErrors ? 1 : 0);
