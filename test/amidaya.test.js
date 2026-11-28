"use strict";

// ==========================================
// 🧪 あみだや 純粋ロジックのテスト（node --test）
// ==========================================
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MIN_ITEMS, MAX_ITEMS,
  DEFAULT_PARTICIPANTS, DEFAULT_RESULTS,
  canvasWidthFor, traceDuration, parseBulkText, fitLabel, rowCount,
  generateRungs, traceOutcome, computeOutcomes,
  validateStateData, encodeState, decodeState
} = require("../app.js");

// 🎲 決定的な乱数（mulberry32）— テストを再現可能にする
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------
// 📊 段数（8 + 3n）
// ------------------------------------------
test("rowCount grows as 8 + 3n", () => {
  assert.equal(rowCount(2), 14);
  assert.equal(rowCount(4), 20);
  assert.equal(rowCount(12), 44);
  assert.equal(rowCount(50), 158);
});

// ------------------------------------------
// 🖼️ キャンバス幅
// ------------------------------------------
test("canvasWidthFor keeps a 720px floor and 56px per column", () => {
  assert.equal(canvasWidthFor(2), 720);
  assert.equal(canvasWidthFor(12), 720); // 12 * 56 = 672 < 720
  assert.equal(canvasWidthFor(13), 728);
  assert.equal(canvasWidthFor(50), 2800);
});

// ------------------------------------------
// ⏱️ トレース時間
// ------------------------------------------
test("traceDuration caps per-person time so the total stays within 10s", () => {
  assert.equal(traceDuration(0), 650);
  assert.equal(traceDuration(1), 650);
  assert.equal(traceDuration(4), 650);
  assert.equal(traceDuration(20), 500);
  assert.equal(traceDuration(50), 200);
  for (let n = 1; n <= 50; n++) {
    assert.ok(traceDuration(n) * n <= 10000, "total within limit for n=" + n);
  }
});

// ------------------------------------------
// 📋 一括貼り付けの解析
// ------------------------------------------
test("parseBulkText splits lines, trims, and drops blank lines", () => {
  assert.deepEqual(parseBulkText(" Aさん \n\nBさん\r\n　\nCさん"), ["Aさん", "Bさん", "Cさん"]);
  assert.deepEqual(parseBulkText(""), []);
  assert.deepEqual(parseBulkText(null), []);
  assert.deepEqual(parseBulkText("\n\n"), []);
});

test("parseBulkText truncates each label to 20 chars and caps at 50 items", () => {
  const long = "あ".repeat(25);
  assert.deepEqual(parseBulkText(long), ["あ".repeat(20)]);
  const many = Array.from({ length: 60 }, (_, i) => "item" + i).join("\n");
  assert.equal(parseBulkText(many).length, MAX_ITEMS);
});

// ------------------------------------------
// 🏷️ ラベル省略
// ------------------------------------------
test("fitLabel returns the text unchanged when it fits", () => {
  assert.equal(fitLabel("Aさん", 100, 10), "Aさん");
  assert.equal(fitLabel("abc", 30, 10), "abc"); // exactly 3 chars fit
  assert.equal(fitLabel("abc", 0, 10), "abc"); // no width limit
});

test("fitLabel truncates with an ellipsis", () => {
  // maxChars = floor(35 / 10) = 3 → 2 chars + …
  assert.equal(fitLabel("abcdef", 35, 10), "ab…");
  // maxChars is at least 2 even for tiny widths
  assert.equal(fitLabel("abcdef", 5, 10), "a…");
});

// ------------------------------------------
// 🎲 あみだ生成の妥当性
// ------------------------------------------
test("generateRungs never places adjacent rungs in the same row", () => {
  for (const n of [2, 3, 4, 5, 8, 12, 20, 50]) {
    for (let seed = 1; seed <= 25; seed++) {
      const rungs = generateRungs(n, mulberry32(seed * 100 + n));
      assert.equal(rungs.length, rowCount(n), "row count for n=" + n);
      for (const rowSet of rungs) {
        const cols = [...rowSet].sort((a, b) => a - b);
        for (const c of cols) {
          assert.ok(c >= 0 && c <= n - 2, "rung column in range");
        }
        for (let i = 1; i < cols.length; i++) {
          assert.ok(cols[i] - cols[i - 1] >= 2, "no adjacent rungs (n=" + n + ", seed=" + seed + ")");
        }
      }
    }
  }
});

test("generateRungs is deterministic for a seeded RNG and honours edge RNGs", () => {
  const a = generateRungs(6, mulberry32(42));
  const b = generateRungs(6, mulberry32(42));
  assert.deepEqual(a.map((s) => [...s]), b.map((s) => [...s]));

  // RNG が常に対象確率未満 → 置ける場所すべてに横線（偶数列のみ）
  const dense = generateRungs(5, () => 0);
  for (const rowSet of dense) assert.deepEqual([...rowSet].sort((x, y) => x - y), [0, 2]);
  // RNG が常に対象確率以上 → 横線なし
  const empty = generateRungs(5, () => 0.99);
  for (const rowSet of empty) assert.equal(rowSet.size, 0);
});

// ------------------------------------------
// 🧭 経路トレース
// ------------------------------------------
test("traceOutcome follows a hand-built ladder", () => {
  const rungs = [new Set([0]), new Set([1]), new Set([0])];
  assert.equal(traceOutcome(rungs, 0), 2);
  assert.equal(traceOutcome(rungs, 1), 1);
  assert.equal(traceOutcome(rungs, 2), 0);
  assert.deepEqual(computeOutcomes(rungs, 3), [2, 1, 0]);
  // 横線がなければまっすぐ
  assert.deepEqual(computeOutcomes([new Set(), new Set()], 3), [0, 1, 2]);
});

test("computeOutcomes is always a permutation (bijection)", () => {
  for (const n of [2, 3, 4, 7, 10, 16, 30, 50]) {
    for (let seed = 1; seed <= 40; seed++) {
      const rungs = generateRungs(n, mulberry32(seed * 1000 + n));
      const outcomes = computeOutcomes(rungs, n);
      const sorted = [...outcomes].sort((a, b) => a - b);
      assert.deepEqual(sorted, Array.from({ length: n }, (_, i) => i),
        "permutation for n=" + n + ", seed=" + seed);
    }
  }
});

test("tracing the reversed ladder inverts the permutation", () => {
  for (const n of [2, 5, 9, 12]) {
    const rungs = generateRungs(n, mulberry32(n * 77));
    const outcomes = computeOutcomes(rungs, n);
    const reversed = [...rungs].reverse();
    for (let start = 0; start < n; start++) {
      assert.equal(traceOutcome(reversed, outcomes[start]), start);
    }
  }
});

// ------------------------------------------
// ✅ 状態データの検証
// ------------------------------------------
test("validateStateData accepts valid data and truncates long labels", () => {
  const ok = validateStateData({ p: ["あ".repeat(25), "B"], r: ["x", "y"] });
  assert.deepEqual(ok, { p: ["あ".repeat(20), "B"], r: ["x", "y"] });
});

test("validateStateData rejects malformed data", () => {
  assert.equal(validateStateData(null), null);
  assert.equal(validateStateData({}), null);
  assert.equal(validateStateData({ p: ["only"], r: ["one"] }), null); // below MIN_ITEMS
  assert.equal(validateStateData({ p: ["a", "b"], r: ["x"] }), null); // length mismatch
  const tooMany = Array.from({ length: MAX_ITEMS + 1 }, () => "x");
  assert.equal(validateStateData({ p: tooMany, r: tooMany }), null); // above MAX_ITEMS
});

// ------------------------------------------
// 🔗 共有リンクのエンコード／デコード
// ------------------------------------------
test("encodeState/decodeState round-trips Japanese labels", () => {
  const hash = encodeState(DEFAULT_PARTICIPANTS, DEFAULT_RESULTS);
  assert.ok(!/[+/=]/.test(hash), "Base64URL alphabet only");
  assert.deepEqual(decodeState(hash), { p: DEFAULT_PARTICIPANTS, r: DEFAULT_RESULTS });
});

test("decodeState rejects broken or invalid hashes", () => {
  assert.equal(decodeState("!!!not-base64!!!"), null);
  assert.equal(decodeState(""), null);
  // Base64 として正しくても中身の形が違うものは弾く
  const badShape = encodeState(["only-one"], ["x"]);
  assert.equal(decodeState(badShape), null);
});
