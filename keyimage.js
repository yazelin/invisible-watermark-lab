/* keyimage.js — 鑰圖:把 secret 做成一張你會想留著、而且弄不丟的圖。
   為什麼是圖不是字串:一串字存在記事本裡會不見,一張圖在相簿裡活得久,而且看得到比較安心。
   代價是「長得像照片的鑰匙會被當照片對待」,所以警告直接烙進像素裡 —— 說明沒人看,圖會跟著圖跑。

   secret 在圖裡存三份,任何一份活著就救得回來:
     iTXt 中繼資料 —— 主要路徑,重新上傳原檔直接讀
     QR 碼        —— 中繼資料被平台洗掉、或只剩一張截圖時,用手機掃
     明文          —— QR 也掃不到時,用眼睛抄
   我們只需要 QR 的「產生」,不需要解碼(掃碼交給手機),所以不引進解碼器。 */
(function (root) {
  'use strict';
  const P = root.IWL, F = root.IWL_FIELD;
  const KEY_TAG = 'IWLKEY1'; // 鑰圖的識別標記:丟一張圖進來要分得出是鑰圖還是作品

  function newSecret() {
    const b = new Uint8Array(20);
    (root.crypto || root.msCrypto).getRandomValues(b);
    return P.secretFromBytes(b);
  }

  const rr = (x, a, b, w, h, r) => { // roundRect 的小墊片,不依賴瀏覽器版本
    x.beginPath();
    x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r);
    x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
    x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r);
    x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.closePath();
  };
  const TC = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

  /* 畫鑰圖。logo 可以是 null(沒有就不畫)。
     設計目標是「一張會想收好的卡」:弄丟就證明不了,所以它得看起來值得保存。
     版面刻意留白、字級拉開層次,重要的東西(金鑰本身、警告)最大最亮。 */
  function render(secret, logoImg, N) {
    const W = 960, H = 700, c = F.mkCanvas(W, H), x = F.ctxOf(c);
    const M = 30, PAD = 64;                       // 外框內縮、內容左右留白

    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0f1c17'); bg.addColorStop(1, '#070f0c');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);

    /* 底紋就是這把金鑰真正的場。壓到很低只當紋理 —— 但要清楚:
       它仍然算金鑰的一部分,實測從底紋能還原出 8 成以上的節點、足以拿去蓋章。 */
    const nodes = P.nodesFromSecret(secret, N);
    const tile = F.mkCanvas(N * P.NODE_PX, N * P.NODE_PX);
    F.drawField(tile, nodes, N, 1);
    x.save(); x.globalAlpha = 0.08; x.fillStyle = x.createPattern(tile, 'repeat');
    x.fillRect(0, 0, W, H); x.restore();
    const vig = x.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, W * 0.8);
    vig.addColorStop(0, 'rgba(7,15,12,0.40)'); vig.addColorStop(1, 'rgba(7,15,12,0.98)');
    x.fillStyle = vig; x.fillRect(0, 0, W, H);

    x.strokeStyle = 'rgba(190,220,205,0.22)'; x.lineWidth = 1;   // 細外框:像證書
    rr(x, M + 0.5, M + 0.5, W - M * 2 - 1, H - M * 2 - 1, 10); x.stroke();

    // ── 頁首 ──
    let y = 108;
    if (logoImg) { // logo 只是標籤,對演算法零貢獻
      const s = 46;
      x.save(); x.beginPath(); x.arc(W - PAD - s / 2, y - 26, s / 2, 0, 7); x.clip();
      x.fillStyle = '#fff'; x.fillRect(W - PAD - s, y - 26 - s / 2, s, s);
      x.drawImage(logoImg, W - PAD - s, y - 26 - s / 2, s, s); x.restore();
    }
    x.fillStyle = 'rgba(150,190,168,0.75)'; x.font = '600 13px ' + TC;
    x.letterSpacing = '4px';
    x.fillText('INVISIBLE WATERMARK LAB', PAD, y - 44);
    x.letterSpacing = '0px';
    x.fillStyle = '#f2f8f4'; x.font = '700 38px ' + TC;
    x.fillText('隱形浮水印　金鑰', PAD, y);
    x.fillStyle = 'rgba(150,190,168,0.9)'; x.font = '15px ' + TC;
    x.fillText('這張圖就是鑰匙本身。弄丟就證明不了，被別人看到等於把名字給人。', PAD, y + 30);

    // ── 金鑰本體:整張圖最重要的東西,給它最大的字和一塊自己的面板 ──
    const ky = 176, kh = 128;
    x.fillStyle = 'rgba(255,255,255,0.055)';
    rr(x, PAD, ky, W - PAD * 2, kh, 14); x.fill();
    x.strokeStyle = 'rgba(190,220,205,0.18)'; x.lineWidth = 1;
    rr(x, PAD + 0.5, ky + 0.5, W - PAD * 2 - 1, kh - 1, 14); x.stroke();
    x.fillStyle = 'rgba(150,190,168,0.8)'; x.font = '600 12px ' + TC;
    x.letterSpacing = '3px'; x.fillText('金鑰', PAD + 26, ky + 34); x.letterSpacing = '0px';
    x.fillStyle = '#f2f8f4'; x.font = '700 36px ui-monospace,"SF Mono",Menlo,monospace';
    x.letterSpacing = '2px'; x.fillText(secret, PAD + 26, ky + 92); x.letterSpacing = '0px';

    // ── 三份備援:QR、指紋、以及看不見的中繼資料 ──
    const by = ky + kh + 46;
    const qr = root.qrcode(0, 'M');
    qr.addData(secret); qr.make();
    const n = qr.getModuleCount(), QP = 150, cell = Math.floor((QP - 20) / n), qs = cell * n;
    x.fillStyle = '#fff'; rr(x, PAD, by, QP, QP, 10); x.fill();
    x.fillStyle = '#0b1410';
    const q0 = PAD + (QP - qs) / 2;
    for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++)
      if (qr.isDark(r, cc)) x.fillRect(q0 + cc * cell, by + (QP - qs) / 2 + r * cell, cell, cell);

    const sw = PAD + QP + 28, SW = 150;              // 指紋方塊:這把金鑰的長相
    x.fillStyle = 'rgba(255,255,255,0.05)'; rr(x, sw, by, SW, SW, 10); x.fill();
    const cellPx = Math.floor((SW - 20) / N), off = (SW - cellPx * N) / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      x.fillStyle = P.nodeAt(nodes, N, i, j) > 0 ? '#5b93c9' : '#c9a95b';
      x.fillRect(sw + off + i * cellPx, by + off + j * cellPx, cellPx, cellPx);
    }

    const tx = sw + SW + 34;
    x.fillStyle = '#dfeae4'; x.font = '600 16px ' + TC;
    x.fillText('同一把金鑰，這張圖裡存了三份', tx, by + 26);
    x.font = '14px ' + TC; x.fillStyle = 'rgba(150,190,168,0.92)';
    const lines = [
      ['左邊的 QR', '手機掃一下就回來'],
      ['上面那行字', '用眼睛照著抄也行'],
      ['PNG 的中繼資料', '看不見，把原檔拖回網頁會自動讀出來'],
    ];
    lines.forEach(([a, b], i) => {
      const ly = by + 60 + i * 30;
      x.fillStyle = '#cfe0d7'; x.font = '600 14px ' + TC; x.fillText('· ' + a, tx, ly);
      x.fillStyle = 'rgba(150,190,168,0.8)'; x.font = '14px ' + TC;
      x.fillText('　' + b, tx + x.measureText('· ' + a).width + 6, ly);
    });
    x.fillStyle = 'rgba(150,190,168,0.62)'; x.font = '13px ' + TC;
    x.fillText('中間那塊色板就是這把金鑰的長相 —— 它也算金鑰的一部分，一樣不能給人看到', tx, by + SW - 2);

    // ── 警告:烙在像素裡,不是寫在網頁上。說明沒人看,但圖會跟著圖跑 ──
    const wy = by + SW + 34, wh = 88;
    x.fillStyle = 'rgba(150,40,32,0.92)'; rr(x, PAD, wy, W - PAD * 2, wh, 10); x.fill();
    x.fillStyle = '#e8564a'; x.fillRect(PAD, wy + 10, 4, wh - 20);
    x.fillStyle = '#fff'; x.font = '700 21px ' + TC;
    x.fillText('不要公開這張圖', PAD + 26, wy + 38);
    x.font = '14px ' + TC; x.fillStyle = 'rgba(255,255,255,0.9)';
    x.fillText('任何看到它的人，都能在別人的作品上蓋出你的浮水印，宣稱那是你做的。', PAD + 26, wy + 66);

    x.fillStyle = 'rgba(150,190,168,0.5)'; x.font = '12px ' + TC;
    x.fillText(KEY_TAG + '　·　yazelin.github.io/invisible-watermark-lab', PAD, H - M - 18);
    return c;
  }

  // ── PNG iTXt:把 secret 也寫進中繼資料 ──
  const CRC = (() => { const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  })();
  function withITXt(buf, text) {
    const b = new Uint8Array(buf);
    // 標記寫進中繼資料,不是只印在圖上 —— 這樣「丟一張圖進來是鑰圖還是作品」才判斷得出來
    const payload = new TextEncoder().encode('Comment\0\0\0\0\0' + KEY_TAG + '|' + text);
    const chunk = new Uint8Array(12 + payload.length), dv = new DataView(chunk.buffer);
    dv.setUint32(0, payload.length);
    chunk.set(new TextEncoder().encode('iTXt'), 4);
    chunk.set(payload, 8);
    dv.setUint32(8 + payload.length, CRC(chunk.subarray(4, 8 + payload.length)));
    const out = new Uint8Array(b.length + chunk.length); // 插在 IHDR(8+25 bytes)之後
    out.set(b.subarray(0, 33), 0); out.set(chunk, 33); out.set(b.subarray(33), 33 + chunk.length);
    return out;
  }
  /* 這張 PNG 是不是鑰圖。判準是中繼資料裡有沒有合法的 secret ——
     舊版下載的鑰圖沒有 KEY_TAG,一樣認得出來,所以不會因為換格式就失效。 */
  const isKeyImage = (buf) => !!readITXt(buf);

  function readITXt(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return null;
    const dv = new DataView(buf);
    for (let p = 8; p + 12 <= b.length;) {
      const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'iTXt') {
        const txt = new TextDecoder().decode(b.subarray(p + 8, p + 8 + len));
        const m = txt.match(/IWL[12](-[0-9A-HJKMNP-TV-Z]{5}){4}/);
        if (m) return m[0];
      }
      p += 12 + len;
    }
    return null;
  }
  const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));
  async function download(secret, logoImg, N, name) {
    const png = await toBlob(render(secret, logoImg, N));
    const out = new Blob([withITXt(await png.arrayBuffer(), secret)], { type: 'image/png' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out); a.download = name || 'iwl-key.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  root.IWL_KEY = { KEY_TAG, newSecret, render, withITXt, readITXt, isKeyImage, download };
})(window);
