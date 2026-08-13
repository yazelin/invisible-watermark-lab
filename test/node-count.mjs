/* test/node-count.mjs — 為什麼是 16×16 個節點,不是 8×8?
   跑法:node test/node-count.mjs [每組樣本數]      預設 40

   LINE 對話製造機用 8×8 個節點(一塊 128×128 像素),這裡用 16×16(一塊 256×256)。
   直覺會擔心「一塊變大,是不是就需要更大的殘存區域才驗得出來」。量出來不是:

     正向分數兩者完全一樣 —— 偵測器是環狀折疊的,圖上每個 16 像素格子都會被折進
     N×N 格裡的某一格,不管那塊圖樣有多大。決定強度的是圖有多少格子,不是 N。

     偽造分數 16×16 明顯較低 —— 別人亂猜的金鑰要在 256 格上碰巧同號才撞得到,
     8×8 只要碰對 64 格。格子越多,運氣要越好。

   所以 16×16 是「抗偽造變好、而且沒量到代價」。對製造機來說 8×8 夠用,因為它的
   圖樣本來就是公開的,防偽造不在它的目標裡。 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const g = {};
new Function('root', readFileSync(resolve(import.meta.dirname, '..', 'pure.js'), 'utf8')
  .replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;

const SAMPLES = Number(process.argv[2] || 40);
let W = 640, H = 480;

// 四種代表性內容,跟其他測試同一組,固定種子
function makeImage(kind, seed) {
  const d = new Uint8ClampedArray(W * H * 4);
  let s = seed || 1;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    let r, gg, b;
    if (kind === 'flatwhite') { const on = (x > 120 && x < 300 && y > 150 && y < 330); r = gg = b = on ? 60 : 244; }
    else {
      const base = 120 + 80 * Math.sin(x / 90) * Math.cos(y / 70);
      const blk = (((x / 64) | 0) + ((y / 64) | 0)) % 2 ? 26 : -14;
      r = base + blk; gg = base * 0.9 + blk; b = base * 1.05 + blk;
      if (kind === 'detail') { const n2 = (rnd() - 0.5) * 40; r += n2; gg += n2; b += n2; }
    }
    const amp = kind === 'noisy' ? 6 : kind === 'smooth' ? 0 : 2;
    const n = amp ? (rnd() - 0.5) * amp : 0;
    d[p] = r + n; d[p + 1] = gg + n; d[p + 2] = b + n; d[p + 3] = 255;
  }
  return d;
}
// 純裁切(不需要 canvas)。偏移刻意不對齊格線,不然等於偷偷幫偵測器對好格子
function crop(d, keep) {
  const w = Math.round(W * keep), h = Math.round(H * keep);
  const ox = 37 % Math.max(1, W - w), oy = 23 % Math.max(1, H - h);
  const o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y + oy) * W + (x + ox)) * 4, t = (y * w + x) * 4;
    o[t] = d[s]; o[t + 1] = d[s + 1]; o[t + 2] = d[s + 2]; o[t + 3] = d[s + 3];
  }
  return { d: o, w, h };
}

const KINDS = ['smooth', 'noisy', 'detail', 'flatwhite'];
const newKey = (N) => P.nodesFromSecret(P.secretFromBytes(randomBytes(20)), N);
const st = (a) => { const s = [...a].sort((x, y) => x - y); return { med: s[s.length >> 1], max: s[s.length - 1] }; };
const f = (o) => o.med.toFixed(1).padStart(5) + ' /' + o.max.toFixed(1).padStart(6);

const out = {};
for (const [w, h] of [[640, 480], [320, 240]]) {
  W = w; H = h;
  console.log('\n圖片 ' + W + '×' + H + '（可切出 ' + ((W >> 4) * (H >> 4)) + ' 個 16 像素格子）');
  for (const N of [8, 16]) {
    const tp = [], fg = [], c75 = [];
    for (let i = 0; i < SAMPLES; i++) {
      const mine = newKey(N), d = makeImage(KINDS[i % 4], 4000 + i);
      P.embed(d, W, H, mine, N);
      tp.push(P.detect(d, W, H, mine, N).z);
      fg.push(P.detect(d, W, H, newKey(N), N).z);   // 別人的金鑰來撞
      const a = crop(d, 0.75); c75.push(P.detect(a.d, a.w, a.h, mine, N).z);
    }
    out[w + '/' + N] = { tp: st(tp), fg: st(fg), c75: st(c75) };
    console.log('  ' + `${N}×${N} 節點（一塊 ${N * 16}×${N * 16} 像素）`.padEnd(30)
      + '正向 ' + f(st(tp)) + '　偽造 ' + f(st(fg)) + '　裁到 75% ' + f(st(c75))
      + '　每格平均樣本 ' + (((W >> 4) * (H >> 4)) / (N * N)).toFixed(1));
  }
}

let bad = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '  ' + x : '')); if (!c) bad++; };
console.log('');
for (const w of [640, 320]) {
  const a = out[w + '/8'], b = out[w + '/16'];
  ok(w + ' 寬：16×16 比較難偽造', b.fg.max < a.fg.max, a.fg.max.toFixed(1) + ' → ' + b.fg.max.toFixed(1));
  ok(w + ' 寬：正向強度沒有付出代價', Math.abs(b.tp.med - a.tp.med) < 0.5,
    a.tp.med.toFixed(1) + ' vs ' + b.tp.med.toFixed(1));
  ok(w + ' 寬：抗裁切沒有付出代價', b.c75.med > a.c75.med - 0.5,
    a.c75.med.toFixed(1) + ' vs ' + b.c75.med.toFixed(1));
}
console.log(bad ? '\n' + bad + ' 項不符' : '\n16×16 是「抗偽造變好、沒量到代價」。');
process.exit(bad ? 1 : 0);
