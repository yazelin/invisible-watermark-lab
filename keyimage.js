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

  /* 畫鑰圖。logo 可以是 null(沒有就不畫)。 */
  function render(secret, logoImg, N) {
    const W = 900, H = 560, c = F.mkCanvas(W, H), x = F.ctxOf(c);
    x.fillStyle = '#0f1a15'; x.fillRect(0, 0, W, H);

    // 底紋:就是這把金鑰真正的場,放大到看得見。鑰圖本身就展示了它代表的東西
    const nodes = P.nodesFromSecret(secret, N);
    const tile = F.mkCanvas(N * 16, N * 16);
    F.drawField(tile, nodes, N, 1);
    const tx = x.createPattern(tile, 'repeat');
    x.globalAlpha = 0.16; x.fillStyle = tx; x.fillRect(0, 0, W, H); x.globalAlpha = 1;

    // QR:救命的那一層
    const qr = root.qrcode(0, 'M');
    qr.addData(secret); qr.make();
    const n = qr.getModuleCount(), cell = 8, qx = W - n * cell - 44, qy = 150;
    x.fillStyle = '#fff'; x.fillRect(qx - 12, qy - 12, n * cell + 24, n * cell + 24);
    x.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (qr.isDark(r, cc)) x.fillRect(qx + cc * cell, qy + r * cell, cell, cell);

    if (logoImg) { // logo 只是標籤:一資料夾長得一樣的 QR 你分不出哪張是哪張
      const s = 92;
      x.save(); x.beginPath(); x.arc(56 + s / 2, 52 + s / 2, s / 2, 0, 7); x.clip();
      x.fillStyle = '#fff'; x.fillRect(56, 52, s, s);
      x.drawImage(logoImg, 56, 52, s, s); x.restore();
    }
    x.fillStyle = '#eaf3ee'; x.font = '700 30px "Noto Sans TC",sans-serif';
    x.fillText('隱形浮水印 金鑰', logoImg ? 172 : 56, 92);
    x.fillStyle = '#8fb3a1'; x.font = '16px "Noto Sans TC",sans-serif';
    x.fillText('用這張圖驗證你的作品。弄丟就證明不了，外流等於把名字給人。', logoImg ? 172 : 56, 122);

    x.fillStyle = '#eaf3ee'; x.font = '700 27px ui-monospace,monospace';
    x.fillText(secret, 56, 236);
    x.fillStyle = '#8fb3a1'; x.font = '15px "Noto Sans TC",sans-serif';
    x.fillText('掃右邊的 QR，或照著上面這行抄，都能還原這把金鑰。', 56, 268);

    // 警告烙進像素:哪天他真的把這張圖貼出去,他自己和看到的人都會先讀到這句
    x.fillStyle = '#c0392b'; x.fillRect(56, 396, W - 112, 96);
    x.fillStyle = '#fff'; x.font = '700 25px "Noto Sans TC",sans-serif';
    x.fillText('不要公開這張圖', 78, 434);
    x.font = '16px "Noto Sans TC",sans-serif';
    x.fillText('任何看到它的人，都能在別人的作品上蓋出你的浮水印，宣稱那是你做的。', 78, 466);

    x.fillStyle = '#5f7a6c'; x.font = '13px "Noto Sans TC",sans-serif';
    x.fillText(KEY_TAG + ' · yazelin.github.io/invisible-watermark-lab', 56, H - 26);
    return c;
  }

  // ── PNG iTXt:把 secret 也寫進中繼資料 ──
  const CRC = (() => { const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  })();
  function withITXt(buf, text) {
    const b = new Uint8Array(buf);
    const payload = new TextEncoder().encode('Comment\0\0\0\0\0' + text); // keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0
    const chunk = new Uint8Array(12 + payload.length), dv = new DataView(chunk.buffer);
    dv.setUint32(0, payload.length);
    chunk.set(new TextEncoder().encode('iTXt'), 4);
    chunk.set(payload, 8);
    dv.setUint32(8 + payload.length, CRC(chunk.subarray(4, 8 + payload.length)));
    const out = new Uint8Array(b.length + chunk.length); // 插在 IHDR(8+25 bytes)之後
    out.set(b.subarray(0, 33), 0); out.set(chunk, 33); out.set(b.subarray(33), 33 + chunk.length);
    return out;
  }
  function readITXt(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return null;
    const dv = new DataView(buf);
    for (let p = 8; p + 12 <= b.length;) {
      const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'iTXt') {
        const txt = new TextDecoder().decode(b.subarray(p + 8, p + 8 + len));
        const m = txt.match(/IWL1(-[0-9A-HJKMNP-TV-Z]{5}){4}/);
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

  root.IWL_KEY = { KEY_TAG, newSecret, render, withITXt, readITXt, download };
})(window);
