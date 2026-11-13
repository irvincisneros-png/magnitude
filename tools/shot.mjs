// usage: node shot.mjs <baseUrl> <outDir> <s1,s2,...> [waitMs] [prefix] [yaw:pitch] [WxH]
// yaw/pitch in radians (default orbit is 0.35:0.18; pitch is clamped to ±1.39). WxH e.g. 375x812 for a phone.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [base, out, list, waitMs = '5000', prefix = 's', orbit = '', size = '1280x800'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--hide-scrollbars', `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, `--user-data-dir=${out}/chrome-prof-${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Never leave a headless Chrome behind: kill it on any exit path, and give up after a hard limit.
const bye = () => { try { chrome.kill('SIGKILL'); } catch {} };
process.on('exit', bye);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));
process.on('uncaughtException', (e) => { console.error('shot failed:', e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('shot failed:', e?.message ?? e); process.exit(1); });
setTimeout(() => { console.error('shot timed out'); process.exit(1); }, 240000).unref();
let target;
for (let i = 0; i < 120 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || '')); else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
const ss = list.split(',');
await send('Page.navigate', { url: `${base}#s=${ss[0]}` });
await sleep(Number(waitMs) + 4000);
for (const s of ss) {
  await send('Runtime.evaluate', { expression: `${orbit ? `__magnitude.setOrbit(${orbit.split(':').join(',')});` : ''}__magnitude.setS(${s})` });
  await sleep(Number(waitMs));
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  writeFileSync(`${out}/${prefix}_${s}.jpg`, Buffer.from(r.data, 'base64'));
}
console.log(logs.length ? [...new Set(logs)].join('\n') : 'no console errors/warnings');
ws.close(); bye(); process.exit(0);
