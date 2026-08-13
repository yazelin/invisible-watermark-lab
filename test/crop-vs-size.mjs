/* test/crop-vs-size.mjs — 「能裁掉多少」到底是不是一個固定的百分比?
   跑法:node test/crop-vs-size.mjs        需要 google-chrome

   使用者問的:「裁切斷點在 75% 到 60% 之間,這個結論是不是只因為我們的測試圖
   剛好那麼大?圖夠大的話,格子夠多,應該可以裁掉更多才對。」

   對。存活矩陣是用 900×620 量的,那是**那張圖的斷點,不是演算法的**。
   同一種內容放大到 3600×2480,裁到只剩 10% 還驗得出來。

   但也不是純粹的格數。斷點落在幾格,從 ~100 格到 ~8600 格都有,取決於每一格的訊噪比:
   真正決定的是「剩下的格子數 × 每格的訊噪比」。大圖佔兩個便宜 —— 格子多,
   而且同樣的內容放大之後每一格裡面更平滑。
   高細節那張是極端例子:900×620 連原圖都驗不出來,3600×2480 卻能裁到剩一半。

   規則:內容跟著尺寸等比放大(不然大圖等於「同樣內容但格子變多」,那是在偷答案);
   雜訊用固定種子。 */
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
    const mk = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };

    // 跟 survive-matrix.mjs 同一組圖,只是內容跟著尺寸等比放大(k)
    function base(kind, W, H) {
      const c = F.mkCanvas(W, H), x = F.ctxOf(c), rnd = mk(7), k = W / 900;
      if (kind === 'flatwhite') {
        x.fillStyle = '#f4f4f2'; x.fillRect(0, 0, W, H);
        x.fillStyle = '#2b3b4e';
        for (let i = 0; i < 6; i++) x.fillRect((120 + i * 110) * k, (200 + (i % 3) * 60) * k, 70 * k, 150 * k);
      } else {
        const g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#2b4a6f'); g.addColorStop(.5, '#7fa6c9'); g.addColorStop(1, '#f0d9b5');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 26; i++) {
          x.fillStyle = 'hsla(' + (i * 37 % 360) + ',55%,' + (45 + i % 30) + '%,.5)';
          x.beginPath(); x.arc((60 + (i * 137) % 820) * k, (70 + (i * 211) % 480) * k, (24 + (i * 13) % 70) * k, 0, 7); x.fill();
        }
        if (kind === 'detail') {
          const n = Math.round(5000 * k * k);
          for (let i = 0; i < n; i++) {
            x.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,50%,.35)';
            x.fillRect(rnd() * W, rnd() * H, 3 * k, 3 * k);
          }
        }
      }
      const amp = kind === 'noisy' ? 6 : kind === 'smooth' ? 0 : 2;
      if (amp) {
        const im = x.getImageData(0, 0, W, H), d = im.data;
        for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
        x.putImageData(im, 0, 0);
      }
      return c;
    }
    const KINDS = [['smooth', '平滑漸層'], ['noisy', '實拍照片'], ['detail', '高細節密集紋理'], ['flatwhite', '大面積淺色']];
    const SIZES = [[3600, 2480], [1800, 1240], [900, 620], [600, 414]];
    const KEEPS = [1, .9, .75, .6, .5, .4, .3, .22, .15, .1];
    const res = [];
    for (const [kind, label] of KINDS) for (const [W, H] of SIZES) {
      const b = base(kind, W, H);
      const nodes = P.nodesFromSecret(window.IWL_KEY.newSecret(), N);
      const im = F.ctxOf(b).getImageData(0, 0, W, H);
      P.embed(im.data, W, H, nodes, N); F.ctxOf(b).putImageData(im, 0, 0);
      let lastLive = null, firstDead = null;
      for (const keep of KEEPS) {
        const c = keep === 1 ? b : D.crop(b, keep);
        const r = P.detect(D.dataOf(c), c.width, c.height, nodes, N);
        const row = { keep, blocks: (c.width >> 4) * (c.height >> 4), z: +r.z.toFixed(1) };
        if (r.found) lastLive = row; else if (!firstDead) firstDead = row;
      }
      res.push({ kind, label, W, H, total: (W >> 4) * (H >> 4), lastLive, firstDead });
    }
    return res;
  })()`);

  const f = (o) => o ? String(o.blocks).padStart(6) + ' 格（剩 ' + String(Math.round(o.keep * 100)).padStart(3) + '%，z=' + String(o.z).padStart(5) + '）' : '          驗不出來';
  let cur = '';
  for (const r of data) {
    if (r.label !== cur) { cur = r.label; console.log('\n  ── ' + cur + ' ──'); }
    console.log('    ' + (r.W + '×' + r.H).padEnd(11) + '總 ' + String(r.total).padStart(6) + ' 格'
      + '　最小還活：' + f(r.lastLive) + '　最大已死：' + f(r.firstDead));
  }

  let bad = 0;
  const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '  ' + x : '')); if (!c) bad++; };
  console.log('');
  const pick = (kind, W) => data.find((r) => r.kind === kind && r.W === W);
  const big = pick('smooth', 3600), mid = pick('smooth', 900);
  ok('同樣內容，圖越大越耐裁（斷點不是固定的百分比）',
    big.lastLive.keep < mid.lastLive.keep,
    '3600 寬裁到剩 ' + Math.round(big.lastLive.keep * 100) + '%　對　900 寬只能到 ' + Math.round(mid.lastLive.keep * 100) + '%');
  ok('但也不是固定的格數（斷點的格數跨了一個數量級以上）',
    Math.max(...data.filter((r) => r.lastLive).map((r) => r.lastLive.blocks))
    > Math.min(...data.filter((r) => r.lastLive).map((r) => r.lastLive.blocks)) * 8,
    '從 ' + Math.min(...data.filter((r) => r.lastLive).map((r) => r.lastLive.blocks))
    + ' 格到 ' + Math.max(...data.filter((r) => r.lastLive).map((r) => r.lastLive.blocks)) + ' 格');
  const dSmall = pick('detail', 900), dBig = pick('detail', 3600);
  ok('高細節圖:900 寬連原圖都驗不出來，同內容放大到 3600 寬就可以',
    !dSmall.lastLive && !!dBig.lastLive,
    '900 寬 z=' + (dSmall.firstDead ? dSmall.firstDead.z : '?') + '　3600 寬可裁到剩 '
    + (dBig.lastLive ? Math.round(dBig.lastLive.keep * 100) + '%' : '—'));
  console.log(bad ? '\n' + bad + ' 項不符' : '\n決定命運的是「剩下的格子數 × 每格的訊噪比」，不是裁掉幾成。');
  if (bad) process.exitCode = 1;
} finally {
  await cdp.close();
}
