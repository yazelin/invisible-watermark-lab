/* test/survive-matrix.mjs — 重新量存活矩陣,產生「預期值」的出處。
   跑法:node test/survive-matrix.mjs        需要 google-chrome

   為什麼要一次跑多張圖:存活很吃圖片內容(平滑的圖雜訊底低、分數高;雜訊多的圖掉一截)。
   用單一張圖訂出來的預期值沒有代表性 —— 這是上一版犯的錯:預期值抄自設計文件在另一張
   圖上量的數字,結果 13 項有 4 項對不起來,而那不是演算法有問題,是預期值沒有出處。

   規則:每張圖用不同的金鑰、雜訊用固定種子(不用 Math.random),所以整份結果可重現。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert';

const CHROME = process.env.CHROME || 'google-chrome';
const PAGE = 'file://' + resolve(import.meta.dirname, '..', 'index.html');

async function openChrome() {
  const dir = mkdtempSync(join(tmpdir(), 'iwl-mtx-'));
  const port = 9400 + Math.floor(performance.now() % 300);
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
  }
  assert.ok(ws, '連不上 Chrome,確認裝了 ' + CHROME);
  const sock = new WebSocket(ws);
  await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
  let id = 0; const waiting = new Map();
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) waiting.get(m.id)(m); };
  const send = (method, params, sessionId) => new Promise((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(m.error.message)) : r(m.result)));
    sock.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  const close = async () => {
    try { sock.close(); } catch (e) {}
    await new Promise((r) => { proc.once('exit', r); proc.kill(); setTimeout(r, 3000); });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { send, close };
}

const cdp = await openChrome();
try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url: PAGE }, sessionId);
  await new Promise((r) => setTimeout(r, 1500));
  const run = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, timeout: 900000 }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };

  const data = await run(`(async () => {
    const P = window.IWL, F = window.IWL_FIELD, D = window.IWL_DETECT, N = 16;
    const W = 900, H = 620;
    // 固定種子的亂數:整份結果要可重現,不能用 Math.random
    const mk = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };

    function base(kind) {
      const c = F.mkCanvas(W, H), x = F.ctxOf(c), rnd = mk(7);
      if (kind === 'flatwhite') {            // 大面積淺色:商品圖、文件、去背圖
        x.fillStyle = '#f4f4f2'; x.fillRect(0, 0, W, H);
        x.fillStyle = '#2b3b4e';
        for (let i = 0; i < 6; i++) x.fillRect(120 + i * 110, 200 + (i % 3) * 60, 70, 150);
      } else {                                // 其餘都從同一張漸層 + 色塊長出來
        const g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#2b4a6f'); g.addColorStop(.5, '#7fa6c9'); g.addColorStop(1, '#f0d9b5');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 26; i++) {
          x.fillStyle = 'hsla(' + (i * 37 % 360) + ',55%,' + (45 + i % 30) + '%,.5)';
          x.beginPath(); x.arc(60 + (i * 137) % 820, 70 + (i * 211) % 480, 24 + (i * 13) % 70, 0, 7); x.fill();
        }
        if (kind === 'detail') {              // 高細節:密集紋理,雜訊底高
          for (let i = 0; i < 5000; i++) {
            x.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,50%,.35)';
            x.fillRect(rnd() * W, rnd() * H, 3, 3);
          }
        }
      }
      const amp = kind === 'noisy' ? 6 : kind === 'smooth' ? 0 : 2; // 感光雜訊
      if (amp) {
        const im = x.getImageData(0, 0, W, H), d = im.data;
        for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
        x.putImageData(im, 0, 0);
      }
      return c;
    }

    const KINDS = [
      ['smooth', '平滑漸層(插畫/設計圖)'],
      ['noisy', '有感光雜訊(實拍照片)'],
      ['detail', '高細節密集紋理'],
      ['flatwhite', '大面積淺色(商品圖/文件)'],
    ];
    const out = { attacks: D.ATTACKS.map((a) => a.name), kinds: KINDS.map((k) => k[1]), rows: [] };
    for (const [kind, label] of KINDS) {
      const b = base(kind);
      const sec = window.IWL_KEY.newSecret(), nodes = P.nodesFromSecret(sec, N);
      const im = F.ctxOf(b).getImageData(0, 0, W, H);
      P.embed(im.data, W, H, nodes, N);
      const st = F.mkCanvas(W, H); F.ctxOf(st).putImageData(im, 0, 0);
      const res = await D.survive(st, nodes, N);
      out.rows.push({ label, res: res.map((r) => ({ z: r.z, psr: r.psr, found: r.found })) });
    }
    return out;
  })()`);

  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log('\n存活矩陣（v2，四種代表性圖片，各一把新金鑰）\n');
  console.log(pad('摧殘方式', 36) + data.kinds.map((k) => pad(k, 24)).join('') + '存活');
  const verdicts = [];
  data.attacks.forEach((name, i) => {
    const cells = data.rows.map((r) => r.res[i]);
    const alive = cells.filter((c) => c.found).length;
    verdicts.push({ name, alive, total: cells.length });
    console.log(pad(name, 36) + cells.map((c) => pad((c.found ? '活 ' : '死 ') + c.z.toFixed(1) + '/' + c.psr.toFixed(1), 24)).join('') + alive + '/' + cells.length);
  });
  console.log('\n建議的 expect（四張全活才算「應該活」，保守）：');
  for (const v of verdicts) console.log('  ' + pad(v.name, 36) + (v.alive === v.total ? 'true ' : 'false') + '   (' + v.alive + '/' + v.total + ')');
} finally {
  await cdp.close();
}
