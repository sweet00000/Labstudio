// Autosave in the browser (IndexedDB), so typed-array mesh data doesn't need encoding.
// Every call fails soft: private windows and blocked storage just mean no autosave.
let dbp;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('labstudio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode), req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}
export const get = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined);
export const put = (key, value) => tx('readwrite', (s) => s.put(value, key)).catch(() => undefined);
