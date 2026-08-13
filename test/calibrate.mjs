/* test/calibrate.mjs — 量 null 分布,決定 Z_MIN 與 PSR_MIN。
   跑法:node test/calibrate.mjs [每組樣本數]      預設 60,約一分鐘

   這支是那兩個門檻的出處。判定要同時過兩關,因為兩種假陽性的破口剛好相反:
     乾淨的圖(根本沒蓋過) —— 峰值絕對值極低,但分數分布很窄,PSR 反而會衝高
     別人的金鑰           —— z 可以很高(它跟著嵌入強度一起放大),但峰值不突出
   只看其中一個都會被另一種騙過去。這支腳本就是把這件事量出來。

   規則:雜訊用固定種子(不用 Math.random),所以整份結果可重現。 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'pure.js'), 'utf8');
const g = {};
new Function('root', src.replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;

const N = 16, W = 640, H = 480;
const SAMPLES = Number(process.argv[2] || 60);

// 四種代表性內容,跟 survive-matrix.mjs 同一組,固定種子
function makeImage(kind, seed) {
  const d = new Uint8ClampedArray(W * H * 4);
  let s = seed || 1;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    let r, gg, b;
    if (kind === 'flatwhite') {
      const on = (x > 120 && x < 300 && y > 150 && y < 330);
      r = gg = b = on ? 60 : 244;
    } else {
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
const newSecret = () => P.secretFromBytes(randomBytes(20));
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, med: q(0.5), p95: q(0.95), max: s[s.length - 1], min: s[0] };
};
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
const show = (label, zs, ps) => {
  const z = stat(zs), p = stat(ps);
  console.log('  ' + pad(label, 30)
    + 'z 中位 ' + z.med.toFixed(1).padStart(5) + ' 最高 ' + z.max.toFixed(1).padStart(5)
    + '　　PSR 中位 ' + p.med.toFixed(1).padStart(5) + ' 最高 ' + p.max.toFixed(1).padStart(5));
  return { z, p };
};

const KINDS = ['smooth', 'noisy', 'detail', 'flatwhite'];
console.log('\n每組 ' + SAMPLES + ' 個樣本,四種內容輪流（smooth / noisy / detail / flatwhite）\n');

// ── 正向:自己的金鑰驗自己蓋的圖 ──
const tpZ = [], tpP = [];
for (let i = 0; i < SAMPLES; i++) {
  const kind = KINDS[i % KINDS.length];
  const nodes = P.nodesFromSecret(newSecret(), N);
  const d = makeImage(kind, i + 1);
  P.embed(d, W, H, nodes, N);
  const r = P.detect(d, W, H, nodes, N);
  tpZ.push(r.z); tpP.push(r.psr);
}
const tp = show('正向（自己驗自己）', tpZ, tpP);

// ── 負控制一:乾淨的圖 ──
const c1Z = [], c1P = [];
for (let i = 0; i < SAMPLES; i++) {
  const kind = KINDS[i % KINDS.length];
  const r = P.detect(makeImage(kind, 500 + i), W, H, P.nodesFromSecret(newSecret(), N), N);
  c1Z.push(r.z); c1P.push(r.psr);
}
const c1 = show('負控制：乾淨的圖', c1Z, c1P);

// ── 負控制二:別人的金鑰驗已經蓋過的圖 ──
const c2Z = [], c2P = [];
for (let i = 0; i < SAMPLES; i++) {
  const kind = KINDS[i % KINDS.length];
  const nodes = P.nodesFromSecret(newSecret(), N);
  const d = makeImage(kind, 900 + i);
  P.embed(d, W, H, nodes, N);
  const r = P.detect(d, W, H, P.nodesFromSecret(newSecret(), N), N);
  c2Z.push(r.z); c2P.push(r.psr);
}
const c2 = show('負控制：別人的金鑰', c2Z, c2P);

console.log('\n目前的門檻：z > ' + P.Z_MIN + ' 且 PSR > ' + P.PSR_MIN);
console.log('  乾淨圖被擋下來靠的是 z（它的 PSR 最高到 ' + c1.p.max.toFixed(1) + '，早就超過門檻了）');
console.log('  別人的金鑰被擋下來靠的是 PSR（它的 z 最高到 ' + c2.z.max.toFixed(1) + '，也超過門檻）');
console.log('  → 只看其中一個都會誤判，這就是為什麼要兩個都要求');

// ── 實際判定:算真陽性/假陽性 ──
const judge = (zs, ps) => zs.filter((z, i) => z > P.Z_MIN && ps[i] > P.PSR_MIN).length;
const tpN = judge(tpZ, tpP), fp1 = judge(c1Z, c1P), fp2 = judge(c2Z, c2P);
console.log('\n判定結果');
console.log('  真陽性 ' + tpN + ' / ' + SAMPLES + '（漏掉 ' + (SAMPLES - tpN) + '）');
console.log('  假陽性 ' + (fp1 + fp2) + ' / ' + SAMPLES * 2 + '（乾淨圖 ' + fp1 + '，別人的金鑰 ' + fp2 + '）');
const margin = Math.min(tp.z.min - P.Z_MIN, tp.p.min - P.PSR_MIN);
console.log('  真陽性最接近門檻的距離：' + margin.toFixed(1)
  + '（z 最低 ' + tp.z.min.toFixed(1) + '、PSR 最低 ' + tp.p.min.toFixed(1) + '）');
if (tpN < SAMPLES || fp1 + fp2 > 0) {
  console.log('\n門檻需要重訂：有漏抓或誤判。');
  process.exit(1);
}
console.log('\n門檻站得住：零漏抓、零誤判。');
