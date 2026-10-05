// Offline checks for the OpenAlex helpers (no network): abstract reconstruction,
// record summaries, query building and markdown output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { abstractText, summarize, buildQuery, toMarkdown } from './openalex.mjs';

test('abstracts are rebuilt from the inverted index in word order', () => {
  assert.equal(abstractText({ gap: [2], The: [0], band: [1, 4], narrows: [3] }), 'The band gap narrows band');
  assert.equal(abstractText(null), '');
});

test('a work record becomes a short citation', async () => {
  const w = summarize(JSON.parse(await readFile(new URL('./fixtures/work.json', import.meta.url), 'utf8')));
  assert.equal(w.doi, '10.1063/1.1368156');
  assert.equal(w.id, 'W2006271366');
  assert.match(w.authors, /Vurgaftman/);
  assert.match(w.abstract, /^We present a comprehensive/);
  assert.match(toMarkdown('t', [w]), /doi:10\.1063\/1\.1368156/);
});

test('queries carry search, filters, sort and page size', () => {
  const p = buildQuery({ search: 'varshni', from: 1990, type: 'article', oa: true, sort: 'cited', n: 5 });
  assert.equal(p.get('search'), 'varshni');
  assert.equal(p.get('filter'), 'from_publication_date:1990-01-01,type:article,is_oa:true');
  assert.equal(p.get('sort'), 'cited_by_count:desc');
  assert.equal(p.get('per_page'), '5');
});
