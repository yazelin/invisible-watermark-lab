/* test/pure.test.mjs — 載入「真的」pure.js(頁面也用同一份),不是鏡像複本。
   跑法:node test/pure.test.mjs

   偵測類功能只量「抓得到」是不夠的,不然做出來的不是偵測器,是一個永遠說是的按鈕。
   所以正向只有一條,負控制有三條:乾淨圖、別人的 logo、純色 logo。 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'pure.js'), 'utf8');
const g = {};
new Function('root', src.replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

// ── 測試素材:確定性的「像照片」的圖(平滑漸層 + 幾塊色塊 + 一點雜訊),不是純色 ──
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
// 由 seed 決定的假 logo(當成灰階取樣來源)
const logoNodes = (N, seed) => {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const g2 = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) g2.push(rnd() * 255);
  return P.nodesFromGray((i, j) => g2[j * N + i], N);
};

console.log('nodesFromGray');
ok('減平均之後總和為零(不減會讓整張圖偏藍)', () => {
  const n = logoNodes(16, 7);
  const sum = n.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9, '總和 ' + sum);
});
ok('正規化之後峰值剛好 1(不同 logo 訊號強度一致)', () => {
  const n = logoNodes(16, 7);
  assert.ok(Math.abs(Math.max(...[...n].map(Math.abs)) - 1) < 1e-9);
});
ok('純色 logo → 強度 0(要擋下來,不是讓它蓋一個空的場)', () => {
  const n = P.nodesFromGray(() => 128, 16);
  assert.equal(P.nodeStrength(n), 0);
});

console.log('template');
ok('高通後的模板平均為零(直流被吃掉,跟偵測端一致)', () => {
  const { Ehp } = P.template(logoNodes(16, 3), 16);
  const sum = Ehp.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9, '總和 ' + sum);
});

console.log('embed');
ok('只動藍通道,紅綠與 alpha 一個位元都沒變', () => {
  const W = 160, H = 160, a = makeImage(W, H), b = a.slice();
  P.embed(b, W, H, logoNodes(16, 5), 16);
  let blueChanged = 0;
  for (let i = 0; i < a.length; i += 4) {
    assert.equal(a[i], b[i], '紅通道被動到 @' + i);
    assert.equal(a[i + 1], b[i + 1], '綠通道被動到 @' + i);
    assert.equal(a[i + 3], b[i + 3], 'alpha 被動到 @' + i);
    if (a[i + 2] !== b[i + 2]) blueChanged++;
  }
  assert.ok(blueChanged > 0, '藍通道完全沒變,場沒蓋上去');
});
ok('單一像素的改變量不超過 ±2(這是「看不見」的來源)', () => {
  const W = 160, H = 160, a = makeImage(W, H), b = a.slice();
  P.embed(b, W, H, logoNodes(16, 5), 16);
  let mx = 0;
  for (let i = 2; i < a.length; i += 4) mx = Math.max(mx, Math.abs(a[i] - b[i]));
  assert.ok(mx <= P.AMP, '最大改變量 ' + mx);
});
ok('半透明像素跳過(premultiply 會失真,驗證端算不回來)', () => {
  const W = 160, H = 160, a = makeImage(W, H);
  for (let i = 0; i < 400; i++) a[i * 4 + 3] = 120;
  const b = a.slice();
  P.embed(b, W, H, logoNodes(16, 5), 16);
  for (let i = 0; i < 400; i++) assert.equal(a[i * 4 + 2], b[i * 4 + 2], '半透明像素被動到 @' + i);
});

console.log('detect — 正向');
const N = 16, W = 640, H = 480;
const mine = logoNodes(N, 11);
ok('蓋了自己的 logo,用自己的 logo 驗 → 檢出', () => {
  const d = makeImage(W, H);
  P.embed(d, W, H, mine, N);
  const r = P.detect(d, W, H, mine, N);
  console.log('      z =', r.z.toFixed(1));
  assert.ok(r.found, 'z=' + r.z);
});

console.log('detect — 負控制(這三條才是重點)');
ok('乾淨的圖 → 未檢出', () => {
  const d = makeImage(W, H, 99);
  const r = P.detect(d, W, H, mine, N);
  console.log('      z =', r.z.toFixed(1));
  assert.ok(!r.found, '乾淨圖被判成檢出,z=' + r.z);
});
ok('蓋了 A 的 logo,拿 B 的 logo 去驗 → 未檢出(不能互相冒認)', () => {
  const d = makeImage(W, H);
  P.embed(d, W, H, mine, N);
  const other = logoNodes(N, 22);
  const r = P.detect(d, W, H, other, N);
  console.log('      z =', r.z.toFixed(1));
  assert.ok(!r.found, '別人的 logo 也驗得出來,z=' + r.z);
});
ok('八組不相干的 logo 都驗不出來(誤判率不是只看一次)', () => {
  const d = makeImage(W, H);
  P.embed(d, W, H, mine, N);
  let worst = 0;
  for (let s = 100; s < 108; s++) worst = Math.max(worst, P.detect(d, W, H, logoNodes(N, s), N).z);
  console.log('      八組裡最高 z =', worst.toFixed(1));
  assert.ok(worst < P.thresholdFor(N), '有一組誤判,最高 z=' + worst);
});

console.log('\n' + pass + '/' + pass + ' 通過');
