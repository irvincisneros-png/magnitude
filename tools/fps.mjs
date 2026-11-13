import { spawn } from 'node:child_process';
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--window-size=1280,800', `--remote-debugging-port=${port}`, `--user-data-dir=${process.argv[2]}/prof-${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));
process.on('uncaughtException', (e) => { console.error(e.message); process.exit(1); });
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Page.navigate', { url: `http://localhost:${process.env.PORT || 8521}/#s=0.5` }); await sleep(8000);
const ALL = { planck: -34.8, proton: -14.8, nucleus: -14.2, atom: -9.6, dna: -8.4, phageIn: -7.3, phage: -6.45, ecoliIn: -6.1, ecoli: -5.45, cellIn: -4.9, cell: -4.4, sandIn: -3.8, sand: -3.05, antIn: -2.8, ant: -2.15, skin: -1.6, human: 0.5, coast: 2.6, earthLow: 4.3, earth: 7.1, sats: 8.0, moon: 8.95, moonSun: 9.2, sun: 9.5, betIn: 10.8, betSide: 11.5, bet: 12.28, solar: 13.1, oort: 16.4, orionIn: 16.9, orion: 17.61, orionOut: 18.2, omega: 18.4, omegaOut: 19.2, milkyway: 21.1, web: 25.0, universe: 26.9 };
// usage: node fps.mjs <profileDir> [name1,name2,...]   (no list = every scene)
const pick = process.argv[3]?.split(',');
const scenes = pick ? Object.fromEntries(pick.map((n) => [n, ALL[n] ?? Number(n)])) : ALL;
const rows = [];
for (const [name, s] of Object.entries(scenes)) {
  const row = { name };
  for (const q of ['high', 'low']) {
    await ev(`__magnitude.setQuality('${q}'); __magnitude.setS(${s}); 1`); await sleep(q === 'high' ? 6000 : 2500);
    row[q] = await ev(`new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(Math.round(n / 3)); }; requestAnimationFrame(f); })`);
  }
  rows.push(row); console.log(row.name.padEnd(10), 'high', String(row.high).padStart(3), 'low', String(row.low).padStart(3));
}
ws.close(); chrome.kill(); process.exit(0);
