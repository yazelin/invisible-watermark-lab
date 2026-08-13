/* test/cross-lcm.mjs — 跟「LINE 對話製造機」的交叉測試。
   跑法:node test/cross-lcm.mjs          需要本機有 line-chat-maker(用 LCM 環境變數指定路徑)

   這支是頁面上那張對照表的出處。要回答的問題:
     製造機那套偵測器(固定圖樣、8×8 節點、只看 z、門檻 7)真的不會誤判嗎?

   一開始的推論是「它沒有金鑰,所以沒有『別人的金鑰來撞』這種攻擊,不會誤判」。
   量完發現不對:這一頁用隨機金鑰蓋出來的圖,大約三分之一會被它判成「製造機做的」。
   兩張隨機的 ±1 圖樣總會有一部分格子同號,位移搜尋又會挑出最巧的那一種對齊方式。

   所以正確的說法是「沒人去撞它」,不是「不可能誤判」。
   峰值旁瓣比(peak-to-sidelobe ratio)擋得住:製造機自己蓋的 ~7.1,這一頁蓋的最高 ~4.4。
   數字每次跑會小幅浮動(每輪都用新的隨機金鑰),結論穩定。 */
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const LCM = process.env.LCM || join(homedir(), 'line-chat-maker');
if (!existsSync(join(LCM, 'verify.html'))) {
  console.log('找不到 line-chat-maker(' + LCM + '),跳過。用 LCM=<路徑> 指定。');
  process.exit(0);
}

// 從對方的原始碼裡把偵測器與嵌入器挖出來,不複製一份 —— 複製的那份會跟著人家改動失真
const cut = (file, from, to) => { const t = readFileSync(join(LCM, file), 'utf8'); return t.slice(t.indexOf(from), t.indexOf(to)); };
const lcm = {};
new Function('exports',
  cut('verify.html', 'function blockSign', 'async function check(file)')
  + cut('app.js', 'function brandField', 'function brandPixels(canvas)')
  + 'exports.detectPattern=detectPattern;exports.brandField=brandField;')(lcm);

const g = {};
new Function('root', readFileSync(resolve(import.meta.dirname, '..', 'pure.js'), 'utf8')
  .replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;

const W = 640, H = 480, N = 16, SAMPLES = Number(process.argv[2] || 60);
// 四種代表性內容,跟 calibrate.mjs / survive-matrix.mjs 同一組,固定種子
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
/* 對方的 detectPattern 只回傳 z。峰值旁瓣比得自己從候選分數算,
   但候選分數沒有匯出 —— 所以這裡用同一份定義:(最高分 − 其餘平均) ÷ 其餘的標準差,
   在對方的 stats 上算。做法是把 detectPattern 的最後兩行換掉。 */
const src = cut('verify.html', 'function detectPattern', 'function detectWithScale')
  .replace('return { found: z > 7, z };', `
    const srt = [...stats].sort((a, b) => a - b);
    const keep = srt.slice(0, Math.max(2, Math.floor(srt.length * 0.98)));
    const mu = keep.reduce((a, b) => a + b, 0) / keep.length;
    const sd = Math.sqrt(keep.reduce((a, b) => a + (b - mu) * (b - mu), 0) / keep.length) || 1e-9;
    return { found: z > 7, z, psr: (z - mu) / sd };`);
const withPsr = {};
new Function('exports', cut('verify.html', 'function blockSign', 'function findITXt') + src + 'exports.d=detectPattern;')(withPsr);

const KINDS = ['smooth', 'noisy', 'detail', 'flatwhite'];
const stat = (a) => { const s = [...a].sort((x, y) => x - y);
  return { min: s[0], med: s[s.length >> 1], max: s[s.length - 1] }; };
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

console.log('\n用 LINE 對話製造機的偵測器驗（固定圖樣、8×8 節點、只看 z、門檻 7）,每組 ' + SAMPLES + ' 張\n');
const rows = {};
const run = (label, prep) => {
  const zs = [], ps = [];
  for (let i = 0; i < SAMPLES; i++) {
    const d = makeImage(KINDS[i % 4], 7000 + i);
    prep(d, i);
    const r = withPsr.d(d, W, H);
    zs.push(r.z); ps.push(r.psr);
  }
  const z = stat(zs), p = stat(ps);
  const over = zs.filter((v) => v > 7).length;
  console.log('  ' + pad(label, 26) + 'z 中位 ' + z.med.toFixed(1).padStart(5) + ' 最高 ' + z.max.toFixed(1).padStart(5)
    + '　峰值旁瓣比 最低 ' + p.min.toFixed(1).padStart(5) + ' 中位 ' + p.med.toFixed(1).padStart(5)
    + '　z>7 的 ' + over + '/' + SAMPLES);
  rows[label] = { z, p, over };
};
run('乾淨的圖（負控制）', () => {});
run('製造機自己蓋的（正控制）', (d) => lcm.brandField({ data: d }, W, H));
run('這一頁用隨機金鑰蓋的', (d) => P.embed(d, W, H, P.nodesFromSecret(P.secretFromBytes(randomBytes(20)), N), N));

let bad = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '  ' + x : '')); if (!c) bad++; };
console.log('');
ok('乾淨的圖不會被誤判', rows['乾淨的圖（負控制）'].over === 0, 'z 最高 ' + rows['乾淨的圖（負控制）'].z.max.toFixed(1));
ok('製造機自己蓋的一定驗得出來', rows['製造機自己蓋的（正控制）'].over === SAMPLES);
ok('這一頁蓋的會撞中它（頁面上寫的就是這件事）', rows['這一頁用隨機金鑰蓋的'].over > 0,
  rows['這一頁用隨機金鑰蓋的'].over + '/' + SAMPLES + ' 超過門檻');
ok('峰值旁瓣比分得開（正控制的最低 > 撞的最高）',
  rows['製造機自己蓋的（正控制）'].p.min > rows['這一頁用隨機金鑰蓋的'].p.max,
  rows['製造機自己蓋的（正控制）'].p.min.toFixed(1) + ' vs ' + rows['這一頁用隨機金鑰蓋的'].p.max.toFixed(1));
console.log(bad ? '\n' + bad + ' 項不符' : '\n結論成立。');
process.exit(bad ? 1 : 0);
