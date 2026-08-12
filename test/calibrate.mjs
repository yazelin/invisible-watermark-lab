/* test/calibrate.mjs — 量 null 分布,決定門檻。不是常態測試,是把數字釘下來的工具。
   跑法:node test/calibrate.mjs [樣本數]

   為什麼要重量:line-chat-maker 的門檻 7 是在 8x8 節點(16384 個候選)、而且圖樣固定 ±1 的條件下訂的。
   這裡節點變 16x16 → 候選 65536 個,取極值的期望本來就會往上跑;而且兩個隨機的零均值場之間
   還有殘餘相關。門檻沿用會誤判——第一次跑負控制就抓到 z=8.0 的假陽性。 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'pure.js'), 'utf8');
const g = {};
new Function('root', src.replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;

function makeImage(W, H, seed = 1) {
  const d = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    const g1 = 120 + 80 * Math.sin(x / 90) * Math.cos(y / 70);
    const blk = (((x / 64) | 0) + ((y / 64) | 0)) % 2 ? 26 : -14;
    const n = (rnd() - 0.5) * 5;
    d[p] = g1 + blk + n; d[p + 1] = g1 * 0.9 + blk + n; d[p + 2] = g1 * 1.05 + blk + n; d[p + 3] = 255;
  }
  return d;
}
const logoNodes = (N, seed) => {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const v = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) v.push(rnd() * 255);
  return P.nodesFromGray((i, j) => v[j * N + i], N);
};
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, max: s[s.length - 1], p99: q(0.99), p95: q(0.95), med: q(0.5) };
};
const show = (label, a) => { const t = stat(a); console.log('  ' + label.padEnd(34), 'n=' + String(t.n).padStart(3), 'med', t.med.toFixed(1).padStart(5), 'p95', t.p95.toFixed(1).padStart(5), 'p99', t.p99.toFixed(1).padStart(5), '最大', t.max.toFixed(1).padStart(5)); };

const SAMPLES = Number(process.argv[2] || 60);
const W = 640, H = 480;

for (const N of [8, 16]) {
  console.log('\n=== N = ' + N + '(節點 ' + N + 'x' + N + ',磁磚 ' + N * 16 + 'px,候選 ' + (256 * N * N).toLocaleString() + ' 個)===');
  const mine = logoNodes(N, 11);

  const tp = [];
  for (let s = 0; s < 12; s++) { const d = makeImage(W, H, s + 1); P.embed(d, W, H, mine, N); tp.push(P.detect(d, W, H, mine, N).z); }
  show('正向:自己的 logo 驗自己', tp);

  const fpClean = [];
  for (let s = 0; s < SAMPLES; s++) fpClean.push(P.detect(makeImage(W, H, 500 + s), W, H, logoNodes(N, 1000 + s), N).z);
  show('負控制:乾淨圖', fpClean);

  const dEmb = makeImage(W, H); P.embed(dEmb, W, H, mine, N);
  const fpOther = [];
  for (let s = 0; s < SAMPLES; s++) fpOther.push(P.detect(dEmb, W, H, logoNodes(N, 2000 + s), N).z);
  show('負控制:蓋了 A,拿別人的 logo 驗', fpOther);

  const worstFP = Math.max(...fpClean, ...fpOther);
  const minTP = Math.min(...tp);
  console.log('  → 假陽性最高 ' + worstFP.toFixed(1) + ',真陽性最低 ' + minTP.toFixed(1) +
    ';中間點 ' + ((worstFP + minTP) / 2).toFixed(1) + ',建議門檻 ' + Math.ceil(worstFP * 1.5));
}
