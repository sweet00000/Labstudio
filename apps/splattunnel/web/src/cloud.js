// Client for the optional AWS backend (see /aws). Talks to an HTTP API with a
// shared access key; files move straight to S3 through presigned URLs.
const $ = (id) => document.getElementById(id);
const KEY = 'st-cloud';

function cfg() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }

async function api(path, opts = {}) {
  const c = cfg();
  if (!c.url) throw new Error('Cloud isn’t connected.');
  const r = await fetch(c.url.replace(/\/$/, '') + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-api-key': c.key || '', ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Cloud request failed (${r.status}).`);
  return body;
}

async function put(url, data, type) {
  const r = await fetch(url, { method: 'PUT', body: data, headers: { 'content-type': type || 'application/octet-stream' } });
  if (!r.ok) throw new Error(`Upload failed (${r.status}).`);
}

const LABEL = { SUBMITTED: 'Queued', PENDING: 'Queued', RUNNABLE: 'Waiting for a machine', STARTING: 'Starting', RUNNING: 'Running', SUCCEEDED: 'Done', FAILED: 'Failed', CREATED: 'Uploading' };

export function setupCloud({ getSolidSTL, getSummary, onSplatReady, status }) {
  const c = cfg();
  $('apiUrl').value = c.url || '';
  $('apiKey').value = c.key || '';
  const jobs = new Map();

  const setConnected = (ok, msg) => {
    $('photos').disabled = !ok;
    $('foamBtn').disabled = !ok;
    $('cloudInfo').textContent = msg;
  };

  async function test() {
    try {
      const h = await api('/health');
      const spent = h.spend ? ` Spent this month: $${Number(h.spend.actual).toFixed(2)} of $${Number(h.spend.limit).toFixed(0)}.` : '';
      setConnected(!h.paused, h.paused ? `Connected, but jobs are paused because the budget cap was reached.${spent}` : `Connected to ${h.region}.${spent}`);
      await refreshList();
    } catch (e) { setConnected(false, e.message); }
  }

  $('cloudSave').addEventListener('click', () => {
    localStorage.setItem(KEY, JSON.stringify({ url: $('apiUrl').value.trim(), key: $('apiKey').value.trim() }));
    test();
  });

  function render() {
    const ul = $('jobs');
    ul.textContent = '';
    for (const j of [...jobs.values()].sort((a, b) => b.created - a.created).slice(0, 8)) {
      const li = document.createElement('li');
      const what = j.type === 'splat' ? 'Photos to splats' : 'OpenFOAM run';
      li.innerHTML = `<span class="j-what"></span><span class="j-state"></span><span class="j-links"></span>`;
      li.querySelector('.j-what').textContent = what;
      li.querySelector('.j-state').textContent = LABEL[j.status] || j.status;
      const links = li.querySelector('.j-links');
      for (const res of j.results || []) {
        const a = document.createElement('a');
        a.href = res.url; a.textContent = res.name; a.download = res.name;
        links.appendChild(a);
        if (j.type === 'splat' && res.name.endsWith('.ply')) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = 'Open in tunnel';
          b.addEventListener('click', async () => {
            status('Downloading the trained splats…');
            const buf = await (await fetch(res.url)).arrayBuffer();
            await onSplatReady(buf, res.name);
          });
          links.appendChild(b);
        }
      }
      if (j.status === 'FAILED' && j.reason) { const p = document.createElement('span'); p.className = 'j-err'; p.textContent = j.reason; links.appendChild(p); }
      ul.appendChild(li);
    }
  }

  async function refreshList() {
    const r = await api('/jobs');
    for (const j of r.jobs || []) jobs.set(j.jobId, { ...jobs.get(j.jobId), ...j });
    render();
    for (const j of jobs.values()) if (!['SUCCEEDED', 'FAILED'].includes(j.status)) poll(j.jobId);
  }

  const polling = new Set();
  async function poll(id) {
    if (polling.has(id)) return;
    polling.add(id);
    try {
      for (;;) {
        const j = await api(`/jobs/${id}`);
        jobs.set(id, { ...jobs.get(id), ...j });
        render();
        if (['SUCCEEDED', 'FAILED'].includes(j.status)) break;
        await new Promise((r) => setTimeout(r, 15000));
      }
    } catch (e) { status(e.message); } finally { polling.delete(id); }
  }

  async function submit(type, files, params) {
    const r = await api('/jobs', { method: 'POST', body: JSON.stringify({ type, params, files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })) }) });
    jobs.set(r.jobId, { jobId: r.jobId, type, status: 'CREATED', created: Date.now() });
    render();
    let done = 0;
    for (const u of r.uploads) {
      const f = files.find((x) => x.name === u.name);
      await put(u.url, f.data || f, f.type);
      status(`Uploading ${++done} of ${files.length}…`);
    }
    await api(`/jobs/${r.jobId}/start`, { method: 'POST', body: '{}' });
    status(type === 'splat' ? 'Uploaded. Splat training usually takes 20 to 40 minutes, including machine start-up.' : 'Uploaded. The OpenFOAM run usually takes 15 to 45 minutes.');
    poll(r.jobId);
  }

  $('photos').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const video = files.some((f) => f.type.startsWith('video/'));
    if (!video && files.length < 20) { status('Use at least 20 photos, taken while walking all the way around the object.'); return; }
    try { await submit('splat', files, { steps: 7000 }); } catch (err) { status(err.message); }
    e.target.value = '';
  });

  $('foamBtn').addEventListener('click', async () => {
    const mesh = getSolidSTL();
    if (!mesh) { status('Build the solid first.'); return; }
    const { toSTL } = await import('./export.js');
    const s = getSummary();
    const stl = toSTL(mesh, 'body');
    try {
      await submit('foam', [{ name: 'body.stl', size: stl.length, type: 'model/stl', data: stl }], {
        speed: s.wind_speed_mps, fluid: s.fluid, length: s.real_length_m, ground: document.getElementById('ground').checked,
        frontalArea: s.frontal_area_m2,
      });
    } catch (err) { status(err.message); }
  });

  if (c.url) test();
}
