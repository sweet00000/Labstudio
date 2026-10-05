// Copies the deployable parts of the repository into _site/ with their repo paths intact,
// so relative imports between apps and packages work the same as in `npm run dev`.
import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
const out='_site';
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await cp('index.html',`${out}/index.html`);
for(const dir of ['apps/studio/web','apps/mirrorlab/web','apps/splattunnel/web/src','packages/geometry','packages/vendor'])await cp(dir,`${out}/${dir}`,{recursive:true});
for(const f of ['index.html','style.css','favicon.svg'])await cp(`apps/splattunnel/web/${f}`,`${out}/apps/splattunnel/web/${f}`);
await writeFile(`${out}/.nojekyll`,'');
console.log(`Built static site in ${out}/.`);
