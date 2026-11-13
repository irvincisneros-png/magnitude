// usage: PORT=8520 TIERS=high,medium,low node fps.mjs <profileDir> [name1,name2,...]   (no list = every scene; raw s values work too)
//
// Robustness (the old "Cannot read properties of undefined" flake): the page could be navigated away
// mid-run (a CDP error reply has no `result`), and a random fixed debugging port could collide with
// another Chrome. Now: Chrome picks its own port (read from DevToolsActivePort in our profile, so we
// can only ever attach to the Chrome we started), top-level navigations away from the dev server are
// refused, CDP errors are handled, and a scene whose page went away is reloaded and measured again.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST = `http://localhost:${process.env.PORT || 8521}/`;
const dir = `${process.argv[2]}/prof-${process.pid}`;
mkdirSync(dir, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--window-size=1280,800', '--remote-debugging-port=0', '--no-first-run', '--disable-extensions', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));
process.on('uncaughtException', (e) => { console.error(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e?.message ?? e); process.exit(1); });

let t;
for (let i = 0; i < 80 && !t; i++) {
  await sleep(250);
  try {
    const port = readFileSync(`${dir}/DevToolsActivePort`, 'utf8').split('\n')[0];
    t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page');
  } catch {}
}
if (!t) { console.error('fps: could not attach to the headless Chrome'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === 'Fetch.requestPaused') {
    const ok = d.params.request.url.startsWith(HOST);
    if (!ok) console.error(`fps: refused a navigation to ${d.params.request.url.slice(0, 60)}`);
    void send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: d.params.requestId } : { requestId: d.params.requestId, errorReason: 'BlockedByClient' });
  }
};
/** Evaluates in the page; returns { ok, value }. Never throws on CDP errors or page exceptions. */
const ev = async (e) => {
  const d = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (!d || d.error || !d.result || d.result.exceptionDetails) return { ok: false, value: undefined };
  return { ok: true, value: d.result.result?.value };
};
const load = async () => {
  await send('Page.navigate', { url: `${HOST}#s=0.5` });
  await sleep(8000);
  await ev('window.__magnitude && window.__magnitude.ready');
};
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document' }] });
await load();

const ALL = { planck: -34.8, proton: -14.8, nucleus: -14.2, atom: -9.6, dna: -8.4, phageIn: -7.3, phage: -6.45, ecoliIn: -6.1, ecoli: -5.45, cellIn: -4.9, cell: -4.4, sandIn: -3.8, sand: -3.05, antIn: -2.8, ant: -2.15, skin: -1.6, human: 0.5, coast: 2.6, earthLow: 4.3, earth: 7.1, sats: 8.0, moon: 8.95, moonSun: 9.2, sun: 9.5, betIn: 10.8, betSide: 11.5, bet: 12.28, solar: 13.1, oort: 16.4, orionIn: 16.9, orion: 17.61, orionOut: 18.2, omega: 18.4, omegaOut: 19.2, milkyway: 21.1, web: 25.0, universe: 26.9 };
const pick = process.argv[3]?.split(',');
const scenes = pick ? pick.map((n) => [n, ALL[n] ?? Number(n)]) : Object.entries(ALL);
const measure = `new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(Math.round(n / 3)); }; requestAnimationFrame(f); })`;
const onHost = async () => { const r = await ev('location.href'); return r.ok && String(r.value).startsWith(HOST) && (await ev('!!window.__magnitude')).value === true; };
for (const [name, s] of scenes) {
  const row = { name };
  for (const q of (process.env.TIERS || 'high,low').split(',')) {
    let fps;
    for (let attempt = 0; attempt < 3 && fps === undefined; attempt++) {
      if (!(await onHost())) { console.error(`fps: page was not on the dev server before ${name}/${q}; reloading`); await load(); }
      if (!(await ev(`__magnitude.setQuality('${q}'); __magnitude.setS(${s}); 1`)).ok) continue;
      await sleep(q === 'high' ? 6000 : 2500);
      const r = await ev(measure);
      if (r.ok && typeof r.value === 'number' && (await onHost())) fps = r.value;
    }
    row[q] = fps ?? 'n/a';
  }
  console.log(String(row.name).padEnd(10), Object.entries(row).filter(([k]) => k !== 'name').map(([k, v]) => k + ' ' + String(v).padStart(3)).join('  '));
}
ws.close(); chrome.kill(); process.exit(0);
