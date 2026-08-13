/* test/e2e.mjs — 真瀏覽器端到端:載入頁面 → 用內建示範圖蓋章 → 驗證 → 偽造 → 存活矩陣。
   零相依:直接 spawn Chrome 講 CDP(node 22 內建 WebSocket),不裝 playwright/puppeteer。
   跑法:node test/e2e.mjs      需要本機有 google-chrome(可用 CHROME 環境變數指定)

   負控制在第 3 段:拿別人的金鑰去驗必須「未檢出」。
   只量得到不夠,不然做出來的不是偵測器,是一個永遠說是的按鈕。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert';

const CHROME = process.env.CHROME || 'google-chrome';
const PAGE = process.env.PAGE || ('file://' + resolve(import.meta.dirname, '..', 'index.html'));

async function openChrome() {
  const dir = mkdtempSync(join(tmpdir(), 'iwl-e2e-'));
  const port = 9300 + Math.floor(performance.now() % 300);
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
  }
  assert.ok(ws, '連不上 Chrome 的 DevTools 端點,確認裝了 ' + CHROME);
  const sock = new WebSocket(ws);
  await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
  let id = 0; const waiting = new Map();
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) waiting.get(m.id)(m); };
  const send = (method, params, sessionId) => new Promise((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(method + ': ' + m.error.message)) : r(m.result)));
    sock.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  const close = async () => {
    try { sock.close(); } catch (e) {}
    await new Promise((r) => { proc.once('exit', r); proc.kill(); setTimeout(r, 3000); });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { send, close };
}
async function openPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await new Promise((r) => setTimeout(r, 1500));
  return async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, timeout: 300000 }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
}

const cdp = await openChrome();
let failed = 0;
const ok = (name, cond, extra) => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };
try {
  const run = await openPage(cdp, PAGE);

  console.log('頁面載入');
  ok('三個引擎檔都掛上了', await run('!!(window.IWL && window.IWL_FIELD && window.IWL_DETECT)'));

  console.log('\n步驟 1-3:產生金鑰 → 示範作品 → 蓋章');
  const stamp = await run(`(() => {
    document.getElementById('btnNewKey').click();
    document.getElementById('demoArt').click();
    document.getElementById('btnStamp').click();
    return { keyShown: !document.getElementById('keyOut').hidden,
             fieldShown: !document.getElementById('fieldOut').hidden,
             stampShown: !document.getElementById('stampOut').hidden,
             secret: document.getElementById('secretTxt').textContent };
  })()`);
  ok('金鑰產生了,格式正確', /^IWL1(-[0-9A-HJKMNP-TV-Z]{5}){4}$/.test(stamp.secret), stamp.secret);
  ok('鑰圖畫出來了', stamp.keyShown);
  ok('指紋/場/鋪滿/振幅四張都畫了', stamp.fieldShown);
  ok('蓋章結果有顯示', stamp.stampShown);

  console.log('\n步驟 4:驗證(正向)');
  const pos = await run(`(async () => {
    document.getElementById('btnVerify').click();
    await new Promise((r) => { const t = setInterval(() => {
      if (!document.getElementById('btnVerify').disabled && document.getElementById('vVerdict').textContent) { clearInterval(t); r(); } }, 200); });
    return { txt: document.getElementById('vVerdict').textContent,
             z: parseFloat(document.getElementById('vZ').textContent),
             psr: parseFloat(document.getElementById('vPsr').textContent) };
  })()`);
  ok('用同一把金鑰 → 檢出', /^檢出/.test(pos.txt), 'z=' + pos.z + ' psr=' + pos.psr);

  console.log('\n步驟 4:偽造(負控制,這條最重要)');
  const neg = await run(`(() => {
    return { txt: document.getElementById('fVerdict').textContent,
             z: parseFloat(document.getElementById('fZ').textContent),
             psr: parseFloat(document.getElementById('fPsr').textContent) };
  })()`);
  ok('拿別人的金鑰 → 未檢出', /^未檢出/.test(neg.txt), 'z=' + neg.z + ' psr=' + neg.psr);
  ok('偽造的 PSR 明顯低於真的(這才是判準)', neg.psr < pos.psr / 2, neg.psr + ' vs ' + pos.psr);

  console.log('\n步驟 5:還原(證明可逆)');
  const res = await run(`(() => {
    document.getElementById('btnRestore').click();
    return document.getElementById('restoreOut').textContent;
  })()`);
  const pct = parseFloat((res.match(/([\d.]+)%/) || [])[1] || '0');
  ok('減回去之後幾乎逐像素還原', pct > 99, pct + '% 相同');

  /* 步驟 7 是實際使用情境:拿回一張圖 + 你保存的鑰圖,問「這是不是我的」。
     兩邊都不是這個分頁產生的,所以要走真的檔案(鑰圖要讀 PNG 的 iTXt)。 */
  console.log('\n步驟 7:拿任意圖 + 任意金鑰來驗(實際使用情境)');
  const ck = await run(`(async () => {
    const P = window.IWL, F = window.IWL_FIELD, K = window.IWL_KEY, N = 16;
    const sec = K.newSecret(), nodes = P.nodesFromSecret(sec, N);
    const card = K.render(sec, null, N);
    const cardPng = await new Promise((r) => card.toBlob(r, 'image/png'));
    const keyFile = new File([K.withITXt(await cardPng.arrayBuffer(), sec)], 'k.png', { type: 'image/png' });
    const art = F.mkCanvas(800, 560), ax = F.ctxOf(art);
    const g = ax.createLinearGradient(0, 0, 800, 560); g.addColorStop(0, '#356'); g.addColorStop(1, '#eca');
    ax.fillStyle = g; ax.fillRect(0, 0, 800, 560);
    const im = ax.getImageData(0, 0, 800, 560); P.embed(im.data, 800, 560, nodes, N); ax.putImageData(im, 0, 0);
    const artPng = await new Promise((r) => art.toBlob(r, 'image/png'));
    const drop = (el, file) => { const dt = new DataTransfer(); dt.items.add(file);
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
    drop(document.getElementById('dropCheckKey'), keyFile);
    drop(document.getElementById('dropCheckImg'), new File([artPng], 'w.png', { type: 'image/png' }));
    await new Promise((r) => setTimeout(r, 700));
    const readKey = document.getElementById('ckKeyInfo').textContent.includes(sec);
    document.getElementById('btnCheck').click();
    await new Promise((r) => { const t = setInterval(() => {
      if (!document.getElementById('btnCheck').disabled && !document.getElementById('ckOut').hidden) { clearInterval(t); r(); } }, 200); });
    const good = { v: document.getElementById('ckVerdict').textContent,
                   z: parseFloat(document.getElementById('ckZ').textContent),
                   psr: parseFloat(document.getElementById('ckPsr').textContent) };
    const el = document.getElementById('ckSecret');
    el.value = K.newSecret(); el.dispatchEvent(new Event('change'));
    document.getElementById('btnCheck').click();
    await new Promise((r) => { const t = setInterval(() => {
      if (!document.getElementById('btnCheck').disabled) { clearInterval(t); r(); } }, 200); });
    return { readKey, good, bad: { v: document.getElementById('ckVerdict').textContent,
             z: parseFloat(document.getElementById('ckZ').textContent),
             psr: parseFloat(document.getElementById('ckPsr').textContent) } };
  })()`);
  ok('鑰圖丟進去能讀出金鑰(PNG iTXt)', ck.readKey);
  ok('外部的圖 + 外部的鑰圖 → 檢出', /^檢出/.test(ck.good.v), 'z=' + ck.good.z + ' psr=' + ck.good.psr);
  ok('同一張圖換別把金鑰 → 未檢出', /^未檢出/.test(ck.bad.v), 'z=' + ck.bad.z + ' psr=' + ck.bad.psr);

  console.log('\n步驟 4:存活矩陣(真的 JPEG / 裁切 / 縮放 / 旋轉)');
  const rows = await run(`(async () => {
    // 走頁面真正的按鈕,不要自己在測試裡重組物件 —— 第一版就是抓了畫面上縮小顯示的 canvas,
    // 量到的是被重採樣過的圖,整張矩陣都不算數。
    document.getElementById('btnSurvive').click();
    await new Promise((r) => { const t = setInterval(() => {
      if (!document.getElementById('btnSurvive').disabled && document.querySelectorAll('#survBody tr').length >= 21) { clearInterval(t); r(); } }, 300); });
    return [...document.querySelectorAll('#survBody tr')].map((tr) => {
      const td = tr.querySelectorAll('td');
      return { name: (td[1].firstChild ? td[1].firstChild.textContent : td[1].textContent).trim(),
               size: (td[1].querySelector('span') || {}).textContent || '',
               blocks: td[2].textContent.trim(),
               z: parseFloat(td[3].textContent),
               psr: parseFloat(td[4].textContent),
               found: td[5].textContent === '活著', expect: td[6].textContent.startsWith('應該活') };
    });
  })()`);
  console.log('    ' + '摧殘方式'.padEnd(34) + '尺寸'.padEnd(12) + 'z'.padStart(7) + 'PSR'.padStart(7) + '  結果   預期');
  let surprises = 0;
  for (const r of rows) {
    const s = r.found !== r.expect;
    if (s) surprises++;
    console.log('    ' + r.name.padEnd(32) + r.size.padEnd(12) + r.z.toFixed(1).padStart(7) + r.psr.toFixed(1).padStart(7) + '  ' +
      (r.found ? '活著' : '死了') + '   ' + (r.expect ? '應該活' : '應該死') + (s ? '  ← 不符' : ''));
  }
  ok('存活矩陣跑完 21 項', rows.length === 21);
  ok('原圖對照活著', rows[0].found, 'z=' + rows[0].z.toFixed(1));
  ok('旋轉 30 度確實死掉(已知限制,不是宣稱)', !rows[rows.length - 1].found);
  // ── 附錄:v1(logo 當金鑰)的對照。這段的存在是為了讓「白化補得回來」這個結論不會再度失真 ──
  console.log('\n[6] 附錄:logo 當金鑰');
  await run(`document.getElementById('v1box').open=true;document.getElementById('btnV1Demo').click();1`);
  await run(`(async()=>{document.getElementById('btnV1Run').click();
    for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,500));
      if(!document.getElementById('v1Table').hidden&&!document.getElementById('btnV1Run').disabled)return 1}return 0})()`);
  const v1rows = await run(`[...document.querySelectorAll('#v1Body tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.textContent))`);
  v1rows.forEach((r) => console.log('    ' + r[0].padEnd(16) + r.slice(1).map((v) => v.padStart(7)).join('')));
  const vn = (r) => r.slice(1).map(Number);
  const raw = vn(v1rows[0]), wht = vn(v1rows[1]), rnd = vn(v1rows[2]);
  ok('白化把低頻 logo 的指紋拉回來', wht[1] > raw[1], raw[1] + ' → ' + wht[1]);
  ok('金鑰字串的指紋強度仍是最高的', rnd[0] >= wht[0], wht[0] + ' vs ' + rnd[0]);
  ok('三種指紋裁 75% 都還活著(效能不是放棄 logo 的理由)', raw[3] > 6 && wht[3] > 6 && rnd[3] > 6,
    [raw[3], wht[3], rnd[3]].join(' / '));

  console.log('\n  跟預期不符:' + surprises + ' 項' + (surprises ? '(上面標「不符」的,那幾行是新資訊,要回頭改預期或改演算法)' : ''));
} finally {
  await cdp.close();
}
console.log(failed ? '\n✗ ' + failed + ' 項失敗' : '\n全部通過');
process.exit(failed ? 1 : 0);
