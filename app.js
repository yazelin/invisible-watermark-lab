/* app.js — 頁面互動。演算法一律走 pure.js / field.js / detect.js / keyimage.js,這裡只接線與畫圖。 */
(function () {
  'use strict';
  const P = window.IWL, F = window.IWL_FIELD, D = window.IWL_DETECT, K = window.IWL_KEY;
  const $ = (id) => document.getElementById(id);
  const N = 16;

  let secret = null, nodes = null, logoImg = null, artImg = null, stamped = null;

  // ── 步驟 1:金鑰 ──
  function useSecret(s) {
    if (!P.isSecret(s)) { alert('金鑰格式不對,應該長得像 IWL1-XXXXX-XXXXX-XXXXX-XXXXX'); return; }
    secret = String(s).trim().toUpperCase();
    nodes = P.nodesFromSecret(secret, N);
    $('keyOut').hidden = false; $('fieldOut').hidden = false;
    $('secretTxt').textContent = secret;
    drawKeyCard(); drawField();
    $('btnStamp').disabled = !artImg;
    if (artImg) $('stampHint').textContent = '← 接下來按這顆';
  }
  const drawKeyCard = () => {
    const card = K.render(secret, logoImg, N), c = $('cKeyCard');
    c.width = card.width; c.height = card.height;
    F.ctxOf(c).drawImage(card, 0, 0);
  };
  function drawField() {
    F.drawFingerprint($('cFp'), nodes, N, 16);
    F.drawField($('cField'), nodes, N, 1);
    const t = $('cTile'); // 鋪滿:同一塊圖樣重複,所以任何碎片都含有完整圖樣
    t.width = t.height = N * 16 * 2;
    F.drawField(t, nodes, N, 2);
    const a = $('cAmp'); // 真實振幅:±2/255,放大 40 倍才看得見
    a.width = a.height = N * 16;
    const x = F.ctxOf(a), im = x.createImageData(a.width, a.height), d = im.data;
    const ss = (v) => v * v * (3 - 2 * v);
    for (let y = 0; y < a.height; y++) {
      const gy = y >> 4, fy = ss(((y & 15) + 0.5) / 16);
      for (let xx = 0; xx < a.width; xx++) {
        const gx = xx >> 4, fx = ss(((xx & 15) + 0.5) / 16);
        const s = (P.nodeAt(nodes, N, gx, gy) * (1 - fx) + P.nodeAt(nodes, N, gx + 1, gy) * fx) * (1 - fy)
                + (P.nodeAt(nodes, N, gx, gy + 1) * (1 - fx) + P.nodeAt(nodes, N, gx + 1, gy + 1) * fx) * fy;
        const p = (y * a.width + xx) * 4, v = 128 + Math.round(P.AMP * s) * 40;
        d[p] = d[p + 1] = d[p + 2] = v < 0 ? 0 : v > 255 ? 255 : v; d[p + 3] = 255;
      }
    }
    x.putImageData(im, 0, 0);
  }
  $('btnNewKey').addEventListener('click', () => useSecret(K.newSecret()));
  $('btnUseSecret').addEventListener('click', () => useSecret($('inSecret').value));
  $('btnKeyDl').addEventListener('click', () => K.download(secret, logoImg, N, 'iwl-key.png'));

  const loadFile = (file) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file);
  });
  function pickImage(onImage) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.addEventListener('change', async () => { if (input.files[0]) onImage(await loadFile(input.files[0])); });
    input.click();
  }
  $('btnLogo').addEventListener('click', () => pickImage((im) => { logoImg = im; drawKeyCard(); }));

  // ── 步驟 3:作品與蓋章 ──
  function wireDrop(id, onImage) {
    const el = $(id);
    el.addEventListener('click', (e) => { if (e.target.tagName !== 'A') pickImage(onImage); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); el.classList.remove('over');
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
      if (f) onImage(await loadFile(f));
    });
  }
  /* 選好圖一定要有回饋:縮圖 + 尺寸 + 明講下一步該按什麼。
     原本只是把按鈕變成可按,使用者按完示範圖不知道發生了什麼,也不知道要往下按。 */
  function setArt(im, name) {
    artImg = im;
    const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height;
    const c = $('cPick'), sc = 96 / W;
    c.width = 96; c.height = Math.round(H * sc);
    F.ctxOf(c).drawImage(im, 0, 0, c.width, c.height);
    $('picked').hidden = false;
    $('pickName').textContent = name;
    $('pickSize').textContent = W + ' × ' + H + ' 像素';
    $('dropTxt').textContent = '換一張作品';
    $('dropArt').classList.add('ready');
    const b = $('btnStamp');
    b.disabled = !nodes;
    $('stampHint').textContent = nodes ? '← 接下來按這顆' : '還缺一把金鑰,先回到步驟 1 產生一把';
    if (!b.disabled) { b.classList.remove('nextcue'); void b.offsetWidth; b.classList.add('nextcue'); }
  }
  wireDrop('dropArt', (im) => setArt(im, '你選的作品'));
  $('demoArt').addEventListener('click', (e) => { e.preventDefault(); setArt(demoArt(), '內建示範圖'); });
  function demoArt() {
    const c = F.mkCanvas(900, 620), x = F.ctxOf(c);
    const g = x.createLinearGradient(0, 0, 900, 620);
    g.addColorStop(0, '#2b4a6f'); g.addColorStop(.5, '#7fa6c9'); g.addColorStop(1, '#f0d9b5');
    x.fillStyle = g; x.fillRect(0, 0, 900, 620);
    for (let i = 0; i < 26; i++) {
      x.fillStyle = `hsla(${i * 37 % 360},55%,${45 + i % 30}%,.5)`;
      x.beginPath(); x.arc(60 + (i * 137) % 820, 70 + (i * 211) % 480, 24 + (i * 13) % 70, 0, 7); x.fill();
    }
    /* 雜訊用固定種子,不用 Math.random:示範圖每次重整都不一樣的話,
       頁面上量到的 z、PSR、存活結果就不可重現,別人照著跑會得到不同的數字。 */
    const im = x.getImageData(0, 0, 900, 620), d = im.data;
    let sd = 20260813;
    const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(im, 0, 0);
    return c;
  }
  $('btnStamp').addEventListener('click', () => {
    stamped = F.stamp(artImg, nodes, N, 20);
    $('stampOut').hidden = false;
    const scale = Math.min(1, 900 / stamped.W);
    for (const [id, src] of [['cAfter', stamped.after], ['cBefore', stamped.before], ['cDiff', stamped.diff]]) {
      const c = $(id); c.width = Math.round(stamped.W * scale); c.height = Math.round(stamped.H * scale);
      F.ctxOf(c).drawImage(src, 0, 0, c.width, c.height);
    }
    setSplit(50);
    for (const b of ['btnDownload', 'btnVerify', 'btnSurvive', 'btnRestore']) $(b).disabled = false;
    $('stampHint').textContent = '蓋好了。拉下面的滑桿比對,然後往下捲到步驟 4 驗證。';
    const v = $('btnVerify'); v.classList.remove('nextcue'); void v.offsetWidth; v.classList.add('nextcue');
  });
  const setSplit = (v) => { $('cBefore').style.clipPath = 'inset(0 ' + (100 - v) + '% 0 0)'; };
  $('cmpSlider').addEventListener('input', (e) => setSplit(e.target.value));
  $('btnDownload').addEventListener('click', () => {
    stamped.after.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'stamped.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  });

  // ── 步驟 4:驗證(一次跑兩把金鑰,並排比較) ──
  /* 兩張熱圖一定要用同一個色階。各自正規化的話,純雜訊也會被拉到滿刻度、
     看起來像有峰值 —— 那會把「一格獨亮 vs 一片平」這個教學點整個毀掉。 */
  function drawMap(canvas, map, scaleMax) {
    const cell = 14; canvas.width = canvas.height = N * cell;
    const x = F.ctxOf(canvas);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const t = Math.max(0, Math.min(1, map[j * N + i] / (scaleMax || 1)));
      x.fillStyle = `rgb(${Math.round(247 - t * 236)},${Math.round(250 - t * 128)},${Math.round(248 - t * 179)})`;
      x.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  const verdictOf = (el, r, label) => {
    el.className = 'verdict ' + (r.found ? 'yes' : 'no');
    el.textContent = (r.found ? '檢出' : '未檢出') + '　（' + label + '）';
  };
  $('btnVerify').addEventListener('click', async () => {
    const b = $('btnVerify'); b.disabled = true; b.textContent = '驗證中…';
    const mine = await D.detectWithScale(stamped.after, nodes, N, null, true);
    /* 錯的金鑰不跑尺度搜尋:它在任何倍率下都不會對上,掃 32 個倍率純粹是等待。
       原本這裡跟正向走同一條路,按下去要卡好幾秒。 */
    const other = P.nodesFromSecret(K.newSecret(), N);
    const bad = P.detect(D.dataOf(stamped.after), stamped.W, stamped.H, other, N, { wantMap: true });

    $('verifyOut').hidden = false;
    verdictOf($('vVerdict'), mine, '你的金鑰');
    verdictOf($('fVerdict'), bad, '別人的金鑰');
    // 每個數字自己標過關與否,人才看得出「為什麼」判成這樣,而不是只看到一個結論
    const num = (id, v, min) => { const el = $(id); el.textContent = v.toFixed(1); el.className = v > min ? 'pass' : 'fail'; };
    num('vZ', mine.z, mine.zMin); num('vPsr', mine.psr, mine.psrMin);
    num('fZ', bad.z, bad.zMin); num('fPsr', bad.psr, bad.psrMin);
    $('zMin').textContent = mine.zMin; $('psrMin').textContent = mine.psrMin;
    $('vDetail').textContent = (mine.scale && mine.scale !== 1 ? '尺度搜尋還原倍率 ×' + mine.scale.toFixed(2) + '。' : '')
      + (mine.found ? '對上的位移是 (' + mine.shift.join(', ') + ')。' : 'z 或 PSR 沒過關。');
    const top = Math.max(1e-9, mine.map ? Math.max(...mine.map) : 1);
    if (mine.map) drawMap($('cMapGood'), mine.map, top);
    if (bad.map) drawMap($('cMapBad'), bad.map, top); // 同一個色階
    b.disabled = false; b.textContent = '驗證';
    lastScan = { mine: mine.map, bad: bad.map, shift: mine.shift, found: mine.found };
    $('scanWrap').hidden = !(mine.map && bad.map);
    drawScan(1); // 先畫完整的靜態圖,按播放才逐格跑
  });

  /* 逐格對答案的動畫。熱圖是「結果」,這個是「過程」—— 使用者看不到「對齊」發生,
     就感覺不到 PSR 在量什麼。灰帶=沒對上的分數範圍(中位數±MAD),PSR 就是最高那根
     比帶子高多少。 */
  let lastScan = null, scanTimer = null;
  const band = (arr) => {
    const a = [...arr].sort((x, y) => x - y), med = a[a.length >> 1];
    const d = a.map((v) => Math.abs(v - med)).sort((x, y) => x - y);
    return { med, mad: Math.max(1e-6, d[d.length >> 1] * 1.4826) };
  };
  function drawScan(progress) {
    if (!lastScan) return;
    /* 上下兩排、各自算自己的旁瓣帶,不要疊在同一張圖上。
       疊在一起時「你的金鑰」整排看起來都比較高,會讀成「到處都比較準」——
       那不是重點,而且會誤導。重點是:你的那排有一根衝出自己的帶子,別人的那排沒有。 */
    const c = $('cScan'), W = 900, PH = 132, H = PH * 2 + 26;
    c.width = W; c.height = H;
    const x = F.ctxOf(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const top = Math.max(...lastScan.mine, ...lastScan.bad, 1) * 1.08;
    const n = lastScan.mine.length, bw = W / n, upto = Math.floor(n * progress);

    const panel = (arr, oy, color, label) => {
      const y0 = oy + PH - 18, hh = PH - 30;
      const bd = band(arr.filter((v, i) => v < top * 0.55)); // 帶子只用非峰值算,不然峰值自己會撐大帶寬
      const py = (v) => y0 - Math.max(0, v) / top * hh;
      x.fillStyle = '#eef1ef';
      const bt = py(bd.med + 3 * bd.mad), bb = py(Math.max(0, bd.med - 3 * bd.mad));
      x.fillRect(0, bt, W, Math.max(2, bb - bt));
      for (let i = 0; i < upto; i++) {
        const out = arr[i] > bd.med + 3 * bd.mad;
        x.fillStyle = out ? color : color === '#0b7a45' ? '#9ecdb5' : '#c3ccc7';
        x.fillRect(i * bw, py(arr[i]), Math.max(1, bw - 1), y0 - py(arr[i]));
      }
      x.strokeStyle = '#16211c'; x.beginPath(); x.moveTo(0, y0); x.lineTo(W, y0); x.stroke();
      x.fillStyle = color; x.font = '700 13px "Noto Sans TC",sans-serif';
      x.fillText(label, 8, oy + 14);
      x.fillStyle = '#9aa8a0'; x.font = '12px "Noto Sans TC",sans-serif';
      x.fillText('灰帶＝沒對上的分數範圍', 8, bt - 5);
    };
    panel(lastScan.mine, 0, '#0b7a45', '你的金鑰');
    panel(lastScan.bad, PH, '#8a9790', '別人的金鑰');
    x.fillStyle = '#5f7168'; x.font = '12px "Noto Sans TC",sans-serif';
    x.fillText('256 個可能的位移（由左至右逐格滑過去）', 8, H - 6);
  }

  $('btnScan').addEventListener('click', () => {
    if (!lastScan) return;
    clearInterval(scanTimer);
    const n = lastScan.mine.length; let i = 0;
    $('btnScan').textContent = '重播';
    scanTimer = setInterval(() => {
      i += 4;
      drawScan(i / n);
      const k = Math.min(n - 1, i);
      $('scanTxt').textContent = '位移 (' + (k % 16) + ', ' + Math.floor(k / 16) + ')　你的金鑰 '
        + lastScan.mine[k].toFixed(1) + '　別人的 ' + lastScan.bad[k].toFixed(1);
      if (i >= n) {
        clearInterval(scanTimer);
        const mx = Math.max(...lastScan.mine), bd2 = band(lastScan.bad);
        $('scanTxt').textContent = '掃完了。你的金鑰最高 ' + mx.toFixed(1)
          + '，而帶子的中心在 ' + bd2.med.toFixed(1) + '　→　高出 ' + ((mx - bd2.med) / bd2.mad).toFixed(1) + ' 倍帶寬，這就是 PSR。';
      }
    }, 24);
  });

  // ── 步驟 5:還原 ──
  /* 只給一行「99% 相同」等於沒教。用跟步驟 3 同一種差異放大來看:
     蓋好的看得到指紋鋪滿、還原後一片空白、用別人的金鑰硬減則變得更亂 —— 三張並排,
     再各自拿回去重驗一次,可逆與「沒金鑰減不掉」兩件事都變成看得到的東西。 */
  function diffCanvas(id, aData, bData, W, H) {
    const c = $(id), sc = Math.min(1, 300 / W);
    const full = F.mkCanvas(W, H), im = F.ctxOf(full).createImageData(W, H), d = im.data;
    for (let i = 0; i < aData.length; i += 4) {
      const v = 128 + (bData[i + 2] - aData[i + 2]) * 20;
      d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v; d[i + 3] = 255;
    }
    F.ctxOf(full).putImageData(im, 0, 0);
    c.width = Math.round(W * sc); c.height = Math.round(H * sc);
    F.ctxOf(c).drawImage(full, 0, 0, c.width, c.height);
  }
  $('btnRestore').addEventListener('click', async () => {
    const btn = $('btnRestore'); btn.disabled = true; btn.textContent = '計算中…';
    const W = stamped.W, H = stamped.H;
    const orig = F.ctxOf(stamped.before).getImageData(0, 0, W, H).data;
    const stampedData = F.ctxOf(stamped.after).getImageData(0, 0, W, H).data;

    const mine = new Uint8ClampedArray(stampedData);
    P.unembed(mine, W, H, nodes, N);
    const wrongKey = P.nodesFromSecret(K.newSecret(), N);
    const wrong = new Uint8ClampedArray(stampedData);
    P.unembed(wrong, W, H, wrongKey, N);

    $('restoreGrid').hidden = false;
    diffCanvas('cRd0', orig, stampedData, W, H);
    diffCanvas('cRd1', orig, mine, W, H);
    diffCanvas('cRd2', orig, wrong, W, H);

    // 各自拿回去用「你的金鑰」重驗:還原後應該驗不出來,別人硬減過的應該還在
    const zOf = (data) => { const r = P.detect(data, W, H, nodes, N); return r; };
    const r0 = zOf(stampedData), r1 = zOf(mine), r2 = zOf(wrong);
    const fmt = (r) => (r.found ? '檢出' : '未檢出') + '　z ' + r.z.toFixed(1) + '　PSR ' + r.psr.toFixed(1);
    $('rd0').textContent = '重驗：' + fmt(r0);
    $('rd1').textContent = '重驗：' + fmt(r1);
    $('rd2').textContent = '重驗：' + fmt(r2);

    let same = 0, tot = 0, mx = 0;
    for (let i = 2; i < orig.length; i += 4) { tot++; const d = Math.abs(orig[i] - mine[i]); if (d === 0) same++; else mx = Math.max(mx, d); }
    $('restoreOut').hidden = false;
    $('restoreOut').innerHTML = '用你的金鑰減回去之後，<b>' + (same / tot * 100).toFixed(2) + '%</b> 的像素跟原圖完全相同，最大殘差 '
      + mx + '/255' + (mx <= 1 ? '（殘差來自抖動與 0/255 的夾邊，不是演算法有誤）' : '') + '。'
      + '中間那張差異圖是空的，代表指紋真的被拿掉了；右邊那張用別人的金鑰硬減，反而多蓋了一層，你的浮水印還在。';
    btn.disabled = false; btn.textContent = '把浮水印減回去';
  });

  // ── 步驟 6:存活測試 ──
  $('btnSurvive').addEventListener('click', async () => {
    const btn = $('btnSurvive'); btn.disabled = true;
    $('survTable').hidden = false; $('survBody').innerHTML = '';
    await D.survive(stamped.after, nodes, N, (row, i, total) => {
      $('survProg').textContent = i + ' / ' + total + '　' + row.name;
      const tr = document.createElement('tr');
      const surprise = row.found !== row.expect; // 跟預期不符才是新資訊
      if (surprise) tr.className = 'surprise';
      tr.innerHTML = `<td><img class="thumb" src="${row.thumb}" alt=""></td>`
        + `<td>${row.name}<br><span class="hint">${row.size}</span></td>`
        + `<td class="num">${row.blocks.toLocaleString()}<br><span class="hint">${row.scale !== 1 ? '還原 ×' + row.scale.toFixed(2) + '　' : ''}磁磚 ${row.tiles.toFixed(1)} 塊</span></td>`
        + `<td class="num">${row.z.toFixed(1)}</td>`
        + `<td class="num">${(row.psr || 0).toFixed(1)}</td>`
        + `<td class="${row.found ? 'ok' : 'dead'}">${row.found ? '活著' : '死了'}</td>`
        + `<td class="hint">${row.expect ? '應該活' : '應該死'}${surprise ? '（不符）' : ''}</td>`;
      $('survBody').appendChild(tr);
    });
    $('survProg').textContent = '跑完了。黃底是跟預期不符的那幾行,那才是新資訊。';
    btn.disabled = false;
  });

  // 鑰圖拖進來就讀出金鑰(中繼資料),讓「丟一張圖進來」自動分辨是鑰圖還是作品
  document.addEventListener('drop', async (e) => {
    const f = [...(e.dataTransfer ? e.dataTransfer.files : [])].find((x) => x.type === 'image/png');
    if (!f) return;
    const s = K.readITXt(await f.arrayBuffer());
    if (s && !secret) { e.preventDefault(); useSecret(s); }
  }, true);
})();
