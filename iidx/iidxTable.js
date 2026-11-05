// beatmania IIDX クリア難易度表 自動記入ツール (個人カスタマイズ版)
//
// 使い方(ブックマークレット):
//   javascript: import("https://<自分のアカウント>.github.io/Bookmarklet/iidx/iidxTable.js?" + Date.now()).then(m => m.default());
//
// - 難易度表の中身は iidx/tables.json を実行時に読み込む
// - 公式サイト(e-amusement)の「楽曲データ / 難易度別」から SP ☆9～12 のプレイデータを取得し、端末に保存する

const FALLBACK_BASE_URL = "https://yuma0728.github.io/Bookmarklet/iidx";
let BASE_URL;
try {
  BASE_URL = new URL(".", import.meta.url).href.replace(/\/$/, "");
} catch (e) {
  BASE_URL = FALLBACK_BASE_URL;
}

const DEFAULT_VERSION = 34; // 公式サイトのURLに含まれるバージョン番号 (サイト上で実行した場合は自動判別)
const STORE_KEY = "iidx_playdata";
const SETTINGS_KEY = "iidx_settings";
const STORE_VER = 1;
const FETCH_BATCH_INTERVAL_MS = 600; // 公式サイト負荷軽減のため、1ページごとに待つ時間

const PURPOSES = [
  { id: "normal", label: "NORMAL以下", goal: 2, goalLabel: "NORMAL以下" }, // ASSIST CLEAR以上で達成
  { id: "hard", label: "HARD", goal: 5, goalLabel: "HARD" },
  { id: "exhard", label: "EX HARD", goal: 6, goalLabel: "EX HARD" },
];

// クリアランプ: 公式サイトの clflg0～7 に対応
const LAMPS = [
  { id: 0, name: "NO PLAY", short: "NO PLAY", color: "#d6d3cc", bg: "#ffffff" },
  { id: 1, name: "FAILED", short: "FAILED", color: "#5d616d", bg: "#e9e8ec" },
  { id: 2, name: "ASSIST CLEAR", short: "ASSIST", color: "#9c6cf0", bg: "#f1e9ff" },
  { id: 3, name: "EASY CLEAR", short: "EASY", color: "#4fbf5f", bg: "#e6f6e8" },
  { id: 4, name: "CLEAR", short: "CLEAR", color: "#3d8fe0", bg: "#e4effc" },
  { id: 5, name: "HARD CLEAR", short: "HARD", color: "#e04a58", bg: "#fde8ea" },
  { id: 6, name: "EX HARD CLEAR", short: "EX HARD", color: "#efbb1c", bg: "#fff5d1" },
  { id: 7, name: "FULL COMBO", short: "FULL COMBO", color: "#2bc4c4", bg: "#defafa" },
];
const CHART_NAME = { B: "BEGINNER", N: "NORMAL", H: "HYPER", A: "ANOTHER", L: "LEGGENDARIA" };

/* ------------------------------------------------------------------ */
/* ユーティリティ                                                       */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// 曲名の表記ゆれ吸収
function norm(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[～〜~\s]/g, "")
    .toLowerCase();
}
// さらにゆるい比較用 (記号・アクセントを無視)
function loose(s) {
  return norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}
function formatDate(ts) {
  if (!ts) return "未取得";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  const diff = (Date.now() - ts) / 86400000;
  const hours = Math.round(diff * 24);
  const ago = diff >= 1 ? `${diff.toFixed(1)}日前` : hours >= 1 ? `${hours}時間前` : "たった今";
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${ago})`;
}
function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch (e) {
    return fallback;
  }
}
function loadSettings() {
  return Object.assign({ purpose: "normal", level: 12, filter: "all", collapsed: {} }, loadJSON(SETTINGS_KEY, {}));
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function loadPlayData() {
  const o = loadJSON(STORE_KEY, null);
  return o && o.version === STORE_VER && o.levels ? o : null;
}
function savePlayData(o) {
  o.version = STORE_VER;
  localStorage.setItem(STORE_KEY, JSON.stringify(o));
}

/* ------------------------------------------------------------------ */
/* 公式サイトからのプレイデータ取得                                       */
/* ------------------------------------------------------------------ */

function gameVersion() {
  const m = location.pathname.match(/\/game\/2dx\/(\d+)\//);
  return m ? parseInt(m[1], 10) : DEFAULT_VERSION;
}
// 動作確認用: PC上の模擬サーバー (localhost) で動かしたときだけ、そのサーバーを公式サイトの代わりに使う
const IS_LOCAL_TEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const SITE_ORIGIN = IS_LOCAL_TEST ? location.origin : "https://p.eagate.573.jp";
function baseURL() {
  return `${SITE_ORIGIN}/game/2dx/${gameVersion()}/djdata/music/difficulty.html`;
}
// 1ページ目は公式サイトの「楽曲閲覧」ボタンと同じ送り方 (POST) で開く
async function fetchDoc(url, form) {
  const opt = { credentials: "include" };
  if (form) {
    opt.method = "POST";
    opt.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    opt.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, opt);
  if (!res.ok) throw new Error(`公式サイトからエラーが返されました (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  const text = new TextDecoder(ct.includes("shift_jis") || ct.includes("sjis") ? "shift_jis" : "utf-8").decode(buf);
  return new DOMParser().parseFromString(text, "text/html");
}
// 読み込めなかったページが何だったのかを、利用者に分かる言葉で説明する
function explainPage(doc) {
  const title = (doc.querySelector("#page-title")?.textContent || doc.title || "").trim().replace(/\s+/g, " ");
  const body = doc.body ? doc.body.textContent : "";
  if (/ログイン|login/i.test(body) && !doc.querySelector("#log-on .on-name")) {
    return "公式サイトにログインしていないようです。ログインしてから、もう一度ブックマークを開いてください。";
  }
  if (/ベーシックコース|有料|加入/.test(body) && !doc.querySelector(".series-difficulty")) {
    return "e-amusement ベーシックコースのページが表示されました。加入状況を確認してください。";
  }
  return `楽曲データのページを読み取れませんでした（表示されたページ: ${title || "不明"}）。`;
}
// 曲一覧の読み取り。PC版・スマホ版でページの作りが違っても読めるよう、
// 「曲の詳細ページへのリンク」を目印に1曲ずつ探し、その周りから譜面・ランプ・スコアを読む
function songBox(a) {
  // リンクから親をたどり、クリアランプ画像を含む最小のまとまりを1曲分とみなす
  let el = a.parentElement;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    if (el.querySelector('img[src*="clflg"]')) {
      return el.querySelectorAll('a[href*="music_info"]').length <= 1 ? el : a.closest("tr, li") || el;
    }
  }
  return a.closest("tr, li") || a.parentElement;
}
function parseDoc(doc) {
  const links = Array.from(doc.querySelectorAll('a[href*="music_info"]'));
  if (!links.length) return null;
  const rows = [];
  for (const a of links) {
    const box = songBox(a);
    const title = a.textContent.trim();
    if (!title) continue;
    const rest = (box.textContent || "").replace(a.textContent, " "); // 曲名中の単語を譜面名と誤認しないよう除く
    const cm = rest.match(/LEGGENDARIA|ANOTHER|HYPER|NORMAL|BEGINNER/i);
    const imgs = Array.from(box.querySelectorAll("img")).map((i) => i.getAttribute("src") || "");
    const lamp = imgs.map((s) => s.match(/clflg(\d)/)).find(Boolean);
    const dj = imgs.map((s) => s.match(/\/(AAA|AA|A|B|C|D|E|F|---)\.(?:gif|png)/i)).find(Boolean);
    const sm = rest.match(/(\d+)\s*\(\s*\d+\s*\/\s*\d+\s*\)/) || rest.match(/(?:^|\s)(\d{1,4})(?:\s|$)/);
    rows.push({
      title,
      chart: cm ? cm[0].charAt(0).toUpperCase() : "", // N / H / A / L / B
      dj: dj && dj[1] !== "---" ? dj[1].toUpperCase() : "",
      score: sm ? parseInt(sm[1], 10) : 0,
      lamp: lamp ? parseInt(lamp[1], 10) : 0,
    });
  }
  // 次のページ: offset= を含み「NEXT」「▶」「次」と書かれたリンク
  const next = Array.from(doc.querySelectorAll('a[href*="offset="]')).find((x) => /NEXT|▶|次/i.test(x.textContent));
  // ページ内の見出し (例: "SP LEVEL 12") から、実際に表示されたLvを読む
  const hm = ((doc.querySelector("#base") || doc.body)?.textContent || "").match(/(SP|DP)\s*LEVEL\s*(\d+)/i);
  return { rows, hasNext: !!next, nextURL: next ? next.getAttribute("href") : null, style: hm ? hm[1].toUpperCase() : "", level: hm ? parseInt(hm[2], 10) : 0 };
}

// 読み取りに失敗したときの診断情報 (DJ NAMEなどの個人情報は含めない)
function pageStats(doc) {
  const q = (s) => doc.querySelectorAll(s).length;
  return `曲リンク${q('a[href*="music_info"]')} / ランプ画像${q('img[src*="clflg"]')} / table${q("table")} / form${q("form")}`;
}
function diagnosis(doc) {
  const out = [];
  const L = window.__dxLaunch;
  if (L) {
    const ld = new DOMParser().parseFromString(L.html, "text/html");
    out.push(`[開いていたページ] ${L.path}`);
    out.push(`  ${pageStats(ld)}`);
    const a = ld.querySelector('a[href*="music_info"]');
    if (a) out.push(`  1曲目: ${songBox(a).outerHTML.replace(/\s+/g, " ").slice(0, 900)}`);
  }
  if (doc) {
    out.push(`[ツールが読み込んだページ] ${pageStats(doc)}`);
    const main = (doc.querySelector("#base-inner") || doc.querySelector("#base") || doc.body)?.textContent || "";
    out.push(`  本文: ${main.replace(/\s+/g, " ").trim().slice(0, 400)}`);
  }
  return out.join("\n");
}
class ReadError extends Error {
  constructor(message, doc, log) {
    super(message);
    this.diag = (log && log.length ? `[試した方法]\n  ${log.join("\n  ")}\n` : "") + diagnosis(doc);
  }
}
// ---- 公式サイトの検索フォーム ----
// ページに書かれている「楽曲閲覧」フォームを読み、指定Lv・SPを選んだ状態の送信内容を作る
function formFields(doc, level) {
  const form = doc.querySelector("#series-select form") || Array.from(doc.querySelectorAll("form")).find((f) => f.querySelector('select[name="difficult"]'));
  if (!form) return null;
  const fields = {};
  for (const el of form.querySelectorAll("input[name], select[name]")) {
    if (el.type === "submit") continue;
    if (el.tagName === "SELECT") {
      const opts = Array.from(el.options);
      let pick = null;
      if (el.name === "difficult") pick = opts.find((o) => new RegExp(`LEVEL\\s*${level}$`, "i").test(o.textContent.trim()));
      if (el.name === "style") pick = opts.find((o) => /^SP$/i.test(o.textContent.trim()));
      fields[el.name] = (pick || opts.find((o) => o.selected) || opts[0] || {}).value ?? "";
    } else {
      fields[el.name] = el.value;
    }
  }
  return { action: form.getAttribute("action") || baseURL(), method: (form.getAttribute("method") || "GET").toUpperCase(), fields };
}
async function templateForm(level) {
  // ブックマークを開いたページにフォームがあればそれを使い、無ければ検索ページを開いて読む
  const L = window.__dxLaunch;
  let f = L ? formFields(new DOMParser().parseFromString(L.html, "text/html"), level) : null;
  if (!f) f = formFields(await fetchDoc(baseURL()), level);
  return f;
}

// ---- 見えない枠 (iframe) でページを開く ----
// 通常の読み込み (fetch) で公式サイトが曲を返さない場合に使う。利用者が自分で「楽曲閲覧」やNEXTを押すのと同じ開き方になる
let loaderFrame = null;
function getFrame() {
  if (!loaderFrame || !loaderFrame.isConnected) {
    loaderFrame = document.createElement("iframe");
    loaderFrame.name = "dxloader";
    loaderFrame.setAttribute("sandbox", "allow-same-origin allow-forms"); // ページ内のスクリプトや広告は動かさない
    loaderFrame.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;opacity:0";
    document.documentElement.appendChild(loaderFrame); // bodyの書き換えで消えないよう、bodyの外に置く
  }
  return loaderFrame;
}
function frameLoad(start) {
  const fr = getFrame();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { fr.onload = null; reject(new Error("ページの読み込みがタイムアウトしました")); }, 25000);
    fr.onload = () => {
      clearTimeout(timer);
      fr.onload = null;
      try {
        const d = fr.contentDocument;
        if (!d || !d.body) throw new Error("empty");
        resolve(d);
      } catch (e) {
        reject(new Error("公式サイトのページを枠の中で開けませんでした"));
      }
    };
    start(fr);
  });
}
function frameSubmit(f) {
  return frameLoad(() => {
    const form = document.createElement("form");
    form.method = f.method;
    form.action = new URL(f.action, baseURL()).href;
    form.target = "dxloader";
    for (const [k, v] of Object.entries(f.fields)) {
      const i = document.createElement("input");
      i.type = "hidden"; i.name = k; i.value = v;
      form.appendChild(i);
    }
    document.documentElement.appendChild(form);
    form.submit();
    form.remove();
  });
}
function frameOpen(url) {
  return frameLoad((fr) => { fr.src = url; });
}

// 1つのLvの1ページ目を開く。うまくいく方法が見つかるまで順に試し、試した結果を記録する
let loadMode = null; // "fetch" か "frame" (一度うまくいった方法を以降も使う)
async function openFirstPage(level, log) {
  const f = await templateForm(level);
  log.push(f ? `フォーム: ${f.method} ${JSON.stringify(f.fields)}` : "フォーム: 見つからず");
  const tries = [];
  if (loadMode !== "frame") {
    if (f) tries.push(["fetch(フォーム)", () => fetchDoc(new URL(f.action, baseURL()).href, f.method === "POST" ? f.fields : null), "fetch"]);
    tries.push(["fetch(アドレス)", () => fetchDoc(`${baseURL()}?difficult=${level - 1}&style=0&disp=1&offset=0`), "fetch"]);
  }
  if (f) tries.push(["枠(フォーム)", () => frameSubmit(f), "frame"]);
  tries.push(["枠(アドレス)", () => frameOpen(`${baseURL()}?difficult=${level - 1}&style=0&disp=1&offset=0`), "frame"]);
  // すでに他のLvで成功した方法があれば、まずその方法だけで試す
  if (loadMode) tries.sort((a, b) => (a[2] === loadMode ? 0 : 1) - (b[2] === loadMode ? 0 : 1));
  let last = null, allNoData = true;
  for (const [name, run, mode] of tries) {
    try {
      const doc = await run();
      const r = parseDoc(doc);
      const noData = /データがみつかりません/.test(doc.body?.textContent || "");
      log.push(`${name}: 曲${r ? r.rows.length : 0}${noData ? " (データがみつかりません)" : ""}`);
      last = doc;
      if (r && r.rows.length) { loadMode = mode; return doc; }
      if (!noData) allNoData = false;
      // 実績のある方法で「データがみつかりません」なら、そのLvはプレイ記録が無いと判断する
      if (noData && mode === loadMode) return null;
    } catch (e) {
      log.push(`${name}: エラー ${e.message}`);
      allNoData = false;
    }
    await sleep(FETCH_BATCH_INTERVAL_MS);
  }
  // どの方法でも「データがみつかりません」= そのLvのプレイ記録が公式サイトに無い
  if (allNoData && last) return null;
  throw new ReadError(last ? explainPage(last) : "公式サイトのページを開けませんでした。", last, log);
}

let lastLog = [];
// 戻り値: { rows, none } (none = そのLvのプレイ記録が公式サイトに無い)
async function fetchLevel(level, progress) {
  const all = [];
  const log = (lastLog = [`☆${level}`]);
  let doc = await openFirstPage(level, log);
  if (!doc) {
    progress(level, 1, false);
    return { rows: [], none: true };
  }
  for (let page = 0; page < 40; page++) {
    const r = parseDoc(doc);
    if (!r || !r.rows.length) {
      if (page === 0) throw new ReadError(explainPage(doc), doc, log);
      break;
    }
    if (page === 0 && r.level && (r.level !== level || r.style !== "SP")) {
      throw new Error(`☆${level} のページを開こうとしましたが、${r.style} ☆${r.level} のページが表示されました。`);
    }
    all.push(...r.rows);
    progress(level, page + 1, r.hasNext);
    if (!r.hasNext) break;
    await sleep(FETCH_BATCH_INTERVAL_MS);
    // 次のページは、公式サイトの「NEXT」リンクのアドレスをそのまま使う
    const nextURL = r.nextURL ? new URL(r.nextURL, baseURL()).href : `${baseURL()}?difficult=${level - 1}&style=0&disp=1&offset=${(page + 1) * 50}`;
    doc = loadMode === "frame" ? await frameOpen(nextURL) : await fetchDoc(nextURL);
  }
  return { rows: all, none: false };
}
async function updatePlayData(levels, mock, progress) {
  if (!mock && !IS_LOCAL_TEST && location.hostname !== "p.eagate.573.jp") {
    throw new Error(`IIDXの公式サイト（p.eagate.573.jp）のページを開いた状態でブックマークを実行してください。\n今開いているページ: ${location.hostname}`);
  }
  const store = loadPlayData() || { levels: {}, timestamps: {} };
  store.none = store.none || {};
  const results = {};
  for (const lv of levels) {
    results[lv] = mock ? { rows: mock(lv), none: false } : await fetchLevel(lv, progress);
    if (!mock) await sleep(FETCH_BATCH_INTERVAL_MS);
  }
  // 複数のLvをまとめて取得して、どれにも記録が無いのは不自然なので、読み取りの問題として知らせる
  if (levels.length > 1 && levels.every((lv) => results[lv].none)) {
    throw new ReadError("どの☆でも「データがみつかりません」と表示されました。読み取り方に問題がある可能性があります。", null, lastLog);
  }
  for (const lv of levels) {
    store.levels[lv] = results[lv].rows;
    store.none[lv] = results[lv].none;
    store.timestamps[lv] = Date.now();
  }
  savePlayData(store);
  return store;
}

/* ------------------------------------------------------------------ */
/* 難易度表と照合                                                        */
/* ------------------------------------------------------------------ */

function makeIndex(rows) {
  const exact = new Map(), byTitle = new Map(), byLoose = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of rows || []) {
    exact.set(norm(r.title) + "|" + r.chart, r);
    add(byTitle, norm(r.title), r);
    add(byLoose, loose(r.title), r);
  }
  return { exact, byTitle, byLoose, rows: (rows || []).map((r) => ({ r, k: loose(r.title) })) };
}
// 2つの文字列が何文字違うか (編集距離)
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function findRow(idx, title, chart) {
  const e = idx.exact.get(norm(title) + "|" + chart);
  if (e) return e;
  for (const list of [idx.byTitle.get(norm(title)), idx.byLoose.get(loose(title))]) {
    if (!list) continue;
    const c = list.find((r) => r.chart === chart);
    if (c) return c;
    if (!chart) return list[0];
  }
  // 1～2文字だけ違う曲名 (打ち間違い・記号や文字の違い) は同じ曲とみなす。候補が1つに絞れるときだけ
  const k = loose(title);
  if (k.length < 4) return null;
  const max = k.length <= 8 ? 1 : 2;
  let best = null, bestD = max + 1, tie = false;
  for (const { r, k: rk } of idx.rows) {
    if (chart && r.chart !== chart) continue;
    const d = editDistance(k, rk, max);
    if (d < bestD) { best = r; bestD = d; tie = false; }
    else if (d === bestD) tie = true;
  }
  return best && !tie ? best : null;
}

/* ------------------------------------------------------------------ */
/* 画面                                                                  */
/* ------------------------------------------------------------------ */

const CSS = `
:root{--bg:#f2f1ee;--card:#fff;--ink:#22262f;--sub:#7f838d;--line:#e2e0db;--accent:#3d6fe0}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body.dx{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;font-size:14px;line-height:1.35;padding:0 0 calc(24px + env(safe-area-inset-bottom))}
button{font-family:inherit}
.top{position:sticky;top:0;z-index:10;background:rgba(242,241,238,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);padding:calc(8px + env(safe-area-inset-top)) 10px 7px;border-bottom:1px solid var(--line)}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}
.head b{font-size:15px;font-weight:900;white-space:nowrap}
.head span{font-size:10.5px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.seg{display:grid;gap:3px;background:#e3e1dc;border-radius:10px;padding:3px;margin-top:5px}
.seg button{border:0;background:transparent;border-radius:7px;padding:7px 0;font-size:13.5px;font-weight:800;color:var(--sub)}
.seg button.on{background:var(--ink);color:#fff}
.seg.lv button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.15)}
.seg button.off{color:#c4c1ba;text-decoration:line-through;text-decoration-thickness:1px}
.chips{display:flex;gap:5px;margin-top:6px}
.chips button{flex:1;border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 0;font-size:12.5px;color:var(--sub)}
.chips button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.wrap{padding:0 10px}
.hero{margin-top:10px;background:var(--card);border-radius:16px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.hero-row{display:flex;align-items:center;gap:12px}
.hero-lv{font-weight:900;line-height:1;white-space:nowrap}
.hero-lv small{font-size:16px;color:var(--sub)}
.hero-lv b{font-size:42px}
.hero-txt{min-width:0}
.hero-lv{display:flex;flex-direction:column;align-items:center}
.hero-p{font-size:12px;font-weight:800;color:var(--sub);margin-top:3px;letter-spacing:.02em}
.sorter{display:flex;justify-content:center;margin-top:6px}
/* ☆・達成数・ランプの内訳は上部の固定エリアに置く (スクロールしても見えるよう、小さめに表示) */
.top .hero{margin-top:7px;padding:6px 10px 7px;border-radius:12px;box-shadow:none}
.top .hero-row{gap:10px}
.top .hero-lv{flex-direction:row;align-items:baseline;gap:6px}
.top .hero-lv b{font-size:28px}
.top .hero-lv small{font-size:13px}
.top .hero-p{margin-top:0;font-size:11px}
.top .hero-c{margin-top:0;font-size:12px}
.top .hero-c b{font-size:17px}
.top .lamps{flex-wrap:nowrap;overflow-x:auto;margin:5px -10px 0;padding:0 10px 1px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.top .lamps::-webkit-scrollbar{display:none}
.top .lamps span{flex:none;font-size:11px;padding:1px 6px}
.top .bar{margin-top:5px;height:5px}
.note{margin-top:5px;text-align:center;font-size:10.5px;color:var(--sub);font-weight:700}
.note .op{color:#c2410c;font-weight:900}
.sorter button{border:1px solid var(--line);background:#fff;padding:4px 14px;font-size:12px;color:var(--sub)}
.sorter button:first-child{border-radius:7px 0 0 7px}
.sorter button:last-child{border-radius:0 7px 7px 0;border-left:0}
.sorter button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.hero-c{font-size:13px;font-weight:700;margin-top:2px}
.hero-c b{font-size:22px;color:var(--accent)}
.lamps{display:flex;flex-wrap:wrap;gap:4px;margin-top:9px}
.lamps span{display:inline-flex;align-items:center;gap:4px;background:var(--bg);border-radius:7px;padding:2px 7px;font-size:11.5px;font-weight:800;font-variant-numeric:tabular-nums}
.lamps i{width:9px;height:9px;border-radius:2px;display:inline-block}
.bar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:#e8e5df;margin-top:8px}
.bar i{display:block;height:100%}
.grp{display:flex;gap:6px;margin-top:12px;align-items:flex-start}
.glabel{flex:none;width:34px;align-self:stretch;border-radius:9px;color:#fff;user-select:none;-webkit-user-select:none}
.glabel .in{position:sticky;top:var(--toph,160px);display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 0}
.glabel .k{font-size:9px;font-weight:800;writing-mode:vertical-rl;letter-spacing:.1em;opacity:.95}
.glabel .n{font-size:15px;font-weight:900;writing-mode:vertical-rl;text-orientation:upright;letter-spacing:-.05em}
.glabel .n.long{font-size:12px;letter-spacing:0}
.glabel small{font-size:9.5px;font-weight:800;writing-mode:vertical-rl;opacity:.95}
.glabel.kojin{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.18) 0 5px,transparent 5px 10px)}
.cells{flex:1;min-width:0;display:grid;grid-template-columns:1fr 1fr;gap:5px}
/* 閉じている枠のまとめカード */
.card{flex:1;min-width:0;background:#fff;border-radius:12px;padding:9px 11px;box-shadow:0 1px 3px rgba(0,0,0,.07);cursor:pointer;display:flex;flex-direction:column;gap:6px}
.card:active{transform:scale(.99)}
.card-top{display:flex;align-items:center;gap:8px}
.card-n{font-size:12.5px;font-weight:800}
.card-n b{font-size:18px;color:var(--accent)}
.card .hit{font-size:11px;font-weight:800;color:var(--sub);background:var(--bg);border-radius:6px;padding:1px 6px}
.card-btn{margin-left:auto;font-size:12px;font-weight:800;color:#fff;background:var(--ink);border-radius:999px;padding:3px 10px;white-space:nowrap}
.card-bar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:#e8e5df}
.card-bar i{display:block;height:100%}
.card-chips{display:flex;flex-wrap:wrap;gap:3px 8px;font-size:10.5px;font-weight:700;color:var(--sub)}
.card-chips span{display:inline-flex;align-items:center;gap:3px}
.card-chips i{width:8px;height:8px;border-radius:2px;display:inline-block}
.grp.shut .glabel .in{position:static}
.glabel .fold{font-size:10px;opacity:.9}
/* 開いている枠の「閉じる」ボタン (枠の上と下) */
.openbox{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.openhead{display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:10px;padding:5px 6px 5px 11px;font-size:12.5px;font-weight:800;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.openhead b{font-size:16px;color:var(--accent)}
.openfoot{display:flex;justify-content:center;margin-top:4px}
.closebtn{border:0;font-size:12px;font-weight:800;color:var(--ink);background:#e3e1dc;border-radius:999px;padding:5px 14px;white-space:nowrap}
.openfoot .closebtn{padding:7px 26px}
.allbar{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}
.allbar button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 12px;font-size:11.5px;font-weight:700;color:var(--sub)}
.allbar + .grp{margin-top:8px}
.cell{position:relative;display:flex;min-height:50px;border-radius:8px;overflow:hidden;background:var(--lbg);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.cell .lb{flex:none;width:6px;background:var(--lc)}
.cell.l7 .lb{background:linear-gradient(#ff5e7e,#ffb347,#f9f871,#5ee28b,#4fb6ff,#a77bff)}
.cell .ct{flex:1;min-width:0;padding:4px 5px 4px 6px;display:flex;flex-direction:column;justify-content:space-between}
.cell .t{font-size:12.5px;font-weight:800;line-height:1.22;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.cell .s{display:flex;align-items:center;gap:4px;margin-top:2px;font-size:10px;color:var(--sub);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}
.cell .ch{font-size:9px;font-weight:900;color:#fff;border-radius:3px;padding:0 3px;line-height:13px}
.ch-N{background:#3d8fe0}.ch-H{background:#e8a317}.ch-A{background:#e04a58}.ch-L{background:#8b4fd6}.ch-B{background:#4fbf5f}
.cell .lp{margin-left:auto;font-size:9px;font-weight:900;color:var(--lc)}
.cell.l0 .lp,.cell.nd .lp{color:#a5a29b}
.cell.l6 .lp{color:#b48600}
.cell.nd{background:repeating-linear-gradient(45deg,#f4f3f0 0 5px,#fff 5px 10px)}
.cell.done::after{content:"✓";position:absolute;top:2px;right:4px;font-size:10px;font-weight:900;color:var(--lc)}
.cell.l6.done::after{color:#b48600}
.cell .op{color:#c2410c}
.empty{grid-column:1/-1;font-size:12px;color:var(--sub);padding:8px 2px}
.foot{margin:22px 10px 0;display:flex;flex-direction:column;gap:8px}
.btn{border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:800;background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.btn.primary{background:var(--accent);color:#fff}
.meta{font-size:11px;color:var(--sub);text-align:center;line-height:1.6}
details.miss{background:#fff;border-radius:12px;padding:10px 12px;font-size:12.5px;margin-top:14px}
details.miss summary{font-weight:800;color:var(--sub)}
details.miss li{margin:3px 0}
.msg{padding:calc(40px + env(safe-area-inset-top)) 20px;text-align:center;font-size:15px;color:var(--sub);white-space:pre-wrap}
.msg .err{color:#dc2626;font-weight:800}
.prog{height:6px;background:#e3e1dc;border-radius:3px;overflow:hidden;margin:14px auto 0;max-width:260px}
.prog i{display:block;height:100%;background:var(--accent);transition:width .2s}
`;

function setupPage() {
  document.head.innerHTML =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>IIDX 難易度表</title>';
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
  document.body.removeAttribute("style");
  document.body.className = "dx";
  document.body.innerHTML = "";
  window.scrollTo(0, 0);
}
function showMessage(html, progress) {
  document.body.innerHTML = `<div class="msg">${html}${progress != null ? `<div class="prog"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ""}</div>`;
}

// グループ(ランク)の色: 難しい順に 赤 → 青 へ変化。未分類などは灰色
function groupColor(i, n, name) {
  if (/未分類|未定|超個人差/.test(name)) return "#8b8f99";
  const t = n <= 1 ? 0 : i / (n - 1);
  const h = Math.round(352 - t * 140);
  return `hsl(${h} 58% 52%)`;
}

function cellHTML(c, goal) {
  const r = c.row;
  const lamp = r ? r.lamp : 0;
  const L = LAMPS[lamp];
  const done = r && lamp >= goal;
  const info = r
    ? `${r.dj ? `<span>${r.dj}</span>` : ""}${r.score ? `<span>${r.score}</span>` : ""}`
    : `<span>未取得</span>`;
  return `<div class="cell l${lamp}${r ? "" : " nd"}${done ? " done" : ""}" style="--lc:${L.color};--lbg:${L.bg}">
    <div class="lb"></div>
    <div class="ct"><div class="t">${esc(c.t)}</div>
      <div class="s">${c.chart ? `<span class="ch ch-${c.chart}">${c.chart}</span>` : ""}${c.option ? `<span class="op">※</span>` : ""}${info}<span class="lp">${r ? L.short : ""}</span></div></div></div>`;
}

function passFilter(c, filter, goal) {
  const lamp = c.row ? c.row.lamp : 0;
  if (filter === "done") return lamp >= goal;
  if (filter === "notdone") return lamp < goal;
  if (filter === "noplay") return lamp === 0;
  return true;
}

function render(state) {
  const { data, store, settings } = state;
  // ☆を先に選び、その☆にある目的 (NORMAL以下/HARD/EX HARD) から選ぶ
  const levels = state.allLevels;
  if (!levels.includes(settings.level)) settings.level = levels[levels.length - 1];
  const available = PURPOSES.filter((p) => data.tables.some((t) => t.purpose === p.id && t.level === settings.level));
  const purpose = available.find((p) => p.id === settings.purpose) || available[0];
  settings.purpose = purpose.id;
  const table = data.tables.find((t) => t.purpose === purpose.id && t.level === settings.level);
  const lv = table.level;
  const played = store?.levels?.[lv];
  const noRecord = !!store?.none?.[lv]; // 公式サイトにこのLvのプレイ記録が無い
  const idx = makeIndex(played);
  const NOPLAY = { lamp: 0, dj: "", score: 0 };

  // 譜面ごとにプレイデータを紐付け (記録が無いLvは全譜面をNO PLAYとして扱う)
  const groups = table.groups.map((g) => ({
    ...g,
    charts: g.charts.map(([t, chart, option]) => {
      if (noRecord) return { t, chart, option, row: NOPLAY };
      if (!played) return { t, chart, option, row: null };
      const row = findRow(idx, t, chart);
      // 公式データに見つからない譜面は NO PLAY として表示し、一覧で確認できるよう印を付けておく
      return { t, chart, option, row: row || NOPLAY, unmatched: !row };
    }),
  }));
  const all = groups.flatMap((g) => g.charts);
  const goal = purpose.goal;
  const doneN = all.filter((c) => c.row && c.row.lamp >= goal).length;

  // ヘッダー集計
  const counts = Array(8).fill(0);
  let nodata = 0;
  for (const c of all) c.row ? counts[c.row.lamp]++ : nodata++;
  const order = [7, 6, 5, 4, 3, 2, 1, 0];
  const lampChips = played
    ? order.filter((i) => counts[i] > 0).map((i) => `<span><i style="background:${LAMPS[i].color}"></i>${LAMPS[i].short} ${counts[i]}</span>`).join("") +
      (nodata ? `<span><i style="background:#fff;border:1px solid #ccc"></i>記録なし ${nodata}</span>` : "")
    : "";
  const bar = played
    ? `<div class="bar">${order.filter((i) => counts[i] > 0).map((i) => `<i style="width:${(counts[i] / all.length) * 100}%;background:${LAMPS[i].color}"></i>`).join("")}</div>`
    : "";

  // ランクの色は元の並び (難しい順) で決めておき、並び替えても同じランクは同じ色にする
  const isOther = (n) => /未分類|未定|超個人差/.test(n);
  const mainCount = groups.filter((g) => !isOther(g.name)).length;
  let gi = -1, prevName = null;
  for (const g of groups) {
    if (g.name !== prevName && !isOther(g.name)) gi++;
    prevName = g.name;
    g.color = groupColor(Math.max(0, gi), mainCount / 1.6, g.name);
  }
  // 並び順: 簡単順ならランクの順番だけ逆にする (同じランクの「地力」「個人差」は組のまま、ランク内の譜面順もそのまま)
  // 未分類・未定・超個人差は常に最後
  const easyFirst = settings.order === "easy";
  let ordered = groups;
  if (easyFirst) {
    const blocks = [];
    for (const g of groups.filter((g) => !isOther(g.name))) {
      const b = blocks[blocks.length - 1];
      if (b && b[0].name === g.name) b.push(g);
      else blocks.push([g]);
    }
    ordered = [...blocks.reverse().flat(), ...groups.filter((g) => isOther(g.name))];
  }
  const f = settings.filter;
  // 閉じている枠に表示する「まとめカード」: 達成数・ランプの内訳・開くボタン
  const cardHTML = (g, gDone, shownCount) => {
    const cnt = Array(8).fill(0);
    for (const c of g.charts) cnt[c.row ? c.row.lamp : 0]++;
    const ids = order.filter((i) => cnt[i] > 0);
    const n = g.charts.length;
    return `<div class="card" data-open="1">
      <div class="card-top"><span class="card-n">達成 <b>${gDone}</b> / ${n}</span>${f !== "all" ? `<span class="hit">該当 ${shownCount}譜面</span>` : ""}<span class="card-btn">開く ▾</span></div>
      <div class="card-bar">${ids.map((i) => `<i style="width:${(cnt[i] / n) * 100}%;background:${LAMPS[i].color}"></i>`).join("")}</div>
      <div class="card-chips">${played ? ids.map((i) => `<span><i style="background:${LAMPS[i].color}"></i>${LAMPS[i].short} ${cnt[i]}</span>`).join("") : "<span>プレイデータ未取得</span>"}</div></div>`;
  };
  settings.opened = settings.opened || {};
  const groupsHTML = ordered.map((g) => {
    const color = g.color;
    const key = `${purpose.id}-${lv}-${g.kojin ? "k" : ""}${g.name}`;
    const open = !!settings.opened[key]; // 初期状態は閉じている
    const shown = g.charts.filter((c) => passFilter(c, f, goal));
    const gDone = g.charts.filter((c) => c.row && c.row.lamp >= goal).length;
    const long = g.name.length > 3;
    return `<section class="grp${open ? "" : " shut"}" data-key="${esc(key)}">
      <div class="glabel${g.kojin ? " kojin" : ""}" data-toggle="1" style="background-color:${color}"><div class="in">
        ${g.kojin ? `<span class="k">個人差</span>` : ""}<span class="n${long ? " long" : ""}">${esc(g.name)}</span><small>${gDone}/${g.charts.length}</small>${open ? `<span class="fold">▲</span>` : ""}</div></div>
      ${open
        ? `<div class="openbox">
            <div class="openhead"><span>達成 <b>${gDone}</b> / ${g.charts.length}</span><button class="closebtn" data-toggle="1">閉じる ▴</button></div>
            <div class="cells">${shown.length ? shown.map((c) => cellHTML(c, goal)).join("") : `<div class="empty">該当する譜面はありません</div>`}</div>
            ${shown.length > 6 ? `<div class="openfoot"><button class="closebtn" data-toggle="1">閉じる ▴</button></div>` : ""}
          </div>`
        : cardHTML(g, gDone, shown.length)}
    </section>`;
  }).join("");

  // 公式サイトにはプレイ記録のある譜面しか載らないので、表側で見つからない譜面の多くは「まだプレイしていない譜面」。
  // そこで逆向きに、「公式データにあるのに表のどの譜面とも結びつかなかった譜面」を一覧にする。
  // ここに出るのは、曲名の書き方が違う譜面か、この難易度表に載っていない譜面だけ
  const used = new Set(all.map((c) => c.row));
  const orphans = noRecord || !played ? [] : played.filter((r) => !used.has(r) && /^[NHAL]$/.test(r.chart));
  const missHTML = !played || noRecord
    ? ""
    : orphans.length
    ? `<details class="miss"><summary>表と結びつかなかった公式データ：${orphans.length}件</summary>
        <div style="margin-top:6px">公式サイトにプレイ記録があるのに、この難易度表のどの譜面とも結びつかなかった譜面です。曲名の書き方が違うか、この表に載っていない譜面です。</div>
        <ul>${orphans.map((r) => `<li>${esc(r.title)} <span style="color:#7f838d">${CHART_NAME[r.chart] || ""} / ${LAMPS[r.lamp].short}</span></li>`).join("")}</ul></details>`
    : `<div class="miss" style="font-weight:800;color:#7f838d">表と結びつかなかった公式データ：0件（公式サイトの記録はすべて表と結びつきました）</div>`;

  document.body.innerHTML = `
    <div class="top">
      <div class="head"><b>beatmania IIDX 難易度表</b><span>取得 ${esc(formatDate(store?.timestamps?.[lv]))}</span></div>
      <div class="seg lv" style="grid-template-columns:repeat(${levels.length},1fr)">${levels.map((l) => `<button data-lv="${l}" class="${l === lv ? "on" : ""}">☆${l}</button>`).join("")}</div>
      <div class="seg" style="grid-template-columns:repeat(${PURPOSES.length},1fr)">${PURPOSES.map((p) => {
        const ok = available.includes(p);
        return `<button data-p="${p.id}" class="${p.id === purpose.id ? "on" : ""}${ok ? "" : " off"}"${ok ? "" : " disabled"}>${p.label}</button>`;
      }).join("")}</div>
      <div class="chips">${[["all", "すべて"], ["done", "達成済み"], ["notdone", "未達成"], ["noplay", "未プレイ"]].map(([k, t]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="sorter"><button data-o="hard" class="${!easyFirst ? "on" : ""}">難しい順</button><button data-o="easy" class="${easyFirst ? "on" : ""}">簡単順</button></div>
      <div class="note"><span class="op">※</span> が付いた譜面は、正規・MIRROR以外のオプション推奨</div>
      <div class="hero"><div class="hero-row">
        <div class="hero-lv"><div><small>☆</small><b>${lv}</b></div><div class="hero-p">${purpose.label}</div></div>
        <div class="hero-txt">
          <div class="hero-c">${played ? `${purpose.goalLabel} 達成 <b>${doneN}</b> / ${all.length}（${((doneN / all.length) * 100).toFixed(1)}%）` : "プレイデータ未取得"}</div></div></div>
        ${lampChips ? `<div class="lamps">${lampChips}</div>` : ""}${bar}
        ${played ? "" : `<div style="margin-top:8px;font-size:12.5px;color:#7f838d">☆${lv} のプレイデータがまだありません。下の「データを更新」を押してください。</div>`}
        ${noRecord ? `<div style="margin-top:8px;font-size:12.5px;color:#7f838d">公式サイトに ☆${lv} のプレイ記録がありません（すべて NO PLAY として表示しています）。</div>` : ""}
      </div>
    </div>
    <div class="wrap">
      <div class="allbar"><button data-all="open">すべて開く</button><button data-all="close">すべて閉じる</button></div>
      ${groupsHTML}
      ${missHTML}
    </div>
    <div class="foot">
      <button class="btn primary" data-act="lv">☆${lv} のデータを更新</button>
      <button class="btn" data-act="all">全☆(${state.allLevels.join("・")})のデータを更新</button>
      <div class="meta">難易度表: ${esc(table.source)}</div>
    </div>`;

  const top = document.querySelector(".top");
  document.body.style.setProperty("--toph", top.offsetHeight + 6 + "px");
  const rerender = () => { saveSettings(settings); render(state); };
  document.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { settings.purpose = b.dataset.p; rerender(); window.scrollTo(0, 0); }));
  document.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => { settings.level = +b.dataset.lv; rerender(); window.scrollTo(0, 0); }));
  document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { settings.filter = b.dataset.f; rerender(); }));
  document.querySelectorAll("[data-o]").forEach((b) => b.addEventListener("click", () => { settings.order = b.dataset.o; rerender(); }));
  // 枠の開閉: 左のラベル・まとめカードのどちらを押しても切り替わる
  document.querySelectorAll("[data-toggle], [data-open]").forEach((h) => h.addEventListener("click", () => {
    const key = h.closest("section").dataset.key;
    settings.opened[key] = !settings.opened[key];
    rerender();
    // 閉じたとき、その枠が画面の上に隠れていたら枠の位置まで戻す (下の「閉じる」を押した場合など)
    if (!settings.opened[key]) {
      const sec = Array.from(document.querySelectorAll("section[data-key]")).find((s) => s.dataset.key === key);
      const t = document.querySelector(".top");
      if (sec && t) { const y = sec.getBoundingClientRect().top - t.offsetHeight - 8; if (y < 0) window.scrollBy(0, y); }
    }
  }));
  // すべて開く / すべて閉じる (表示中の表の枠が対象)
  document.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("section[data-key]").forEach((s) => { settings.opened[s.dataset.key] = b.dataset.all === "open"; });
    rerender();
  }));
  document.querySelector('[data-act="lv"]').addEventListener("click", () => runUpdate(state, [lv]));
  document.querySelector('[data-act="all"]').addEventListener("click", () => runUpdate(state, state.allLevels));
}

async function runUpdate(state, levels) {
  const label = levels.map((l) => "☆" + l).join("・");
  showMessage(`${label} のプレイデータを取得中・・・\n公式サイトに負荷をかけないよう少しずつ取得しています`, 0);
  try {
    state.store = await updatePlayData(levels, state.mock, (lv, page, more) => {
      const i = levels.indexOf(lv);
      const p = (i + (more ? Math.min(0.9, page / 12) : 1)) / levels.length;
      showMessage(`${label} のプレイデータを取得中・・・\n☆${lv} ${page}ページ目`, p);
    });
    render(state);
  } catch (e) {
    console.error(e);
    const diag = e.diag
      ? `\n\n<div style="text-align:left;font-size:12px">下の「診断情報」をコピーして、Claude に送ってください。</div>
         <textarea id="diag" readonly style="width:100%;height:160px;font-size:10px;margin-top:6px">${esc(e.diag)}</textarea>
         <button class="btn" id="copydiag" style="width:100%;margin-top:6px">診断情報をコピー</button>`
      : "";
    showMessage(`<span class="err">${esc(e.message)}</span>${diag}\n\n<button class="btn" onclick="location.reload()">ページを再読み込み</button>`);
    const cb = document.getElementById("copydiag");
    if (cb) cb.addEventListener("click", async () => {
      const ta = document.getElementById("diag");
      try { await navigator.clipboard.writeText(ta.value); } catch (x) { ta.select(); document.execCommand("copy"); }
      cb.textContent = "コピーしました";
    });
  }
}

// 動作確認用に一部の関数を公開
export { parseDoc, makeIndex, findRow, diagnosis };

// options.mock: 公式サイトを使わずに動作確認するためのダミーデータ生成関数 (preview.html用)
export default async (options = {}) => {
  try {
    // 診断用に、ブックマークを開いた時点のページを控えておく (画面を書き換える前に)
    try {
      window.__dxLaunch = { path: location.pathname + location.search, html: document.documentElement.outerHTML };
    } catch (e) {}
    setupPage();
    showMessage("難易度表を読み込み中・・・");
    const res = await fetch(BASE_URL + "/tables.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("難易度表データの読み込みに失敗しました (" + res.status + ")");
    const data = await res.json();
    const allLevels = [...new Set(data.tables.map((t) => t.level))].sort((a, b) => a - b);
    const state = { data, allLevels, settings: loadSettings(), store: loadPlayData(), mock: options.mock || null };
    if (!state.store) await runUpdate(state, allLevels);
    else render(state);
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<div style="padding:40px 20px;color:#dc2626">エラーが発生しました: ${esc(e && e.message ? e.message : e)}</div>`;
  }
};
