/* pure.js — 隱形浮水印的純邏輯:沒有 DOM、沒有 canvas,只吃 typed array。
   瀏覽器掛在 window.IWL,node 測試用 new Function 注入同一份原始碼(見 test/pure.test.mjs)。

   跟 line-chat-maker 的 brandField/detectPattern 同一套演算法,只換掉一件事:
   節點值從「座標雜湊算出的 ±1」改成「使用者 logo 縮出來的連續值」。
   其餘(16px 節點、smoothstep 內插、只動藍通道、近白近黑減半、4x4 有序抖動、
   高通減四鄰、3σ 截尾、匹配濾波取極值)全部不動——那些是實測換來的,不要憑感覺改。 */
(function (root) {
  'use strict';

  const NODE_PX = 16;   // 每 16 像素一個節點。改這個等於改整套幾何,驗證端也要同步
  const AMP = 2;        // 藍通道 ±2/255。實測 ±3 以上肉眼會在平坦底色看到雲狀斑,而且 z 反而更低

  /* 門檻由實測定,不是憑感覺(test/calibrate.mjs 可重跑)。各 60 組不相干 logo:
       N     正向   乾淨圖    蓋了A拿別人logo驗
       8     31.6   ≤1.3     中位 12.2 / 最高 18.1
       16    31.6   ≤1.5     中位 8.0  / 最高 10.2
     真正的假陽性來源不是乾淨圖(那個接近 0),是「別人的 logo 撞到你的場」——
     搜尋會在 65536 個候選裡挑出最像的那個位移,兩個隨機零均值場總有一個對得比較準。
     line-chat-maker 的門檻 7 是 8x8、固定 ±1 圖樣時代量的,直接沿用會誤判。 */
  /* 判定要同時過兩關,因為兩種假陽性的破口不一樣(實測見 test/calibrate.mjs):
       乾淨圖          —— 峰值絕對值極低(z ≤ 1.4),但因為分布很窄,PSR 可以衝到 10.7
       別人的金鑰      —— z 可以到 13.6(它會跟著嵌入強度放大),但峰值不突出(PSR ≤ 4.8)
     只看其中一個都會被另一種騙過去,兩個都要求就都擋掉了。 */
  const Z_MIN = 6;     // 絕對強度:擋乾淨圖
  const PSR_MIN = 6.5; // 峰值突出度:擋別人的金鑰
  const thresholdFor = () => PSR_MIN;

  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const ss = (t) => t * t * (3 - 2 * t); // smoothstep:消掉硬邊,否則平坦底色會 banding

  /* 灰階取樣 → 節點場。
     grayAt(i, j) 回傳 0..255,呼叫端負責從 logo 縮圖取值。
     兩件事一定要做:
       減平均 —— 場的總和不為零會讓整張圖偏藍(可見),而且高通端本來就會把直流吃掉
       正規化 —— 讓最大振幅剛好對上 AMP,不同 logo 的訊號強度才一致 */
  function nodesFromGray(grayAt, N) {
    const n = new Float64Array(N * N);
    let sum = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = grayAt(i, j); n[j * N + i] = v; sum += v; }
    const mean = sum / (N * N);
    let peak = 0;
    for (let k = 0; k < n.length; k++) { n[k] -= mean; const a = Math.abs(n[k]); if (a > peak) peak = a; }
    if (peak < 1e-9) return n; // 全平的 logo(純色塊):訊號為零,呼叫端要擋下來
    for (let k = 0; k < n.length; k++) n[k] /= peak;
    return n;
  }

  /* 白化:把指紋過一次跟偵測端一樣的高通(減四鄰),再重新正規化。
     為什麼一定要做:偵測端第一步就是高通,而自然圖片是低頻的 —— 相鄰節點高度相關,
     高通會把 logo 指紋殺掉大半,等於訊號長在偵測器看不見的頻段。
     實測(demo 圖):不白化原圖 z=17.3、JPEG90 就掉到 7.7;白化後見 README 的表。
     ±1 偽隨機圖樣天生就是白的(相鄰獨立),這也是原始論文用偽隨機載波的原因之一。 */
  function whiten(nodes, N) {
    const out = new Float64Array(N * N);
    const at = (i, j) => nodes[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      out[j * N + i] = at(i, j) - (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1)) / 4;
    }
    /* 正規化到 RMS≈1 再夾在 ±1,不是用峰值正規化。
       峰值正規化會讓多數節點遠低於滿振幅,平均下來訊號只有一半,z 直接砍半
       (實測:峰值正規化原圖 z=17.2、JPEG90 掉到 11.1;RMS 正規化見 README 的表)。
       安全性有現成證據:line-chat-maker 那個 ±1 圖樣就是「每格都用滿」的極端,
       RMS 正好是 1,而那個版本的隱形性是四次做壞之後驗過的 —— 所以對齊到 RMS=1
       不會比已知安全的基準更明顯。夾住是為了不超過 ±2 的硬上限。 */
    let s2 = 0;
    for (let k = 0; k < out.length; k++) s2 += out[k] * out[k];
    const rms = Math.sqrt(s2 / out.length);
    if (rms < 1e-9) return out;
    for (let k = 0; k < out.length; k++) {
      const v = out[k] / rms;
      out[k] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return out;
  }

  /* 場的有效強度:RMS。純色 logo 會是 0,細節太滿的 logo 縮完也可能偏低。
     低於 0.15 實測就開始不穩(訊號攤太平),頁面要據此擋人。 */
  function nodeStrength(nodes) {
    let s2 = 0;
    for (let k = 0; k < nodes.length; k++) s2 += nodes[k] * nodes[k];
    return Math.sqrt(s2 / nodes.length);
  }

  const nodeAt = (nodes, N, i, j) => nodes[(((j % N) + N) % N) * N + (((i % N) + N) % N)];

  /* ── v2:金鑰是一段 secret,不是 logo ──────────────────────────────
     v1 讓使用者上傳 logo 當金鑰,兩個問題都是定義上的、補不掉的:
       偽造 —— logo 通常是公開的,公開的東西不能當金鑰
       強度 —— 自然圖片是低頻的,偵測端第一步就高通,能量被殺掉大半
     v2 改成 secret → 雜湊 → 偽隨機 ±1 圖樣。偽隨機圖樣相鄰獨立(天生是白的)、
     每格滿振幅(RMS 正好 1),兩個問題一起消失。logo 降級成鑰圖上的標籤。
     v1 的程式碼(nodesFromGray/whiten)保留,頁面拿它當教材:第一版為什麼不夠。 */

  // xmur3:字串 → 32 bit 種子。要跨平台位元級一致,所以不用任何內建雜湊
  function seedFrom(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  // sfc32:小、快、夠亂。這裡不需要密碼學等級的 PRNG,secret 本身才是祕密
  function rngFrom(secret) {
    const s = seedFrom(secret);
    let a = s(), b = s(), c = s(), d = s();
    return () => {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  /* secret → N×N 的 ±1 節點。強制零均值(節點數是偶數,把多的那一邊翻過來),
     否則整張圖會偏藍;偽隨機本來就接近零均值,這步只是把它釘死。 */
  function nodesFromSecret(secret, N) {
    const rnd = rngFrom(String(secret));
    const n = new Float64Array(N * N);
    for (let k = 0; k < n.length; k++) n[k] = rnd() < 0.5 ? -1 : 1;
    let sum = 0;
    for (let k = 0; k < n.length; k++) sum += n[k];
    for (let k = 0; sum !== 0 && k < n.length; k++) { // 把多數側的格子逐一翻面直到打平
      if ((sum > 0 && n[k] === 1) || (sum < 0 && n[k] === -1)) { n[k] = -n[k]; sum += n[k] * 2; }
    }
    return n;
  }

  /* 產生新的 secret。Crockford base32(去掉 I L O U,不會抄錯),100 bit。
     bytes 由呼叫端給(瀏覽器 crypto.getRandomValues / node crypto),pure.js 不碰環境。 */
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function secretFromBytes(bytes) {
    let s = '';
    for (let i = 0; i < 20; i++) s += B32[bytes[i % bytes.length] % 32];
    return 'IWL1-' + s.slice(0, 5) + '-' + s.slice(5, 10) + '-' + s.slice(10, 15) + '-' + s.slice(15, 20);
  }
  const isSecret = (s) => /^IWL1(-[0-9A-HJKMNP-TV-Z]{5}){4}$/.test(String(s || '').trim().toUpperCase());

  /* 嵌入:把場加到藍通道。data 是 RGBA(Uint8ClampedArray),就地修改。 */
  function embed(data, W, H, nodes, N) {
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 直接取整會留量化等高線,抖散成高頻微噪;區塊均值不變
    const nCols = (W >> 4) + 2;
    const rowA = new Float64Array(nCols), rowB = new Float64Array(nCols);
    let cachedGy = -1;
    for (let y = 0; y < H; y++) {
      const gy = y >> 4;
      if (gy !== cachedGy) {
        for (let g = 0; g < nCols; g++) { rowA[g] = nodeAt(nodes, N, g, gy); rowB[g] = nodeAt(nodes, N, g, gy + 1); }
        cachedGy = gy;
      }
      const fy = ss(((y & 15) + 0.5) / NODE_PX);
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        if (data[p + 3] < 250) continue; // 半透明像素 premultiply 會失真,驗證端算不回來
        const gx = x >> 4, fx = ss(((x & 15) + 0.5) / NODE_PX);
        const s = (rowA[gx] * (1 - fx) + rowA[gx + 1] * fx) * (1 - fy) + (rowB[gx] * (1 - fx) + rowB[gx + 1] * fx) * fy;
        const b0 = data[p + 2];
        const a = (b0 >= 253 || b0 <= 2) ? AMP / 2 : AMP; // 近白近黑最容易露餡,振幅減半
        const v = b0 + Math.floor(a * s + (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16);
        data[p + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return data;
  }

  /* 還原:把場減回去。不能「蓋一個相反的場」—— embed 裡有 Math.floor 與
     「近白近黑振幅減半」,後者還取決於當下的藍值,所以反過來蓋不會抵消
     (實測只有 64.7% 的像素回得去)。正確做法是反解:嵌入後的值只可能來自
     b0 ± 2 的範圍,逐一試哪個 b0 蓋出來剛好等於現在這個值。 */
  function unembed(data, W, H, nodes, N) {
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const nCols = (W >> 4) + 2;
    const rowA = new Float64Array(nCols), rowB = new Float64Array(nCols);
    let cachedGy = -1;
    for (let y = 0; y < H; y++) {
      const gy = y >> 4;
      if (gy !== cachedGy) {
        for (let g = 0; g < nCols; g++) { rowA[g] = nodeAt(nodes, N, g, gy); rowB[g] = nodeAt(nodes, N, g, gy + 1); }
        cachedGy = gy;
      }
      const fy = ss(((y & 15) + 0.5) / NODE_PX);
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        if (data[p + 3] < 250) continue;
        const gx = x >> 4, fx = ss(((x & 15) + 0.5) / NODE_PX);
        const sv = (rowA[gx] * (1 - fx) + rowA[gx + 1] * fx) * (1 - fy) + (rowB[gx] * (1 - fx) + rowB[gx + 1] * fx) * fy;
        const bayer = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const cur = data[p + 2];
        for (let b0 = Math.max(0, cur - 3); b0 <= Math.min(255, cur + 3); b0++) {
          const a = (b0 >= 253 || b0 <= 2) ? AMP / 2 : AMP;
          const v = b0 + Math.floor(a * sv + bayer);
          if ((v < 0 ? 0 : v > 255 ? 255 : v) === cur) { data[p + 2] = b0; break; }
        }
      }
    }
    return data;
  }

  /* 模板:一個 16x16 區塊的平均場值 = 四角節點的平均(smoothstep 對稱,積分正好是角點平均)。
     再做跟偵測端一樣的高通(減四鄰),兩邊要對得起來。 */
  function template(nodes, N) {
    const E = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      E[j * N + i] = (nodeAt(nodes, N, i, j) + nodeAt(nodes, N, i + 1, j) + nodeAt(nodes, N, i, j + 1) + nodeAt(nodes, N, i + 1, j + 1)) / 4;
    }
    const Ehp = new Float64Array(N * N);
    const m = (i, j) => E[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      Ehp[j * N + i] = m(i, j) - (m(i - 1, j) + m(i + 1, j) + m(i, j - 1) + m(i, j + 1)) / 4;
    }
    return { E, Ehp };
  }

  /* 偵測:積分圖 → 每個(相位, 平移)候選跟模板做匹配濾波 → t 統計量 → 取極值當 z。
     回 { found, z, phase, shift }。 */
  function detect(data, W, H, nodes, N, opts) {
    /* 熱圖(教學用):回傳「最佳相位」那一輪、每個位移各自的分數。
       原本只記相位 (0,0),但最高分不一定出現在那個相位,於是拿來當色階基準的
       最大值不是真正的峰值 —— 兩張圖並排時,錯的金鑰那張會被相對放大成「好像也有峰值」。 */
    const wantMap = !!(opts && opts.wantMap);
    let map = null, mapMax = -Infinity, mapFlat = false;
    const phaseMap = wantMap ? new Float64Array(N * N) : null;      // 一般格那組
    const phaseMapF = wantMap ? new Float64Array(N * N) : null;     // 平坦格那組
    const { Ehp } = template(nodes, N);
    const S = W + 1;
    const lumI = new Float64Array(S * (H + 1)); // B−(R+G)/2:場只藏在藍通道,這個差值把亮度甩掉
    const sqI = new Float64Array(S * (H + 1));  // 平方積分:算區塊變異數,挑平坦區塊
    const opqI = new Int32Array(S * (H + 1));   // 不透明計數:半透明區塊不採用
    for (let y = 0; y < H; y++) {
      let rowL = 0, rowQ = 0, rowO = 0;
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const dv = data[p + 2] - (data[p] + data[p + 1]) / 2;
        rowL += dv; rowQ += dv * dv; rowO += data[p + 3] >= 250 ? 1 : 0;
        lumI[(y + 1) * S + x + 1] = lumI[y * S + x + 1] + rowL;
        sqI[(y + 1) * S + x + 1] = sqI[y * S + x + 1] + rowQ;
        opqI[(y + 1) * S + x + 1] = opqI[y * S + x + 1] + rowO;
      }
    }
    const rect = (I, x, y, w, h) => I[(y + h) * S + x + w] - I[y * S + x + w] - I[(y + h) * S + x] + I[y * S + x];

    const B = NODE_PX, stats = [];
    let best = { z: 0, phase: null, shift: null };
    for (let py = 0; py < B; py++) for (let px = 0; px < B; px++) {
      const nx = Math.floor((W - px) / B), ny = Math.floor((H - py) / B);
      if (nx < 8 || ny < 8) continue;
      const m = new Float64Array(nx * ny), ok = new Uint8Array(nx * ny), flat = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = px + i * B, y = py + j * B;
        if (rect(opqI, x, y, B, B) === B * B) {
          const k = j * nx + i, mv = rect(lumI, x, y, B, B) / (B * B);
          m[k] = mv; ok[k] = 1;
          if (rect(sqI, x, y, B, B) / (B * B) - mv * mv < 6) flat[k] = 1;
        }
      }
      const hp = new Float64Array(nx * ny), hok = new Uint8Array(nx * ny);
      let sum = 0, sum2 = 0, cnt = 0;
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { // 高通:減四鄰,壓掉影像內容(低頻),場是格間交替(高頻)反而被強化
        const k = j * nx + i;
        if (ok[k] && ok[k - 1] && ok[k + 1] && ok[k - nx] && ok[k + nx]) {
          hp[k] = m[k] - (m[k - 1] + m[k + 1] + m[k - nx] + m[k + nx]) / 4;
          hok[k] = 1; sum += hp[k]; sum2 += hp[k] * hp[k]; cnt++;
        }
      }
      if (cnt < 60) continue;
      const sd0 = Math.sqrt(Math.max(1e-9, sum2 / cnt - (sum / cnt) * (sum / cnt)));
      const lim = 3 * sd0; // 截尾:雜訊來自彩色邊緣的重尾離群值,±1~2 的訊號不受影響
      let sum2c = 0, sum2f = 0, cntF = 0;
      const flatN = new Uint8Array(nx * ny);
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!hok[k]) continue;
        if (hp[k] > lim) hp[k] = lim; else if (hp[k] < -lim) hp[k] = -lim;
        sum2c += hp[k] * hp[k];
        if (flat[k] && flat[k - 1] && flat[k + 1] && flat[k - nx] && flat[k + nx]) { flatN[k] = 1; sum2f += hp[k] * hp[k]; cntF++; }
      }
      const sdHp = Math.sqrt(Math.max(1e-9, sum2c / cnt));
      const useFlat = cntF >= 200;
      const sdF = Math.max(0.3, Math.sqrt(sum2f / Math.max(1, cntF))); // σ 下限:乾淨平坦圖 σ→0 會讓 t 爆衝成誤判
      /* 位移搜尋。天真寫法是「每個位移都重掃一遍所有格子」= N²×格數,N=16 時上億次,
         教學頁按一下要等十幾秒。但所有 i%N 相同的格子共用同一個模板值,所以先把 hp
         依 (i%N, j%N) 折疊成 N×N 累加表,再跟模板做環狀互相關 —— 數值完全等價,
         成本從 N²×格數 降到 N²×N²,跟圖片大小脫鉤。 */
      const acc = new Float64Array(N * N), accN = new Int32Array(N * N);
      const accF = new Float64Array(N * N), accFN = new Int32Array(N * N);
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!hok[k]) continue;
        const b = (j % N) * N + (i % N);
        acc[b] += hp[k]; accN[b]++;
        if (flatN[k]) { accF[b] += hp[k]; accFN[b]++; }
      }
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        let s = 0, e2 = 0, sF = 0, e2F = 0;
        for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
          const e = Ehp[((b + sy) % N) * N + ((a + sx) % N)], u = b * N + a;
          s += acc[u] * e; e2 += accN[u] * e * e;
          sF += accF[u] * e; e2F += accFN[u] * e * e;
        }
        if (e2 > 0) {
          const t = s / (sdHp * Math.sqrt(e2)); stats.push(t);
          if (t > best.z) best = { z: t, phase: [px, py], shift: [sx, sy] };
          if (wantMap) phaseMap[sy * N + sx] = t;
        }
        if (useFlat && e2F > 0) {
          const t = sF / (sdF * Math.sqrt(e2F)); stats.push(t);
          if (t > best.z) best = { z: t, phase: [px, py], shift: [sx, sy], flat: true };
          if (wantMap) phaseMapF[sy * N + sx] = t;
        }
      }
      /* 熱圖要畫「產生判定的那一組統計量」。偵測其實有兩組(一般格、平坦格),
         白底或淡色的圖多半是平坦格那組勝出。原本只畫一般格那組,結果左圖的峰值
         不是真正的峰值,拿它當色階基準會讓右圖被相對放大成「好像也有峰值」。 */
      if (wantMap) {
        for (const [pm0, isFlat] of [[phaseMap, false], [phaseMapF, true]]) {
          if (isFlat && !useFlat) continue;
          let pm = -Infinity;
          for (let k = 0; k < pm0.length; k++) if (pm0[k] > pm) pm = pm0[k];
          if (pm > mapMax) { mapMax = pm; map = Float64Array.from(pm0); mapFlat = isFlat; }
        }
        phaseMapF.fill(0);
      }
    }
    if (!stats.length) return { found: false, z: 0, psr: 0, phase: null, shift: null };

    /* 峰值突出度(peak-to-sidelobe)。
       為什麼不能只看 t 的最大值:t 會跟著嵌入強度一起放大 —— 嵌得越強,拿「別人的金鑰」
       撞出來的最高分也越高(實測 v2:正向 43.7,別人的 secret 最高 13.1,而裁到 30% 的
       真陽性只剩 11.1 → 假陽性比真陽性還高,兩邊重疊)。
       改看「峰值比它自己的旁瓣高多少」:對的金鑰只有一個候選會衝高、其餘全趴著;
       錯的金鑰全部都是旁瓣,最高的那個並不突出。這個比值跟嵌入強度無關,所以不重疊。
       扣掉前 1% 再算旁瓣統計,避免峰值自己和它鄰近的相位污染基準。 */
    const sorted = Float64Array.from(stats).sort();
    const med = sorted[sorted.length >> 1];
    const dev = Float64Array.from(sorted, (v) => Math.abs(v - med)).sort();
    // MAD×1.4826 ≈ 常態下的 σ,但對離群值與混合分布免疫 —— 這裡的池子混了兩種
    // 統計量(一般格與平坦格),平坦格那組的 σ 有下限保護,用均值/標準差會被拉歪
    const sd = Math.max(1e-9, dev[dev.length >> 1] * 1.4826);
    const psr = (best.z - med) / sd;
    return { found: best.z > Z_MIN && psr > PSR_MIN, z: best.z, psr, zMin: Z_MIN, psrMin: PSR_MIN, phase: best.phase, shift: best.shift, map, mapFlat };
  }

  root.IWL = { NODE_PX, AMP, Z_MIN, PSR_MIN, thresholdFor, unembed, nodesFromSecret, secretFromBytes, isSecret, rngFrom, nodesFromGray, whiten, nodeStrength, nodeAt, embed, template, detect };
})(typeof window !== 'undefined' ? window : globalThis);
