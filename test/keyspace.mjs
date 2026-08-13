/* test/keyspace.mjs — 不同的金鑰會不會產生一模一樣的指紋?
   跑法:node test/keyspace.mjs [試幾把]      預設 300000,約十秒

   這是第五次做壞的地方,而且是使用者問出來的:
   「金鑰 20 個字元,指紋 16×16,會不會不夠用、很容易重複?」

   直接看空間大小的話不會:20 個 Crockford base32 字元 = 100 bit(2^100 種),
   指紋是 256 格 ±1(2^256 種),指紋空間大得多,不是被壓縮。
   但中間那個亂數產生器把它掐掉了 —— 舊的 rngFrom 是:

       const s = seedFrom(secret); let a = s(), b = s(), c = s(), d = s();

   四個值看起來有 128 bit,其實全部從 seedFrom 那一個 32 bit 的狀態推出來。
   所以指紋最多 2^32 種,生日問題下大約 65536 把就有五成機率撞到。

   修法:跑四次獨立的雜湊,每次都吃過完整的 secret,起始常數不同 → 2^128 種串流,
   實際受限於 secret 本身的 100 bit。IWL1 保留舊路徑(不然以前蓋的圖會突然驗不出來),
   新金鑰一律發 IWL2。 */
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const g = {};
new Function('root', readFileSync(resolve(import.meta.dirname, '..', 'pure.js'), 'utf8')
  .replace(/\(typeof window[^;]+;/, '(root);'))(g);
const P = g.IWL;

const N = 16, TRIES = Number(process.argv[2] || 300000);
const buf = Buffer.allocUnsafe(20 * 64);

function collisions(prefix) {
  const seen = new Map();
  let dup = 0; const examples = [];
  for (let i = 0; i < TRIES; i++) {
    if (i % 64 === 0) randomBytes(20 * 64).copy(buf);
    const secret = P.secretFromBytes(buf.subarray((i % 64) * 20, (i % 64) * 20 + 20)).replace(/^IWL\d-/, prefix + '-');
    const n = P.nodesFromSecret(secret, N);
    let bits = ''; for (let k = 0; k < n.length; k++) bits += n[k] > 0 ? '1' : '0';
    const h = createHash('sha1').update(bits).digest('base64').slice(0, 16);
    const prev = seen.get(h);
    if (prev && prev !== secret) { dup++; if (examples.length < 2) examples.push([prev, secret]); }
    else seen.set(h, secret);
  }
  return { dup, examples };
}

const expect32 = TRIES * TRIES / (2 * 2 ** 32);
console.log('\n每組試 ' + TRIES.toLocaleString() + ' 把不同的金鑰,看有沒有兩把產生完全相同的指紋\n');
const v1 = collisions('IWL1'), v2 = collisions('IWL2');
console.log('  IWL1（舊路徑，指紋空間被掐成 2^32）　碰撞 ' + v1.dup + ' 組　理論期望 ' + expect32.toFixed(1) + ' 組');
for (const [a, b] of v1.examples) console.log('      ' + a + '  ==  ' + b);
console.log('  IWL2（修好的，指紋空間 2^100）　　　 碰撞 ' + v2.dup + ' 組　理論期望 ≈ 0');

let bad = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '  ' + x : '')); if (!c) bad++; };
console.log('');
ok('IWL2 沒有碰撞', v2.dup === 0, v2.dup + ' 組');
ok('IWL1 的碰撞數量符合 2^32 的預期（證明舊路徑真的被掐住）',
  v1.dup > expect32 * 0.3 && v1.dup < expect32 * 3, v1.dup + ' 組 vs 期望 ' + expect32.toFixed(1));
// 舊金鑰一定要還能用,不然別人以前蓋的圖會突然驗不出來
const s1 = 'IWL1-ABCDE-FGHJK-MNPQR-STVWX';
const a = P.nodesFromSecret(s1, N), b = P.nodesFromSecret(s1, N);
ok('IWL1 舊金鑰仍然可重現', a.every((v, i) => v === b[i]));
const c = P.nodesFromSecret('IWL2-ABCDE-FGHJK-MNPQR-STVWX', N);
let same = 0; for (let i = 0; i < N * N; i++) if (a[i] === c[i]) same++;
ok('同一串字在 IWL1 / IWL2 下是不同的指紋', same < N * N * 0.7, '重疊 ' + (same / (N * N) * 100).toFixed(0) + '%');
console.log(bad ? '\n' + bad + ' 項不符' : '\n指紋空間修好了。');
process.exit(bad ? 1 : 0);
