/* detect.js — 瀏覽器端:同步搜尋(平移已在 pure.js 裡,這裡加尺度)與存活測試的摧殘手法。
   摧殘手法故意做成一張可讀的清單:這頁最有說服力的東西不是「它驗得出來」,
   是「它在哪些情況下會死」——兩邊都給,人才會相信前面那半。 */
(function (root) {
  'use strict';
  const P = root.IWL, F = root.IWL_FIELD;

  const canvasOf = (src) => { // ImageBitmap / Image / canvas 都吃
    if (src.getContext) return src;
    const c = F.mkCanvas(src.naturalWidth || src.width, src.naturalHeight || src.height);
    F.ctxOf(c).drawImage(src, 0, 0);
    return c;
  };
  const dataOf = (c) => F.ctxOf(c).getImageData(0, 0, c.width, c.height).data;

  /* 縮放會破壞 16px 格線對齊,平移搜尋補不了,但訊號還在(平滑場是低頻,重新取樣殺不掉)。
     把「還原倍率」也納入搜尋:粗掃一遍,再在最高分附近細掃。只在直接偵測失敗時啟動。 */
  function detectWithScale(src, nodes, N, onProgress) {
    const c = canvasOf(src);
    const direct = P.detect(dataOf(c), c.width, c.height, nodes, N);
    if (direct.found) return { ...direct, scale: 1 };
    const at = (f) => {
      const w = Math.round(c.width * f), h = Math.round(c.height * f);
      if (w < 128 || h < 128 || w > 4200 || h > 4200) return { found: false, z: 0 };
      const t = F.mkCanvas(w, h), x = F.ctxOf(t);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(c, 0, 0, w, h);
      return P.detect(x.getImageData(0, 0, w, h).data, w, h, nodes, N);
    };
    let best = { ...direct, scale: 1 };
    for (let f = 1.1; f <= 2.6; f += 0.1) {
      const r = at(f);
      if (onProgress) onProgress(f, r.z);
      if (r.z > best.z) best = { ...r, scale: f };
    }
    if (best.scale !== 1) {
      for (let f = best.scale - 0.09; f <= best.scale + 0.09; f += 0.02) {
        if (f <= 1) continue;
        const r = at(f);
        if (r.z > best.z) best = { ...r, scale: f };
      }
    }
    return best;
  }

  // ── 摧殘手法:每一種都回傳新的 canvas ──
  const resize = (c, f) => {
    const t = F.mkCanvas(Math.max(1, Math.round(c.width * f)), Math.max(1, Math.round(c.height * f)));
    const x = F.ctxOf(t); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, t.width, t.height); return t;
  };
  const crop = (c, keep) => { // 偏移刻意不對齊格線(37/23),不然等於偷偷幫偵測器對好格子
    const w = Math.round(c.width * keep), h = Math.round(c.height * keep);
    const t = F.mkCanvas(w, h);
    F.ctxOf(t).drawImage(c, 37 % Math.max(1, c.width - w), 23 % Math.max(1, c.height - h), w, h, 0, 0, w, h);
    return t;
  };
  const rotate = (c, deg) => {
    const r = deg * Math.PI / 180, s = Math.abs(Math.sin(r)), co = Math.abs(Math.cos(r));
    const w = Math.round(c.width * co + c.height * s), h = Math.round(c.width * s + c.height * co);
    const t = F.mkCanvas(w, h), x = F.ctxOf(t);
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.translate(w / 2, h / 2); x.rotate(r); x.drawImage(c, -c.width / 2, -c.height / 2);
    return t;
  };
  const jpeg = (c, q) => new Promise((res) => {
    c.toBlob((b) => {
      const im = new Image();
      im.onload = () => { const t = F.mkCanvas(im.width, im.height); F.ctxOf(t).drawImage(im, 0, 0); URL.revokeObjectURL(im.src); res(t); };
      im.src = URL.createObjectURL(b);
    }, 'image/jpeg', q);
  });

  /* 存活矩陣。expect 是「應該活還是應該死」——寫下預期才叫實驗,不然只是把數字印出來。 */
  const ATTACKS = [
    { name: '原圖(對照)', expect: true, run: async (c) => c },
    { name: 'JPEG 品質 90', expect: true, run: (c) => jpeg(c, 0.9) },
    { name: 'JPEG 品質 80', expect: true, run: (c) => jpeg(c, 0.8) },
    { name: 'JPEG 品質 70', expect: true, run: (c) => jpeg(c, 0.7) },
    { name: 'JPEG 品質 50', expect: false, run: (c) => jpeg(c, 0.5) },
    { name: '裁掉一半(保留 50%)', expect: true, run: async (c) => crop(c, 0.5) },
    { name: '裁到剩 30%', expect: true, run: async (c) => crop(c, 0.3) },
    { name: '縮到 50%', expect: true, run: async (c) => resize(c, 0.5) },
    { name: '縮到 25%', expect: true, run: async (c) => resize(c, 0.25) },
    { name: '縮到 15%', expect: false, run: async (c) => resize(c, 0.15) },
    { name: '模擬社群上傳(縮到 1080 寬 + JPEG 80)', expect: true, run: (c) => jpeg(resize(c, Math.min(1, 1080 / c.width)), 0.8) },
    { name: '旋轉 5 度', expect: false, run: async (c) => rotate(c, 5) },
    { name: '旋轉 30 度', expect: false, run: async (c) => rotate(c, 30) },
  ];

  async function survive(src, nodes, N, onStep) {
    const base = canvasOf(src), out = [];
    for (const a of ATTACKS) {
      const c = await a.run(base);
      const r = detectWithScale(c, nodes, N);
      const row = { name: a.name, expect: a.expect, z: r.z, found: r.found, scale: r.scale, size: c.width + '×' + c.height };
      out.push(row);
      if (onStep) onStep(row, out.length, ATTACKS.length);
    }
    return out;
  }

  root.IWL_DETECT = { detectWithScale, survive, ATTACKS, resize, crop, rotate, jpeg, canvasOf, dataOf };
})(window);
