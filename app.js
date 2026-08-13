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
    const im = x.getImageData(0, 0, 900, 620), d = im.data; // 一點雜訊:真實照片不會是數學平滑的
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
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
  });

  // ── 步驟 5:還原 ──
  $('btnRestore').addEventListener('click', () => {
    const W = stamped.W, H = stamped.H;
    const im = F.ctxOf(stamped.after).getImageData(0, 0, W, H);
    P.unembed(im.data, W, H, nodes, N);
    const orig = F.ctxOf(stamped.before).getImageData(0, 0, W, H).data;
    let same = 0, diff = 0, maxd = 0;
    for (let i = 2; i < orig.length; i += 4) {
      const d = Math.abs(orig[i] - im.data[i]);
      if (d === 0) same++; else { diff++; maxd = Math.max(maxd, d); }
    }
    const pct = (same / (same + diff) * 100).toFixed(2);
    $('restoreOut').hidden = false;
    $('restoreOut').innerHTML = `減回去之後，<b>${pct}%</b> 的像素跟原圖完全相同，最大殘差 ${maxd}/255。`
      + (maxd <= 1 ? '殘差來自抖動與夾邊的取整，不是演算法有誤。' : '')
      + ' 沒有金鑰的人算不出這個場，也就減不掉。';
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
        + `<td>${row.name}<br><span class="hint">${row.size}</span></td><td class="num">${row.z.toFixed(1)}</td>`
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
