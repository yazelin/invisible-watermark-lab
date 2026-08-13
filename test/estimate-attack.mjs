/* test/estimate-attack.mjs — 攻擊者只拿到一張蓋好的圖,能不能把場紋估出來?
   跑法:node test/estimate-attack.mjs [每組幾輪]      預設 8

   使用者問過:「人家拿到我的作品,能不能用作品本身推算回我的場紋長什麼樣?」
   原本頁面寫的是「蒐集夠多張取平均才可能」(平均攻擊)。量完發現講輕了:**一張就夠**。

   為什麼:場紋是平鋪的,週期 16 個節點。攻擊者知道演算法(開源),
   所以他可以做跟偵測器一模一樣的事 —— 高通、把每個 16px 格子按
   (行 mod 16, 列 mod 16) 折疊累加、取正負號。畫面內容被高通殺掉大半、
   又被折疊平均掉;場紋每一塊都同號,累加起來就浮出來。

   實測結果(見下面輸出):
     估中約 70% 的節點
     拿估出來的圖樣去驗「另一張」同金鑰的圖 —— 檢出。等於他手上有一把能用的金鑰
     拿它把浮水印減掉 —— 只減掉一半左右,原主人仍然驗得出來

   這是平鋪式浮水印的結構性弱點,不是這份實作的疏忽;文獻上早就記載
   自同步(平鋪)浮水印容易被自相關估計攻擊。頁面的「誠實的界限」照這個結果改寫過。 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const g = {};
new Function('root', readFileSync(resolve(import.meta.dirname, '..', 'pure.js'), 'utf8')
  .replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;
const N = 16, ROUNDS = Number(process.argv[2] || 8);

function makeImage(kind, seed, W, H) {
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

/* 攻擊本身:跟偵測器同一套動作,只是不需要金鑰。
   高通 → 環狀折疊累加 → 取正負號。 */
function estimate(d, W, H) {
  const bw = W >> 4, bh = H >> 4;
  const m = new Float64Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    let s = 0;
    for (let y = j * 16; y < j * 16 + 16; y++) for (let x = i * 16; x < i * 16 + 16; x++) {
      const p = (y * W + x) * 4; s += d[p + 2] - (d[p] + d[p + 1]) / 2;
    }
    m[j * bw + i] = s / 256;
  }
  const hp = new Float64Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    let s = 0, c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + dx, b = j + dy;
      if (a < 0 || b < 0 || a >= bw || b >= bh) continue;
      s += m[b * bw + a]; c++;
    }
    hp[j * bw + i] = m[j * bw + i] - (c ? s / c : 0);
  }
  const acc = new Float64Array(N * N);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) acc[(j % N) * N + (i % N)] += hp[j * bw + i];
  const out = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) out[k] = acc[k] > 0 ? 1 : -1;
  return out;
}

const KINDS = ['smooth', 'noisy', 'detail', 'flatwhite'];
console.log('\n攻擊者只有「一張」蓋好的圖、沒有金鑰。他照開源演算法把圖樣估出來,然後：\n');
const summary = [];
for (const [W, H] of [[1600, 1200], [900, 620]]) {
  for (const kind of KINDS) {
    let rate = 0, zB = 0, pB = 0, foundB = 0, zBefore = 0, zStrip = 0, foundStrip = 0;
    for (let t = 0; t < ROUNDS; t++) {
      const nodes = P.nodesFromSecret(P.secretFromBytes(randomBytes(20)), N);
      const A = makeImage(kind, t * 13 + 1, W, H); P.embed(A, W, H, nodes, N);
      const B = makeImage(kind, t * 13 + 500, W, H); P.embed(B, W, H, nodes, N); // 同金鑰、不同內容
      const est = estimate(A, W, H);
      let best = 0; // 相位可能整體平移或整體反號,取最好的對齊
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        let hit = 0;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
          if (est[((j + sy) % N) * N + ((i + sx) % N)] === P.nodeAt(nodes, N, i, j)) hit++;
        best = Math.max(best, hit, N * N - hit);
      }
      rate += best / (N * N);
      const rB = P.detect(B, W, H, est, N); zB += rB.z; pB += rB.psr; if (rB.found) foundB++;
      zBefore += P.detect(A, W, H, nodes, N).z;
      const A2 = Uint8ClampedArray.from(A);
      P.unembed(A2, W, H, est, N);
      const rS = P.detect(A2, W, H, nodes, N); zStrip += rS.z; if (rS.found) foundStrip++;
    }
    const row = { W, H, kind, rate: rate / ROUNDS, zB: zB / ROUNDS, pB: pB / ROUNDS, foundB,
      zBefore: zBefore / ROUNDS, zStrip: zStrip / ROUNDS, foundStrip };
    summary.push(row);
    console.log('  ' + (W + '×' + H).padEnd(11) + kind.padEnd(11)
      + '估中 ' + (row.rate * 100).toFixed(0).padStart(3) + '%'
      + '　驗另一張同金鑰的圖 z=' + row.zB.toFixed(1).padStart(5) + ' 比=' + row.pB.toFixed(1).padStart(4)
      + ' ' + foundB + '/' + ROUNDS + ' 檢出'
      + '　　抹除後原主人再驗 z=' + row.zBefore.toFixed(0).padStart(3) + '→' + row.zStrip.toFixed(1).padStart(5)
      + ' ' + foundStrip + '/' + ROUNDS + ' 仍檢出');
  }
}

let bad = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '  ' + x : '')); if (!c) bad++; };
console.log('');
const worstRate = Math.min(...summary.map((r) => r.rate));
const allForge = summary.every((r) => r.foundB >= ROUNDS * 0.75);
const stripped = summary.every((r) => r.foundStrip >= ROUNDS * 0.5);
ok('單張圖就估得出圖樣（遠高於瞎猜的 50%）', worstRate > 0.6, '最差 ' + (worstRate * 100).toFixed(0) + '%');
ok('估出來的圖樣驗得出「另一張」同金鑰的圖 —— 等於他有一把能用的金鑰', allForge);
ok('但抹不乾淨:減掉之後原主人仍然驗得出來', stripped);
console.log(bad ? '\n' + bad + ' 項不符' : '\n這是平鋪式浮水印的結構性弱點,頁面的「誠實的界限」已照這個結果寫。');
process.exit(bad ? 1 : 0);
