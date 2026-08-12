/* field.js — 瀏覽器端:金鑰圖 → 指紋 → 平滑場 → 蓋到作品上。
   每一步都回傳「畫得出來」的中間產物,因為這頁的使命是讓人看懂,不是把答案算出來就好。
   純邏輯在 pure.js(node 可直接測),這裡只做 canvas 與視覺化。 */
(function (root) {
  'use strict';
  const P = root.IWL;

  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });

  /* 金鑰圖 → N×N 節點。
     刻意用「面積平均」而不是 drawImage 縮放:縮圖演算法各家不同,
     但這一步要能在腦子裡重現(把圖切成 N×N 塊,每塊算平均亮度),教學才講得清楚。 */
  function nodesFromImage(img, N) {
    const S = N * 8; // 先統一縮到 N*8,再每 8×8 取平均 —— 兩段式,避免超大圖逐像素掃
    const c = mkCanvas(S, S), x = ctxOf(c);
    x.drawImage(img, 0, 0, S, S);
    const d = x.getImageData(0, 0, S, S).data;
    const gray = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
        const p = ((j * 8 + dy) * S + i * 8 + dx) * 4;
        s += 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; // 亮度:人眼對綠最敏感,係數照 Rec.601
      }
      gray[j * N + i] = s / 64;
    }
    const raw = P.nodesFromGray((i, j) => gray[j * N + i], N);
    const nodes = P.whiten(raw, N); // 白化:訊號要長在偵測端的高通看得見的頻段
    return { nodes, raw, gray, strength: P.nodeStrength(nodes) };
  }

  /* 指紋:N×N 一格一色。正=藍、負=黃(互補色,一眼分得出正負),亮度=絕對值。
     這張圖就是「你的 logo 被壓成低解析度指紋」的視覺證據。 */
  function drawFingerprint(canvas, nodes, N, cell) {
    cell = cell || Math.max(4, Math.floor(canvas.width / N));
    canvas.width = canvas.height = N * cell;
    const x = ctxOf(canvas);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = nodes[j * N + i];
      x.fillStyle = v >= 0 ? `rgb(${Math.round(255 - v * 210)},${Math.round(255 - v * 150)},255)`
                           : `rgb(255,${Math.round(255 + v * 60)},${Math.round(255 + v * 235)})`;
      x.fillRect(i * cell, j * cell, cell, cell);
    }
  }

  /* 平滑場:把節點用 smoothstep 內插成連續場,放大顯示。
     並排看「指紋(硬格)」與「平滑場」就懂為什麼要內插——硬邊在平坦底色會 banding。 */
  function drawField(canvas, nodes, N, tiles) {
    tiles = tiles || 1;
    const px = N * P.NODE_PX * tiles;
    canvas.width = canvas.height = px;
    const x = ctxOf(canvas);
    const im = x.createImageData(px, px), d = im.data;
    const ss = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < px; y++) {
      const gy = y >> 4, fy = ss(((y & 15) + 0.5) / 16);
      for (let xx = 0; xx < px; xx++) {
        const gx = xx >> 4, fx = ss(((xx & 15) + 0.5) / 16);
        const a = P.nodeAt(nodes, N, gx, gy), b = P.nodeAt(nodes, N, gx + 1, gy);
        const cc = P.nodeAt(nodes, N, gx, gy + 1), dd = P.nodeAt(nodes, N, gx + 1, gy + 1);
        const s = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + dd * fx) * fy;
        const p = (y * px + xx) * 4;
        d[p] = 128 - s * 105; d[p + 1] = 128 - s * 75; d[p + 2] = 128 + s * 127; d[p + 3] = 255;
      }
    }
    x.putImageData(im, 0, 0);
  }

  /* 蓋章:回傳蓋好的 canvas,外加一張「差異放大」圖。
     差異圖是這頁最有說服力的一張:並排看不出差別,放大 20 倍就看到你的 logo 鋪滿整張圖。 */
  function stamp(img, nodes, N, ampScale) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const before = mkCanvas(W, H); ctxOf(before).drawImage(img, 0, 0);
    const im = ctxOf(before).getImageData(0, 0, W, H);
    const orig = new Uint8ClampedArray(im.data);
    P.embed(im.data, W, H, nodes, N);
    const after = mkCanvas(W, H); ctxOf(after).putImageData(im, 0, 0);

    const diff = mkCanvas(W, H);
    const dim = ctxOf(diff).createImageData(W, H), dd = dim.data;
    const g = ampScale || 20;
    for (let i = 0; i < orig.length; i += 4) {
      const delta = im.data[i + 2] - orig[i + 2]; // 只有藍通道會動
      const v = 128 + delta * g;
      dd[i] = dd[i + 1] = dd[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      dd[i + 3] = 255;
    }
    ctxOf(diff).putImageData(dim, 0, 0);
    return { before, after, diff, W, H };
  }

  root.IWL_FIELD = { mkCanvas, ctxOf, nodesFromImage, drawFingerprint, drawField, stamp };
})(window);
