/* app.js — 頁面互動。演算法一律走 pure.js / field.js / detect.js,這裡只接線與畫圖。 */
(function () {
  'use strict';
  const P = window.IWL, F = window.IWL_FIELD, D = window.IWL_DETECT;
  const $ = (id) => document.getElementById(id);

  let N = 16, keyNodes = null, keyImg = null, artImg = null, stamped = null;

  // ── 內建示範圖:純幾何,不用字型,任何機器算出來都一樣 ──
  function demoKeyImage() {
    const c = F.mkCanvas(256, 256), x = F.ctxOf(c);
    x.fillStyle = '#111'; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(96, 96, 62, 0, 7); x.fill();
    x.fillRect(120, 140, 110, 92);
    x.fillStyle = '#888';
    x.beginPath(); x.moveTo(20, 236); x.lineTo(96, 132); x.lineTo(150, 236); x.closePath(); x.fill();
    return c;
  }
  function demoArtImage() {
    const c = F.mkCanvas(900, 620), x = F.ctxOf(c);
    const g = x.createLinearGradient(0, 0, 900, 620);
    g.addColorStop(0, '#2b4a6f'); g.addColorStop(.5, '#7fa6c9'); g.addColorStop(1, '#f0d9b5');
    x.fillStyle = g; x.fillRect(0, 0, 900, 620);
    for (let i = 0; i < 26; i++) { // 幾塊色塊,讓它不是純漸層(純漸層太乾淨,不像真作品)
      x.fillStyle = `hsla(${i * 37 % 360},55%,${45 + i % 30}%,.5)`;
      x.beginPath(); x.arc(60 + (i * 137) % 820, 70 + (i * 211) % 480, 24 + (i * 13) % 70, 0, 7); x.fill();
    }
    const im = x.getImageData(0, 0, 900, 620), d = im.data; // 一點雜訊:真實照片不會是數學平滑的
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(im, 0, 0);
    return c;
  }

  const loadFile = (file) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = rej;
    im.src = URL.createObjectURL(file);
  });
  function wireDrop(dropId, onImage) {
    const el = $(dropId);
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    document.body.appendChild(input);
    el.addEventListener('click', (e) => { if (e.target.tagName !== 'A') input.click(); });
    input.addEventListener('change', async () => { if (input.files[0]) onImage(await loadFile(input.files[0])); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); el.classList.remove('over');
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
      if (f) onImage(await loadFile(f));
    });
  }

  // ── 步驟 1:金鑰 ──
  function renderKey() {
    if (!keyImg) return;
    const r = F.nodesFromImage(keyImg, N);
    keyNodes = r.nodes;
    $('keyOut').hidden = false; $('keyStat').hidden = false;

    const co = $('cKeyOrig'); co.width = co.height = 256; F.ctxOf(co).drawImage(keyImg, 0, 0, 256, 256);

    const cg = $('cKeyGray'); cg.width = cg.height = N; // 每格一像素,CSS 放大成馬賽克,一眼看懂「切成 N×N 取平均」
    const gx = F.ctxOf(cg), gim = gx.createImageData(N, N);
    for (let k = 0; k < N * N; k++) { const v = r.gray[k]; gim.data[k * 4] = gim.data[k * 4 + 1] = gim.data[k * 4 + 2] = v; gim.data[k * 4 + 3] = 255; }
    gx.putImageData(gim, 0, 0);

    F.drawFingerprint($('cKeyFp'), keyNodes, N, 16);
    F.drawField($('cKeyField'), keyNodes, N, 1);

    const s = r.strength;
    $('mStrength').style.width = Math.min(100, s * 200) + '%';
    const weak = s < 0.15;
    $('strengthTxt').innerHTML = weak
      ? `<b style="color:#a33">指紋強度 ${s.toFixed(3)}：太弱。</b>這張圖縮成 ${N}×${N} 之後幾乎是一片平的（純色、或細節太滿被平均掉了）。換一張對比明顯、有大塊明暗的圖。`
      : `指紋強度 ${s.toFixed(3)}（RMS）。0.15 以下會不穩，這張夠用。`;
    $('btnStamp').disabled = !(artImg && !weak);
    updateVerifyButtons();
  }

  wireDrop('dropKey', (im) => { keyImg = im; renderKey(); });
  wireDrop('dropArt', (im) => { artImg = im; $('btnStamp').disabled = !keyNodes; });
  $('demoKey').addEventListener('click', (e) => { e.preventDefault(); keyImg = demoKeyImage(); renderKey(); });
  $('demoArt').addEventListener('click', (e) => { e.preventDefault(); artImg = demoArtImage(); $('btnStamp').disabled = !keyNodes; });
  $('nSel').addEventListener('change', () => {
    N = Number($('nSel').value);
    $('thTxt').textContent = P.thresholdFor(N);
    $('nHint').textContent = N === 8
      ? '8×8 的假陽性明顯較高（實測拿別人的金鑰驗，中位數 12.2、最高 18.1），所以門檻要拉到 28。這是它比較好偽造，不只是 logo 認不出來。'
      : '16×16：實測拿別人的金鑰驗，最高 10.2，門檻 16。';
    stamped = null; $('stampOut').hidden = true; $('verifyOut').hidden = true; $('survTable').hidden = true;
    $('btnDownload').disabled = true; renderKey(); updateVerifyButtons();
  });
  $('nSel').dispatchEvent(new Event('change'));

  // ── 步驟 2:蓋章 ──
  $('btnStamp').addEventListener('click', () => {
    stamped = F.stamp(artImg, keyNodes, N, 20);
    $('stampOut').hidden = false;
    const scale = Math.min(1, 860 / stamped.W);
    for (const [id, src] of [['cAfter', stamped.after], ['cBefore', stamped.before], ['cDiff', stamped.diff]]) {
      const c = $(id); c.width = Math.round(stamped.W * scale); c.height = Math.round(stamped.H * scale);
      F.ctxOf(c).drawImage(src, 0, 0, c.width, c.height);
    }
    $('cmpTop').style.width = '50%';
    $('cBefore').style.width = $('cAfter').width + 'px';
    $('btnDownload').disabled = false;
    updateVerifyButtons();
  });
  $('cmpSlider').addEventListener('input', (e) => { $('cmpTop').style.width = e.target.value + '%'; });
  $('btnDownload').addEventListener('click', () => {
    stamped.after.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'stamped.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  });

  // ── 步驟 3:驗證與偽造 ──
  function updateVerifyButtons() {
    const ready = !!(stamped && keyNodes);
    $('btnVerify').disabled = !ready; $('btnForge').disabled = !ready; $('btnSurvive').disabled = !ready;
  }
  function showVerdict(r, label) {
    $('verifyOut').hidden = false;
    const th = P.thresholdFor(N);
    $('vVerdict').className = 'verdict ' + (r.found ? 'yes' : 'no');
    $('vVerdict').textContent = (r.found ? '檢出：這張圖蓋過這把金鑰' : '未檢出') + '　（' + label + '）';
    $('vZ').textContent = 'z = ' + r.z.toFixed(1);
    $('mZ').style.width = Math.min(100, r.z / (th * 2) * 100) + '%';
    $('vDetail').textContent = '門檻 ' + th + '。' + (r.scale && r.scale !== 1 ? '尺度搜尋還原倍率 ×' + r.scale.toFixed(2) + '。' : '')
      + (r.found ? '對上的位移是 ' + (r.shift ? r.shift.join(', ') : '—') + '。' : '有正有負互相抵消，沒有任何位置對得起來。');
  }
  $('btnVerify').addEventListener('click', () => showVerdict(D.detectWithScale(stamped.after, keyNodes, N), '用同一把金鑰'));
  $('btnForge').addEventListener('click', () => {
    const other = F.nodesFromImage(demoForgeKey(), N); // 一把不相干的金鑰
    showVerdict(D.detectWithScale(stamped.after, other, N), '拿別人的金鑰偽造');
  });
  function demoForgeKey() {
    const c = F.mkCanvas(256, 256), x = F.ctxOf(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#000';
    for (let i = 0; i < 9; i++) x.fillRect((i * 71) % 200, (i * 113) % 190, 50, 62);
    return c;
  }

  // ── 步驟 4:存活測試 ──
  $('btnSurvive').addEventListener('click', async () => {
    const btn = $('btnSurvive'); btn.disabled = true;
    $('survTable').hidden = false; $('survBody').innerHTML = '';
    await D.survive(stamped.after, keyNodes, N, (row, i, total) => {
      $('survProg').textContent = i + ' / ' + total;
      const tr = document.createElement('tr');
      const surprise = row.found !== row.expect; // 跟預期不符要標出來,那才是資訊
      if (surprise) tr.className = 'surprise';
      tr.innerHTML = `<td>${row.name}</td><td class="hint">${row.size}</td><td class="num">${row.z.toFixed(1)}</td>`
        + `<td class="${row.found ? 'ok' : 'dead'}">${row.found ? '活著' : '死了'}</td>`
        + `<td class="hint">${row.expect ? '應該活' : '應該死'}${surprise ? '（不符）' : ''}</td>`;
      $('survBody').appendChild(tr);
    });
    $('survProg').textContent = '跑完了。黃底是跟預期不符的,那幾行才是新資訊。';
    btn.disabled = false;
  });
})();
