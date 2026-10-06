#!/usr/bin/env node
// OpenAlex literature search for agents and people: find papers, read abstracts, follow
// citations, and save what was found with DOIs so every number in the code has a source.
//
//   export OPENALEX_API_KEY=...        # free key: https://openalex.org/settings/api (required since Feb 2026)
//   node tools/research/openalex.mjs search "temperature dependence energy gap semiconductors" --n=5 --abstracts
//   node tools/research/openalex.mjs search "band gap bowing InGaAs" --from=1990 --sort=cited --type=article
//   node tools/research/openalex.mjs doi 10.1063/1.1368156          # one work by DOI (free, no list cost)
//   node tools/research/openalex.mjs citing W2006271366 --n=10 --sort=cited
//   node tools/research/openalex.mjs plan tools/research/plans/bandgap.json   # run a query plan → research/<name>/
//
// Flags: --n=10  --from=YEAR  --to=YEAR  --type=article|review|...  --sort=cited|recent|relevance
//        --oa (open access only)  --abstracts  --json  --save=path.md
// Network: api.openalex.org must be reachable. In a sandbox with an allowlist, add that host.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = 'https://api.openalex.org';
const SELECT = 'id,doi,display_name,publication_year,cited_by_count,type,authorships,primary_location,open_access,abstract_inverted_index';

// OpenAlex stores abstracts as {word: [positions]}; rebuild the text.
export function abstractText(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
  return words.filter((w) => w !== undefined).join(' ');
}

export function summarize(w) {
  const authors = (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean);
  return {
    id: w.id?.replace('https://openalex.org/', ''),
    doi: w.doi?.replace('https://doi.org/', '') || null,
    title: w.display_name,
    year: w.publication_year,
    cited: w.cited_by_count,
    type: w.type,
    venue: w.primary_location?.source?.display_name || null,
    authors: authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', '),
    oaUrl: w.open_access?.oa_url || null,
    abstract: abstractText(w.abstract_inverted_index),
  };
}

export function buildQuery({ search, filter = [], from, to, type, oa, sort, n = 10 }) {
  const f = [...filter];
  if (from) f.push(`from_publication_date:${from}-01-01`);
  if (to) f.push(`to_publication_date:${to}-12-31`);
  if (type) f.push(`type:${type}`);
  if (oa) f.push('is_oa:true');
  const p = new URLSearchParams({ select: SELECT, per_page: String(Math.min(200, n)) });
  if (search) p.set('search', search);
  if (f.length) p.set('filter', f.join(','));
  const s = { cited: 'cited_by_count:desc', recent: 'publication_date:desc' }[sort];
  if (s) p.set('sort', s);
  return p;
}

async function get(path, params = new URLSearchParams()) {
  const key = process.env.OPENALEX_API_KEY;
  if (key) params.set('api_key', key);
  const url = `${API}${path}?${params}`;
  let res;
  try { res = await fetch(url, { headers: { 'User-Agent': 'LabStudio research tool (https://github.com/sweet00000/Labstudio)' } }); }
  catch (e) { throw new Error(`Couldn’t reach ${API} (${e.cause?.code || e.message}). If this runs in a sandbox, allow api.openalex.org in its network settings.`); }
  if (res.status === 401 || res.status === 403) throw new Error(`OpenAlex refused the request (${res.status}). Set OPENALEX_API_KEY (free at https://openalex.org/settings/api); a network proxy can also cause this.`);
  if (res.status === 429) throw new Error('OpenAlex rate limit or daily allowance reached. Wait, or reduce --n and the number of queries.');
  if (!res.ok) throw new Error(`OpenAlex ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const searchWorks = async (q) => ((await get('/works', buildQuery(q))).results || []).map(summarize);
export const workByDoi = async (doi) => summarize(await get(`/works/doi:${doi.replace(/^https?:\/\/doi.org\//, '')}`, new URLSearchParams({ select: SELECT })));
export const citing = async (id, q = {}) => searchWorks({ ...q, filter: [`cites:${id}`] });

export function toMarkdown(title, works, { abstracts = false } = {}) {
  const lines = [`## ${title}`, ''];
  for (const w of works) {
    lines.push(`- **${w.title}** (${w.year}) ${w.authors}. *${w.venue || w.type}*. Cited ${w.cited}. ${w.doi ? `doi:${w.doi}` : w.id}${w.oaUrl ? ` · [open access](${w.oaUrl})` : ''}`);
    if (abstracts && w.abstract) lines.push(`  > ${w.abstract.slice(0, 1200)}${w.abstract.length > 1200 ? '…' : ''}`);
  }
  return lines.join('\n') + '\n';
}

// ---------- CLI ----------
async function main(argv) {
  const [cmd, ...rest] = argv;
  const pos = rest.filter((a) => !a.startsWith('--'));
  const o = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
  const q = { n: +o.n || 10, from: o.from, to: o.to, type: o.type, oa: !!o.oa, sort: o.sort || 'relevance' };
  let works, title;
  if (cmd === 'search') { title = pos.join(' '); works = await searchWorks({ ...q, search: title }); }
  else if (cmd === 'doi') { title = `doi:${pos[0]}`; works = [await workByDoi(pos[0])]; }
  else if (cmd === 'citing') { title = `Works citing ${pos[0]}`; works = await citing(pos[0], q); }
  else if (cmd === 'plan') return runPlan(pos[0]);
  else { console.log(await readFile(fileURLToPath(import.meta.url), 'utf8').then((t) => t.split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))); return; }
  if (o.json) console.log(JSON.stringify(works, null, 2));
  else console.log(toMarkdown(title, works, { abstracts: !!o.abstracts }));
  if (o.save) { await mkdir(dirname(resolve(o.save)), { recursive: true }); await writeFile(o.save, toMarkdown(title, works, { abstracts: true })); console.error(`saved ${o.save}`); }
}

// A plan is { "name": "...", "queries": [{ "topic": "...", "search": "...", "n": 5, "sort": "cited", ... } | { "topic": "...", "doi": "..." }] }
async function runPlan(file) {
  const plan = JSON.parse(await readFile(file, 'utf8'));
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../research', plan.name);
  await mkdir(dir, { recursive: true });
  const all = [], md = [`# ${plan.title || plan.name}`, '', `Generated ${new Date().toISOString().slice(0, 10)} from \`${file}\` via OpenAlex. Abstracts are reconstructed from OpenAlex's index; read the paper before quoting a number.`, ''];
  for (const item of plan.queries) {
    try {
      const works = item.doi ? [await workByDoi(item.doi)] : await searchWorks({ n: 5, sort: 'relevance', ...item });
      works.forEach((w) => all.push({ topic: item.topic, ...w }));
      md.push(toMarkdown(item.topic, works, { abstracts: true }));
      console.error(`ok   ${item.topic} (${works.length})`);
    } catch (e) { md.push(`## ${item.topic}\n\nFailed: ${e.message}\n`); console.error(`FAIL ${item.topic}: ${e.message}`); if (/reach|refused/.test(e.message)) break; }
  }
  await writeFile(resolve(dir, 'sources.md'), md.join('\n'));
  await writeFile(resolve(dir, 'sources.json'), JSON.stringify(all, null, 2));
  console.error(`wrote ${resolve(dir, 'sources.md')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
