// Real-time headless Chrome screenshots of the Figure2 preview (modelled on shot.mjs).
// usage: node tools/figshot.mjs <outDir> <WxH> <waitMs> name=query [name=query ...]
//   e.g. node tools/figshot.mjs /tmp/out 1280x800 3000 hero="yaw=-45&pitch=8&dist=3.2"
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const [out, size = '1280x800', waitMs = '3000', ...shots] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const [W, H] = size.split('x').map(Number);
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-gpu', '--use-angle=metal', '--hide-scrollbars', '--enable-webgl-draft-extensions', `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, `--user-data-dir=${out}/chrome-prof-${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || '')); else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'log'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400)); };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  for (const s of shots) {
    const i = s.indexOf('=');
    const name = s.slice(0, i), q = s.slice(i + 1);
    const url = q.startsWith('http') ? q : `http://localhost:8520/figure-preview.html?${q}`;
    await send('Page.navigate', { url });
    await sleep(Number(waitMs));
    for (let k = 0; k < 40; k++) { const r = await send('Runtime.evaluate', { expression: 'window.__fig2 ? window.__fig2.ready : true', returnByValue: true }); if (r?.result?.value) break; await sleep(250); }
    await sleep(800);
    const g = await send('Runtime.evaluate', { expression: 'window.__gpu ?? null', returnByValue: true });
    if (g?.result?.value != null) logs.push(`${name}: figure GPU median ${g.result.value} ms`);
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.data, 'base64'));
  }
  console.log(logs.length ? [...new Set(logs)].join('\n') : 'no console output');
  ws.close();
} finally { chrome.kill('SIGKILL'); }
