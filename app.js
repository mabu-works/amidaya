"use strict";

// ==========================================
// 🔢 定数
// ==========================================
// 🎨 参加者ごとの色（12色を循環して使う）
const COLORS = [
  "#e11d63", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2",
  "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b91c1c"
];
const MIN_ITEMS = 2; // 参加者・結果の最小件数
const MAX_ITEMS = 50; // 参加者・結果の最大件数
const MAX_LABEL_LENGTH = 20; // ラベル1件の最大文字数
const DATA_KEY = "amidaya-data"; // localStorage の保存キー
const THEME_KEY = "amidaya-theme"; // localStorage のテーマキー
const DEFAULT_PARTICIPANTS = ["Aさん", "Bさん", "Cさん", "Dさん"];
const DEFAULT_RESULTS = ["大当たり", "当たり", "はずれ", "はずれ"];
const BASE_CANVAS_WIDTH = 720; // キャンバス幅の下限
const CANVAS_HEIGHT = 600; // キャンバス高さ（固定）
const PER_COLUMN_WIDTH = 56; // 1列あたりに確保する幅（px）
const RUNG_PROBABILITY = 0.45; // 各マスに横線を置く確率
const TRACE_TOTAL_LIMIT_MS = 10000; // トレース全体の時間上限
const TRACE_PER_PERSON_MS = 650; // 1人あたりのトレース時間の上限
const TOP_PAD = 54; // 上段ラベル用の余白
const BOTTOM_PAD = 54; // 下段ラベル用の余白

// ==========================================
// 🧮 純粋ロジック（DOM に触れない部分）
// ==========================================
// 🖼️ キャンバス幅を列数から決める（最低720px・1列56px）
function canvasWidthFor(n) {
  return Math.max(BASE_CANVAS_WIDTH, n * PER_COLUMN_WIDTH);
}

// ⏱️ 1人あたりのトレース時間を決める（全体が10秒以内に収まるよう人数で調整）
function traceDuration(n) {
  if (!n || n < 1) return TRACE_PER_PERSON_MS;
  return Math.min(TRACE_PER_PERSON_MS, Math.floor(TRACE_TOTAL_LIMIT_MS / n));
}

// 📋 一括貼り付けテキストを解析する（改行区切り・空行無視・20文字に切り詰め・上限で切り取り）
function parseBulkText(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim().slice(0, MAX_LABEL_LENGTH))
    .filter((s) => s.length > 0)
    .slice(0, MAX_ITEMS);
}

// 🏷️ ラベルを指定幅に収まるよう省略する（文字幅はフォントサイズと等しいと概算する）
function fitLabel(text, maxWidth, fontSize) {
  const s = String(text);
  if (!maxWidth || maxWidth <= 0) return s;
  const maxChars = Math.max(2, Math.floor(maxWidth / Math.max(1, fontSize)));
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)) + "…";
}

// 📊 あみだの段数を参加者数から決める（8 + 3n）
// 段数が固定だと人数が多いほど到達ゴールの偏りが大きくなるため、人数に応じて段数を増やす
function rowCount(n) {
  return 8 + 3 * n;
}

// 🎲 あみだの横線配置を生成する
// 各段を左から走査し、横線を置いたら次の列をスキップするので、同じ段で横線同士が隣り合うことはない
// 戻り値: rows[段] = Set(列) 。列 c は「列 c と列 c+1 を結ぶ横線」を表す
function generateRungs(n, random) {
  const rand = typeof random === "function" ? random : Math.random;
  const rows = [];
  const rowTotal = rowCount(n);
  for (let r = 0; r < rowTotal; r++) {
    const rowSet = new Set();
    let c = 0;
    while (c < n - 1) {
      if (rand() < RUNG_PROBABILITY) {
        rowSet.add(c);
        c += 2; // 横線の右隣には置かない（隣接防止）
      } else {
        c += 1;
      }
    }
    rows.push(rowSet);
  }
  return rows;
}

// 🧭 参加者 start がたどり着く列を返す（各段で右に横線があれば右へ、左にあれば左へ）
function traceOutcome(rungs, start) {
  let col = start;
  for (let r = 0; r < rungs.length; r++) {
    if (rungs[r].has(col)) col += 1;
    else if (rungs[r].has(col - 1)) col -= 1;
  }
  return col;
}

// 🎲 全参加者の到達先を計算する（結果は 0..n-1 の順列になる）
function computeOutcomes(rungs, n) {
  const out = new Array(n);
  for (let start = 0; start < n; start++) {
    out[start] = traceOutcome(rungs, start);
  }
  return out;
}

// ✅ 保存データ／共有データの形を検証し、正規化した { p, r } を返す（不正なら null）
function validateStateData(data) {
  if (!data || !Array.isArray(data.p) || !Array.isArray(data.r)) return null;
  if (data.p.length < MIN_ITEMS || data.p.length > MAX_ITEMS) return null;
  if (data.p.length !== data.r.length) return null;
  return {
    p: data.p.map((s) => String(s).slice(0, MAX_LABEL_LENGTH)),
    r: data.r.map((s) => String(s).slice(0, MAX_LABEL_LENGTH))
  };
}

// 🔗 参加者と結果を共有リンク用の文字列（Base64URL）に変換する
function encodeState(p, r) {
  const data = JSON.stringify({ p: p, r: r });
  const bytes = new TextEncoder().encode(data);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 🔗 共有リンクのハッシュ文字列を { p, r } に戻す（不正なら null）
function decodeState(hash) {
  try {
    const b64 = String(hash).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return validateStateData(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    return null; // 壊れたハッシュは無視する
  }
}

// 📦 Node（テスト）から純粋ロジックを読み込めるようにする
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COLORS, MIN_ITEMS, MAX_ITEMS, MAX_LABEL_LENGTH,
    DEFAULT_PARTICIPANTS, DEFAULT_RESULTS,
    BASE_CANVAS_WIDTH, CANVAS_HEIGHT, PER_COLUMN_WIDTH,
    RUNG_PROBABILITY, TRACE_TOTAL_LIMIT_MS, TRACE_PER_PERSON_MS,
    TOP_PAD, BOTTOM_PAD,
    canvasWidthFor, traceDuration, parseBulkText, fitLabel, rowCount,
    generateRungs, traceOutcome, computeOutcomes,
    validateStateData, encodeState, decodeState
  };
}

// ==========================================
// 🌐 ブラウザ側（DOM 配線）
// ==========================================
if (typeof document !== "undefined") {

// 🗂️ 状態
let participants = [...DEFAULT_PARTICIPANTS];
let results = [...DEFAULT_RESULTS];
let rungs = []; // rungs[段] = Set(列)
let generated = false;
let tracedPaths = []; // 参加者ごとの経路（座標列）
let outcomes = []; // 参加者index -> 結果index
let animating = false;

// 🧩 DOM要素
const $ = (id) => document.getElementById(id);
const participantsList = $("participantsList");
const resultsList = $("resultsList");
const canvas = $("ladderCanvas");
const ctx = canvas.getContext("2d");
const statusMsg = $("statusMsg");
const shareMsg = $("shareMsg");
const startBtn = $("startBtn");
const downloadBtn = $("downloadBtn");
const printBtn = $("printBtn");
const resetBtn = $("resetBtn");
const resultCard = $("resultCard");
const resultTableBody = $("resultTableBody");

// ==========================================
// 💾 リスト保存
// ==========================================
// 💾 参加者と結果を保存する
function saveData() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify({ p: participants, r: results }));
  } catch (e) { /* 保存できない環境では無視 */ }
}

// 💾 保存データを読み込む（読み込めたら true）
function loadSavedData() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return false;
    const data = validateStateData(JSON.parse(raw));
    if (!data) return false;
    participants = data.p;
    results = data.r;
    return true;
  } catch (e) {
    return false; // 壊れた保存データは無視
  }
}

// 💾 保存データを消去する
function clearSavedData() {
  try { localStorage.removeItem(DATA_KEY); } catch (e) { /* 無視 */ }
}

// 🖼️ キャンバスサイズを参加者数に合わせる
function updateCanvasSize() {
  const w = canvasWidthFor(participants.length);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== CANVAS_HEIGHT) canvas.height = CANVAS_HEIGHT;
}

// ==========================================
// ✏️ 編集リスト
// ==========================================
// ✏️ 編集リスト（番号・入力欄・削除ボタン）を組み立てる
function buildEditList(container, values, onChange) {
  container.innerHTML = "";
  values.forEach((value, i) => {
    const row = document.createElement("div");
    row.className = "edit-row";

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i + 1);

    if (container === participantsList) {
      const dot = document.createElement("span");
      dot.className = "color-dot";
      dot.style.background = COLORS[i % COLORS.length];
      row.appendChild(dot);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.maxLength = MAX_LABEL_LENGTH;
    input.addEventListener("input", () => {
      values[i] = input.value;
      saveData();
      invalidate();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-del";
    del.textContent = "削除";
    del.disabled = values.length <= MIN_ITEMS;
    del.addEventListener("click", () => {
      values.splice(i, 1);
      syncCounts(values);
      onChange();
      invalidate();
    });

    row.appendChild(num);
    row.appendChild(input);
    row.appendChild(del);
    container.appendChild(row);
  });
}

// ⚖️ 参加者と結果の数をそろえる（変更した側の件数に合わせ、もう一方は末尾から削る・足りなければ補う）
function syncCounts(changed) {
  const n = changed.length;
  const align = (arr, label) => {
    while (arr.length > n) arr.pop();
    while (arr.length < n) arr.push(label + (arr.length + 1));
  };
  if (changed === participants) align(results, "結果");
  else align(participants, "参加者");
}

// ✏️ 編集リストを描き直す
function renderEditors() {
  updateCanvasSize();
  buildEditList(participantsList, participants, renderEditors);
  buildEditList(resultsList, results, renderEditors);
  $("addParticipant").disabled = participants.length >= MAX_ITEMS;
  $("addResult").disabled = results.length >= MAX_ITEMS;
}

// 📋 一括貼り付けを反映する（参加者／結果共通・反映できたら true）
function applyBulkText(kind, text) {
  const items = parseBulkText(text);
  if (items.length === 0) return false;
  while (items.length < MIN_ITEMS) items.push((kind === "participants" ? "参加者" : "結果") + (items.length + 1));
  if (kind === "participants") { participants = items; syncCounts(participants); }
  else { results = items; syncCounts(results); }
  renderEditors();
  saveData();
  invalidate();
  return true;
}

// 🔄 生成済み状態を無効化する（編集があったとき）
function invalidate() {
  generated = false;
  tracedPaths = [];
  outcomes = [];
  startBtn.disabled = true;
  downloadBtn.disabled = true;
  if (printBtn) printBtn.disabled = true;
  resultCard.hidden = true;
  saveData();
  drawLadder(0);
  statusMsg.textContent = "内容が変更されました。「あみだ生成」を押してください。";
}

$("addParticipant").addEventListener("click", () => {
  if (participants.length >= MAX_ITEMS) return;
  participants.push("参加者" + (participants.length + 1));
  results.push("結果" + (results.length + 1));
  renderEditors();
  invalidate();
});

$("addResult").addEventListener("click", () => {
  if (results.length >= MAX_ITEMS) return;
  results.push("結果" + (results.length + 1));
  participants.push("参加者" + (participants.length + 1));
  renderEditors();
  invalidate();
});

// ==========================================
// 📋 一括貼り付け
// ==========================================
const participantsBulkBtn = $("participantsBulkBtn");
if (participantsBulkBtn) participantsBulkBtn.addEventListener("click", () => {
  const ta = $("participantsBulk");
  if (applyBulkText("participants", ta ? ta.value : "")) {
    statusMsg.textContent = "参加者を一括反映しました（" + participants.length + "件）。「あみだ生成」を押してください。";
  } else {
    statusMsg.textContent = "一括反映できる行がありませんでした。1行に1人ずつ入力してください。";
  }
});
const resultsBulkBtn = $("resultsBulkBtn");
if (resultsBulkBtn) resultsBulkBtn.addEventListener("click", () => {
  const ta = $("resultsBulk");
  if (applyBulkText("results", ta ? ta.value : "")) {
    statusMsg.textContent = "結果を一括反映しました（" + results.length + "件）。「あみだ生成」を押してください。";
  } else {
    statusMsg.textContent = "一括反映できる行がありませんでした。1行に1件ずつ入力してください。";
  }
});

// ==========================================
// 🖨️ 印刷
// ==========================================
if (printBtn) printBtn.addEventListener("click", () => {
  if (typeof window !== "undefined" && typeof window.print === "function") window.print();
});

// ==========================================
// 🔄 リセット（保存データ消去＋初期リストに戻す）
// ==========================================
function resetAll() {
  participants = [...DEFAULT_PARTICIPANTS];
  results = [...DEFAULT_RESULTS];
  renderEditors();
  invalidate();
  clearSavedData();
  statusMsg.textContent = "リストをリセットし、保存データを消去しました。";
}
if (resetBtn) resetBtn.addEventListener("click", resetAll);

// ==========================================
// 🎲 あみだ生成
// ==========================================
function generateLadder() {
  rungs = generateRungs(participants.length, Math.random);
  generated = true;
  tracedPaths = [];
  outcomes = computeOutcomes(rungs, participants.length);
  startBtn.disabled = false;
  downloadBtn.disabled = true;
  if (printBtn) printBtn.disabled = true;
  resultCard.hidden = true;
  drawLadder(0);
  statusMsg.textContent = "あみだを生成しました。「スタート」で結果を見ましょう。";
}

// 📐 列の x 座標と段の y 座標を計算する
function geometry(n) {
  updateCanvasSize();
  const w = canvas.width;
  const margin = Math.max(40, w / (n + 1) / 1.4);
  const stepX = n > 1 ? (w - margin * 2) / (n - 1) : 0;
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(n > 1 ? margin + stepX * i : w / 2);
  // 📏 段間隔は生成済みの段数に合わせる（未生成時は現在の人数から算出した段数）
  const rows = rungs.length || rowCount(n);
  const rowY = (r) => TOP_PAD + ((canvas.height - TOP_PAD - BOTTOM_PAD) / rows) * (r + 0.5);
  return { xs, rowY };
}

// 🗺️ 参加者 start の経路を座標列で返す
function pathPoints(start) {
  const n = participants.length;
  const { xs, rowY } = geometry(n);
  const pts = [{ x: xs[start], y: TOP_PAD }];
  let col = start;
  for (let r = 0; r < rungs.length; r++) {
    const yMid = rowY(r);
    pts.push({ x: xs[col], y: yMid });
    if (rungs[r].has(col)) {
      col += 1;
      pts.push({ x: xs[col], y: yMid });
    } else if (rungs[r].has(col - 1)) {
      col -= 1;
      pts.push({ x: xs[col], y: yMid });
    }
  }
  pts.push({ x: xs[col], y: canvas.height - BOTTOM_PAD });
  return pts;
}

// ==========================================
// 🎨 描画
// ==========================================
// 🎨 CSS 変数の値を読む
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 📏 ラベル列 i の表示幅を計算する
function labelWidth(n, i) {
  if (n <= 1) return canvas.width;
  const { xs } = geometry(n);
  if (i === 0) return xs[1] - xs[0] - 6;
  return xs[i] - xs[i - 1] - 6;
}

// 🎨 あみだを描く（progressCount 本までトレース済みとして描き、partial があれば描画中の経路を足す）
function drawLadder(progressCount, partial) {
  const n = participants.length;
  const { xs, rowY } = geometry(n);
  const w = canvas.width;
  const h = canvas.height;
  const lineColor = cssVar("--border") || "#999";
  const textColor = cssVar("--text") || "#222";
  const topY = TOP_PAD;
  const bottomY = h - BOTTOM_PAD;

  ctx.clearRect(0, 0, w, h);

  // 🏷️ ラベルを描く（列間隔に応じてフォントを縮小し、収まらない名前は省略する）
  const colStep = n > 1 ? Math.abs(xs[1] - xs[0]) : w;
  const topFont = Math.max(10, Math.min(17, Math.floor(colStep * 0.32)));
  const bottomFont = Math.max(10, Math.min(16, Math.floor(colStep * 0.30)));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const mw = labelWidth(n, i);
    ctx.font = "bold " + topFont + "px sans-serif";
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fillText(fitLabel(participants[i] || "参加者" + (i + 1), mw, topFont), xs[i], 26, mw);
    if (generated) {
      ctx.fillStyle = textColor;
      ctx.font = "bold " + bottomFont + "px sans-serif";
      ctx.fillText(fitLabel(results[i] || "結果" + (i + 1), mw, bottomFont), xs[i], h - 24, mw);
    }
  }

  if (!generated) {
    // ➖ 未生成時は縦線だけ薄く表示する
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(xs[i], topY);
      ctx.lineTo(xs[i], bottomY);
      ctx.stroke();
    }
    return;
  }

  // ➖ 縦線を描く
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(xs[i], topY);
    ctx.lineTo(xs[i], bottomY);
    ctx.stroke();
  }
  // ➖ 横線を描く
  for (let r = 0; r < rungs.length; r++) {
    const y = rowY(r);
    rungs[r].forEach((c) => {
      ctx.beginPath();
      ctx.moveTo(xs[c], y);
      ctx.lineTo(xs[c + 1], y);
      ctx.stroke();
    });
  }

  // 🖍️ トレース済み経路を描く
  for (let i = 0; i < progressCount; i++) {
    drawPath(tracedPaths[i], COLORS[i % COLORS.length], 1);
  }
  // ▶️ アニメーション中の経路（部分描画）
  if (partial && partial.pts) {
    drawPath(partial.pts, COLORS[partial.index % COLORS.length], partial.frac);
  }
}

// 🖍️ 経路を描く（frac の割合だけ部分描画する）
function drawPath(pts, color, frac) {
  if (!pts || pts.length < 2) return;
  // 📏 経路の総延長と各区間の長さ
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(len);
    total += len;
  }
  let remain = total * frac;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    if (remain >= segs[i - 1]) {
      ctx.lineTo(pts[i].x, pts[i].y);
      remain -= segs[i - 1];
    } else {
      const t = segs[i - 1] === 0 ? 0 : remain / segs[i - 1];
      ctx.lineTo(
        pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t
      );
      break;
    }
  }
  ctx.stroke();
}

// ==========================================
// ▶️ スタート（1本ずつトレース）
// ==========================================
function startTrace() {
  if (!generated || animating) return;
  animating = true;
  startBtn.disabled = true;
  downloadBtn.disabled = true;
  if (printBtn) printBtn.disabled = true;
  resultCard.hidden = true;
  tracedPaths = participants.map((_, i) => pathPoints(i));
  let index = 0;

  function animateOne() {
    if (index >= tracedPaths.length) {
      animating = false;
      downloadBtn.disabled = false;
      if (printBtn) printBtn.disabled = false;
      showResults();
      statusMsg.textContent = "結果が出ました！画像保存や共有ができます。";
      return;
    }
    const startTime = performance.now();
    const duration = traceDuration(tracedPaths.length);
    function frame(now) {
      const frac = Math.min(1, (now - startTime) / duration);
      drawLadder(index, { pts: tracedPaths[index], index, frac });
      if (frac < 1) {
        requestAnimationFrame(frame);
      } else {
        index += 1;
        animateOne();
      }
    }
    requestAnimationFrame(frame);
  }
  animateOne();
}

// 📋 結果表を表示する
function showResults() {
  resultTableBody.innerHTML = "";
  participants.forEach((name, i) => {
    const tr = document.createElement("tr");
    const tdWho = document.createElement("td");
    tdWho.className = "who";
    tdWho.style.color = COLORS[i % COLORS.length];
    tdWho.textContent = name || "参加者" + (i + 1);
    const tdArrow = document.createElement("td");
    tdArrow.className = "arrow";
    tdArrow.textContent = "→";
    const tdRes = document.createElement("td");
    tdRes.textContent = results[outcomes[i]] || "結果" + (outcomes[i] + 1);
    tr.appendChild(tdWho);
    tr.appendChild(tdArrow);
    tr.appendChild(tdRes);
    resultTableBody.appendChild(tr);
  });
  resultCard.hidden = false;
}

$("generateBtn").addEventListener("click", generateLadder);
startBtn.addEventListener("click", startTrace);

// ==========================================
// 💾 画像ダウンロード
// ==========================================
downloadBtn.addEventListener("click", () => {
  drawLadder(tracedPaths.length);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "amidaya-result.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }, "image/png");
});

// ==========================================
// 🔗 共有リンク（URLハッシュ）
// ==========================================
$("shareBtn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#" + encodeState(participants, results);
  try {
    await navigator.clipboard.writeText(url);
    shareMsg.textContent = "共有リンクをコピーしました。";
  } catch (e) {
    shareMsg.textContent = "コピーできませんでした。URL: " + url;
  }
});

// ==========================================
// 🌙 テーマ切り替え
// ==========================================
(function initTheme() {
  const root = document.documentElement;
  if (!root || !root.getAttribute || !root.setAttribute) return;
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
  }
  let current = root.getAttribute("data-theme");
  if (current !== "light" && current !== "dark") {
    try { current = localStorage.getItem(THEME_KEY); } catch (e) { current = null; }
  }
  apply(current === "light" ? "light" : "dark");
  const btn = document.getElementById("themeToggle");
  if (btn && btn.addEventListener) {
    btn.addEventListener("click", function () {
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      apply(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 保存できなくても切り替え自体は有効 */ }
      // 🎨 キャンバスは CSS 変数（--border / --text）から色を読むため、新テーマで描き直す
      if (!animating) drawLadder(tracedPaths.length);
    });
  }
})();

// ==========================================
// 🚀 初期化
// ==========================================
// 🔗 共有リンク（ハッシュ）を最優先し、なければ保存データを復元する
let restoredFromHash = false;
if (location.hash.length > 1) {
  const data = decodeState(location.hash.slice(1));
  if (data) {
    participants = data.p;
    results = data.r;
    restoredFromHash = true;
  }
}
if (!restoredFromHash) {
  loadSavedData();
}
renderEditors();
drawLadder(0);

}
