// pop'n music クリア難易度表 Lv38～42 自動記入ツール (個人カスタマイズ版)
//
// 使い方(ブックマークレット):
//   javascript: import("https://<自分のアカウント>.github.io/Bookmarklet/diffTable3842.js").then(m => m.default());
//
// - 難易度表の中身は list/popn3842.csv を実行時に読み込む。CSVを差し替えるだけで表を更新できる。
// - 公式サイト(e-amusement)のプレイデータを Lv38～42 分取得し、端末(localStorage)に保存する。
// - 外部ライブラリ(jQuery等)には依存しない単体ファイル。アイコン画像のみ icon/ を参照する。

const FALLBACK_BASE_URL = "https://wanau-ynw.github.io/Bookmarklet";
let BASE_URL;
try {
  BASE_URL = new URL(".", import.meta.url).href.replace(/\/$/, "");
} catch (e) {
  BASE_URL = FALLBACK_BASE_URL;
}

const PLAY_DATA_URL =
  "https://p.eagate.573.jp/game/popn/popn29/playdata/mu_lv.html?version=-1&bemani=0&category=0&keyword=&sort=&sort_type=up&";
const CSV_PATH = "/list/popn3842.csv";
const LEVELS = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45];
const COLORS_PATH = "/list/banner_colors.json";

const STORE_KEY = "popn3842_playdata";
const SETTINGS_KEY = "popn3842_settings";
const STORE_VER = 1;

// 公式サイト負荷軽減: 少数ページずつまとめて取得し、間に待機を入れる (既存ツールと同じ配慮)
const FETCH_BATCH_SIZE = 4;
const FETCH_BATCH_INTERVAL_MS = 500;

// 難易度カテゴリ (表示順 = 難しい→簡単)
const CATEGORIES = ["詐称", "強", "中", "弱", "逆詐称", "個人差", "未評価"];
const CATEGORY_RE = /^(逆詐称|詐称|個人差|強|中|弱)/;

// メダル: 0=未プレイ/取得不可, 1-3=黒(未クリア), 4=緑, 5=橙, 6-8=銅(クリア), 9-11=銀(フルコン), 12=金(パーフェクト)
const MEDAL_LETTER = { a: 12, b: 11, c: 10, d: 9, e: 8, f: 7, g: 6, h: 3, i: 2, j: 1, k: 4, l: 5 };
const RANK_NAME = {
  s_plus: 12, s: 11, a3: 10, a2_plus: 9, a2: 8, a1_plus: 7, a1: 6, b_plus: 5, b: 4, c: 3, d: 2, e: 1,
};

// ランプ(表示上のクリア状況)の定義
const LAMPS = [
  { id: "perfect", label: "パフェ", test: (m) => m === 12 },
  { id: "fc", label: "フルコン", test: (m) => m >= 9 && m <= 11 },
  { id: "clear", label: "クリア", test: (m) => m >= 6 && m <= 8 },
  { id: "orange", label: "橙", test: (m) => m === 5 },
  { id: "easy", label: "緑", test: (m) => m === 4 },
  { id: "failed", label: "未クリア", test: (m) => m >= 1 && m <= 3 },
  { id: "noplay", label: "未プレイ", test: (m) => m === 0 },
];
const isCleared = (m) => m >= 6;

/* ------------------------------------------------------------------ */
/* ユーティリティ                                                       */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 曲名・ジャンル名の表記ゆれ吸収 (全角/半角, 波線, 空白, 大文字小文字, 引用符)
function norm(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[～〜~＼\\\s]/g, "")
    .toLowerCase();
}

async function resToText(res) {
  const buf = await res.arrayBuffer();
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.includes("utf-8")) return new TextDecoder().decode(buf);
  return new TextDecoder("Shift_JIS").decode(buf);
}

function loadSettings() {
  try {
    return Object.assign({ lv: 38, filter: "all", collapsed: {} }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch (e) {
    return { lv: 38, filter: "all", collapsed: {} };
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadPlayData() {
  try {
    const obj = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!obj || obj.version !== STORE_VER || !obj.levels) return null;
    return obj;
  } catch (e) {
    return null;
  }
}
function savePlayData(obj) {
  obj.version = STORE_VER;
  localStorage.setItem(STORE_KEY, JSON.stringify(obj));
}

function formatDate(ts) {
  if (!ts) return "未取得";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  const diff = (Date.now() - ts) / 86400000;
  const hours = Math.round(diff * 24);
  const ago = diff >= 1 ? `${diff.toFixed(1)}日前` : hours >= 1 ? `${hours}時間前` : "たった今";
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${ago})`;
}

/* ------------------------------------------------------------------ */
/* CSV (難易度表) の読み込み                                             */
/* ------------------------------------------------------------------ */

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// CSVの1行を難易度表の1曲に変換
function toEntry(cols, index) {
  const [lvStr, genreType, title, bpm, diff] = cols.map((x) => (x ?? "").trim());
  const lv = parseInt(lvStr, 10);
  if (!LEVELS.includes(lv) || !title) return null;
  const tm = genreType.match(/^(.*)\((H|EX|N|E)\)\s*$/);
  const genre = tm ? tm[1].trim() : genreType;
  const type = tm ? tm[2] : "";
  const cm = diff.match(CATEGORY_RE);
  // 難易度欄が空欄の曲は「未評価」枠にまとめる
  const category = cm ? cm[1] : "未評価";
  const soflan = /\d\s*[～〜~\-－]\s*\d/.test(bpm);
  return { index, lv, genre, type, title, bpm, category, soflan };
}

async function loadTable() {
  const res = await fetch(BASE_URL + CSV_PATH + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("難易度表CSVの読み込みに失敗しました (" + res.status + ")");
  const rows = parseCSV(await res.text());
  const body = rows[0] && /lv/i.test(rows[0][0]) ? rows.slice(1) : rows;
  const entries = body.map((r, i) => toEntry(r, i)).filter(Boolean);
  const byLv = {};
  for (const lv of LEVELS) byLv[lv] = entries.filter((e) => e.lv === lv);
  return byLv;
}

/* ------------------------------------------------------------------ */
/* 公式サイトからのプレイデータ取得                                       */
/* ------------------------------------------------------------------ */

function parseListDoc(doc) {
  const tables = doc.querySelectorAll(".mu_list_lv_table");
  if (tables.length !== 1) return null;
  const out = [];
  for (const li of tables[0].querySelectorAll("li")) {
    if (li.classList.contains("st_th")) continue;
    try {
      const c0 = li.children[0];
      const c3 = li.children[3];
      const song = c0.querySelector("a").textContent.trim();
      const genre = (c0.querySelector("p:nth-of-type(1)")?.textContent || "").trim();
      const score = parseInt((c3.querySelector("p")?.textContent || "0").replace(/[^\d]/g, ""), 10) || 0;
      const mimg = c3.querySelector("img:nth-of-type(1)");
      const rimg = c3.querySelector("img:nth-of-type(2)");
      const mm = mimg ? (mimg.getAttribute("src") || "").match(/meda_([a-z]+)\.png/) : null;
      const rm = rimg ? (rimg.getAttribute("src") || "").match(/rank_([a-z0-9_]+)\.png/) : null;
      const medal = mm && MEDAL_LETTER[mm[1]] ? MEDAL_LETTER[mm[1]] : 0;
      const rank = rm && RANK_NAME[rm[1]] ? RANK_NAME[rm[1]] : 0;
      // 譜面種別(H/EX)の判別用に、他の列のテキストも控えておく
      const extra = Array.from(li.children).slice(1, 3).map((x) => x.textContent.trim()).join(" ");
      out.push({ song, genre, score, medal, rank, extra });
    } catch (e) {
      console.warn("行の解析に失敗", e, li);
    }
  }
  return out;
}

async function fetchDoc(url) {
  const res = await fetch(url, { credentials: "include" });
  const text = await resToText(res);
  return new DOMParser().parseFromString(text, "text/html");
}

async function fetchLevel(lv, progress) {
  const first = await fetchDoc(`${PLAY_DATA_URL}page=0&lv=${lv}`);
  const firstRows = parseListDoc(first);
  if (!firstRows) {
    throw new Error("プレイデータを読み取れませんでした。公式サイトにログインした状態で実行してください。");
  }
  const pager = first.getElementById("s_page");
  const size = pager && pager.children.length > 0 ? pager.children.length : 1;
  const results = [...firstRows];
  progress(lv, 1, size);
  const pages = Array.from({ length: size - 1 }, (_, i) => i + 1);
  for (let i = 0; i < pages.length; i += FETCH_BATCH_SIZE) {
    await sleep(FETCH_BATCH_INTERVAL_MS);
    const batch = pages.slice(i, i + FETCH_BATCH_SIZE);
    const docs = await Promise.all(batch.map((p) => fetchDoc(`${PLAY_DATA_URL}page=${p}&lv=${lv}`)));
    for (const d of docs) {
      const rows = parseListDoc(d);
      if (!rows) throw new Error(`Lv${lv} のプレイデータ読み込み中にエラーが発生しました`);
      results.push(...rows);
    }
    progress(lv, Math.min(1 + i + FETCH_BATCH_SIZE, size), size);
  }
  return results;
}

// 指定Lvのデータを取得して保存。levels省略時は全Lv
async function updatePlayData(levels, mock, progress) {
  const store = loadPlayData() || { levels: {}, timestamps: {} };
  store.timestamps = store.timestamps || {};
  for (const lv of levels) {
    store.levels[lv] = mock ? mock(lv) : await fetchLevel(lv, progress);
    store.timestamps[lv] = Date.now();
    if (!mock) await sleep(FETCH_BATCH_INTERVAL_MS);
  }
  store.timestamp = Date.now();
  savePlayData(store);
  return store;
}

/* ------------------------------------------------------------------ */
/* 難易度表とプレイデータの照合                                           */
/* ------------------------------------------------------------------ */

function matchLevel(entries, played) {
  const map = new Map();
  for (const p of played || []) {
    const k = norm(p.song);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return entries.map((e) => {
    let cands = map.get(norm(e.title)) || [];
    if (cands.length > 1) {
      const g = cands.filter((p) => norm(p.genre) === norm(e.genre));
      if (g.length) cands = g;
    }
    if (cands.length > 1 && e.type) {
      const t = cands.filter((p) => (e.type === "EX" ? /EX/i.test(p.extra) : /HYPER|\bH\b/i.test(p.extra)));
      if (t.length) cands = t;
    }
    const p = cands[0];
    return Object.assign({}, e, p ? { found: true, medal: p.medal, rank: p.rank, score: p.score } : { found: false, medal: 0, rank: 0, score: 0 });
  });
}

function lampOf(r) {
  if (!r.found) return "nodata";
  if (r.score === 0 && r.medal === 0) return "noplay";
  return (LAMPS.find((l) => l.test(r.medal)) || LAMPS[LAMPS.length - 1]).id;
}

/* ------------------------------------------------------------------ */
/* 画面描画                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
:root{--bg:#f4f5f8;--card:#fff;--ink:#1c1f26;--sub:#6b7280;--line:#e5e7eb;--accent:#e4007f;
--l-perfect:#f5c518;--l-fc:#9aa4b2;--l-clear:#c46a2c;--l-orange:#ff8a00;--l-easy:#22b357;--l-failed:#3b3f4a;--l-noplay:#d9dce3;--l-nodata:#ffffff;}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body.pt{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;font-size:15px;line-height:1.35;
padding:0 0 calc(24px + env(safe-area-inset-bottom));}
.pt-top{position:sticky;top:0;z-index:10;background:rgba(244,245,248,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
padding:calc(8px + env(safe-area-inset-top)) 12px 8px;border-bottom:1px solid var(--line)}
.pt-title{font-size:13px;font-weight:700;color:var(--sub);display:flex;justify-content:space-between;align-items:center;gap:8px}
.pt-title b{color:var(--accent)}
.pt-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:6px;background:#e3e5ea;border-radius:10px;padding:3px}
.pt-tabs button{border:0;background:transparent;border-radius:8px;padding:8px 0;font-size:15px;font-weight:700;color:var(--sub);font-family:inherit}
.pt-tabs button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.15)}
.pt-filter{display:flex;gap:6px;margin-top:8px}
.pt-filter button{flex:1;border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 0;font-size:13px;color:var(--sub);font-family:inherit}
.pt-filter button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.pt-wrap{padding:10px 10px 0}
.pt-sum{background:var(--card);border-radius:14px;padding:12px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.pt-sum-head{display:flex;align-items:baseline;justify-content:space-between}
.pt-sum-head .big{font-size:26px;font-weight:800}
.pt-sum-head .big small{font-size:14px;color:var(--sub);font-weight:600}
.pt-sum-head .rate{font-size:14px;color:var(--sub)}
.pt-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:8px 0;background:var(--l-noplay)}
.pt-bar i{display:block;height:100%}
.pt-legend{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;color:var(--sub)}
.pt-legend span{display:inline-flex;align-items:center;gap:4px}
.pt-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;border:1px solid rgba(0,0,0,.08)}
.pt-group{margin-top:14px}
.pt-gh{display:flex;align-items:center;gap:8px;padding:6px 4px;font-weight:800;font-size:16px;user-select:none;-webkit-user-select:none}
.pt-gh .tag{color:#fff;border-radius:6px;padding:2px 8px;font-size:14px}
.pt-gh .cnt{margin-left:auto;font-size:13px;color:var(--sub);font-weight:600}
.pt-gh .chev{color:var(--sub);font-size:12px;transition:transform .15s}
.pt-group.closed .chev{transform:rotate(-90deg)}
.pt-group.closed .pt-list{display:none}
.c-詐称{background:#7c1fd1}.c-強{background:#e11d48}.c-中{background:#f59e0b}.c-弱{background:#16a34a}.c-逆詐称{background:#0284c7}.c-個人差{background:#64748b}.c-未評価{background:#a8a29e}.c-ソフラン{background:#111827}
.pt-list{display:flex;flex-direction:column;gap:6px}
.pt-row{display:flex;align-items:stretch;background:var(--card);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05);min-height:52px}
.pt-lamp{width:7px;flex:none}
.pt-main{flex:1;min-width:0;padding:7px 8px 7px 10px;display:flex;flex-direction:column;justify-content:center}
.pt-name{font-weight:700;font-size:15px;word-break:break-word}
.pt-sub{font-size:11.5px;color:var(--sub);margin-top:2px;display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.pt-type{font-size:10px;font-weight:800;border-radius:4px;padding:0 4px;line-height:15px;color:#fff;background:#f97316}
.pt-type.EX{background:#dc2626}
.pt-cat{font-size:10px;font-weight:800;border-radius:4px;padding:0 4px;line-height:15px;color:#fff}
.pt-un{font-size:10px;border:1px solid var(--line);border-radius:4px;padding:0 3px;line-height:14px}
.pt-res{flex:none;width:78px;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:4px 8px 4px 0;gap:1px}
.pt-icons{display:flex;gap:1px;height:26px}
.pt-icons img{height:26px;width:26px}
.pt-score{font-size:12px;font-variant-numeric:tabular-nums;color:var(--sub);font-weight:600}
.pt-none{font-size:11px;color:var(--sub)}
.l-perfect .pt-lamp{background:linear-gradient(#ffe066,#e0a800)}
.l-fc .pt-lamp{background:linear-gradient(#e6ebf1,#8794a5)}
.l-clear .pt-lamp{background:var(--l-clear)}
.l-orange .pt-lamp{background:var(--l-orange)}
.l-easy .pt-lamp{background:var(--l-easy)}
.l-failed .pt-lamp{background:var(--l-failed)}
.l-noplay .pt-lamp{background:var(--l-noplay)}
.l-nodata .pt-lamp{background:repeating-linear-gradient(45deg,#e5e7eb 0 4px,#fff 4px 8px)}
.l-perfect{background:#fffbea}.l-fc{background:#f6f8fb}
.l-noplay .pt-name,.l-nodata .pt-name{color:#4b5563}
.compact .pt-list{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.compact .pt-row{min-height:46px;border-radius:8px}
.compact .pt-lamp{width:5px}
.compact .pt-main{padding:4px 4px 4px 7px}
.compact .pt-name{font-size:12.5px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.compact .pt-sub{margin-top:1px;font-size:10px}
.compact .pt-sub > span:not(.pt-type):not(.pt-cat){display:none}
.compact .pt-res{width:30px;padding:2px 4px 2px 0}
.compact .pt-icons img:first-child:not(:last-child){display:none}
.compact .pt-icons,.compact .pt-icons img{height:22px;width:22px}
.compact .pt-score,.compact .pt-none{display:none}
.compact .l-clear{background:#fbefe6}.compact .l-fc{background:#eef1f5}.compact .l-perfect{background:#fff6cc}
.compact .l-easy{background:#e8f7ee}.compact .l-orange{background:#fff1e0}.compact .l-failed{background:#e4e5e9}
.pt-view{display:flex;justify-content:flex-end;gap:4px;margin-top:6px;font-size:12px;color:var(--sub);align-items:center}
.pt-view button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:3px 8px;font-size:12px;color:var(--sub);font-family:inherit}
.pt-view button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
/* ---- バナー表示 (デザインA) ---- */
body.pt{background-color:#fbf5df;background-image:radial-gradient(rgba(228,0,127,.06) 1.5px,transparent 1.6px);background-size:18px 18px}
.pt-top{background:rgba(251,245,223,.93)}
.pop{font-family:"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Hiragino Sans",sans-serif}
.hero{position:relative;margin:0 -10px;padding:12px 16px 12px;background:linear-gradient(#fff9e6,#fff3cc);border-bottom:3px solid #1d2b53;box-shadow:inset 0 4px 0 #f6c945}
.hero-row{display:flex;align-items:flex-end;gap:12px}
.hero-lv{color:#2d7fe0;font-weight:900;line-height:.9;text-shadow:2px 2px 0 #fff,3px 3px 0 rgba(29,43,83,.18)}
.hero-lv small{display:block;font-size:15px;letter-spacing:.08em}
.hero-lv b{font-size:58px;letter-spacing:-.02em}
.hero-txt{flex:1;min-width:0;padding-bottom:4px}
.hero-title{color:#e4007f;font-weight:900;font-size:19px;letter-spacing:.03em}
.hero-date{font-size:11px;color:#a16207;margin-top:2px}
.hero-clear{font-size:13px;color:#1d2b53;font-weight:700;margin-top:4px}
.hero-clear b{font-size:20px}
.medals{display:flex;gap:4px;overflow-x:auto;margin:10px -16px 0;padding:0 16px 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.medals::-webkit-scrollbar{display:none}
.medals span{flex:none;display:flex;align-items:center;gap:2px;background:#fff;border:2px solid #f0dc9c;border-radius:8px;padding:2px 6px 2px 3px;font-weight:800;font-size:13px;color:#1d2b53;font-variant-numeric:tabular-nums}
.medals img{width:22px;height:22px}
.medals span.tot{background:#1d2b53;border-color:#1d2b53;color:#fff;padding:2px 8px}
.hero .pt-bar{margin:8px 0 0;height:8px;border:1px solid rgba(29,43,83,.15)}
.bn-group{display:flex;gap:6px;margin-top:12px;align-items:flex-start}
.bn-label{flex:none;width:34px;position:sticky;top:var(--toph,150px);align-self:stretch;border-radius:10px;color:#fff;display:flex;flex-direction:column;align-items:center;padding:10px 0;gap:6px;
border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 2px rgba(0,0,0,.08);user-select:none;-webkit-user-select:none}
.bn-label .vt{writing-mode:vertical-rl;font-weight:900;font-size:17px;letter-spacing:.15em}
.bn-label small{font-size:10px;font-weight:800;writing-mode:vertical-rl;opacity:.95}
.bn-grid{flex:1;min-width:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 6px}
.bn-group.closed .bn-grid{display:block;font-size:12px;color:var(--sub);padding:10px 0}
.bn-group.closed .bn-grid > *{display:none}
.bn-group.closed .bn-grid::before{content:"タップで開く"}
.bn{min-width:0}
.bn-top{display:flex;gap:3px;align-items:stretch}
.bn-medal{flex:none;width:30px;border-radius:7px;background:#fff;border:2px solid #cfd8ea;display:flex;align-items:center;justify-content:center}
.bn-medal img{width:24px;height:24px}
.bn-banner{flex:1;min-width:0;height:52px;border-radius:6px;position:relative;overflow:hidden;padding:3px 5px;display:flex;flex-direction:column;justify-content:flex-end;
background:linear-gradient(120deg,hsl(var(--h) 85% 58%),hsl(calc(var(--h) + 40) 80% 42%));box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.55),0 1px 2px rgba(0,0,0,.2)}
.bn-banner::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 85% 20%,rgba(255,255,255,.35) 0 14px,transparent 15px),repeating-linear-gradient(-45deg,rgba(255,255,255,.08) 0 6px,transparent 6px 12px);pointer-events:none}
.bn-genre{position:absolute;top:2px;left:5px;right:22px;font-size:8.5px;font-weight:800;color:rgba(255,255,255,.92);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 1px rgba(0,0,0,.35)}
.bn-title{position:relative;z-index:1;font-size:12px;font-weight:900;line-height:1.15;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;
text-shadow:-1px -1px 0 rgba(0,0,0,.55),1px -1px 0 rgba(0,0,0,.55),-1px 1px 0 rgba(0,0,0,.55),1px 1px 0 rgba(0,0,0,.55)}
.bn-type{position:absolute;top:2px;right:2px;z-index:1;font-size:8px;font-weight:900;color:#fff;background:#f97316;border-radius:3px;padding:0 3px;line-height:12px;border:1px solid rgba(255,255,255,.8)}
.bn-type.EX{background:#dc2626}
.bn-cat{position:absolute;top:13px;right:2px;z-index:1;font-size:8px;font-weight:900;color:#fff;border-radius:3px;padding:0 3px;line-height:12px;border:1px solid rgba(255,255,255,.8)}
.bn-foot{display:flex;align-items:center;gap:3px;height:20px;padding-left:33px;font-size:11px;font-weight:800;color:#1d2b53;font-variant-numeric:tabular-nums}
.bn-foot img{height:17px;width:17px}
.bn-foot .none{color:#9ca3af;font-weight:700;font-size:10.5px}
.bn-lamp{flex:1;height:4px;border-radius:2px;margin-left:auto;max-width:34px}
.bn.l-noplay .bn-banner,.bn.l-nodata .bn-banner{filter:saturate(.25) brightness(1.08)}
.bn.l-nodata .bn-medal{border-style:dashed}
.bn.l-perfect .bn-medal{border-color:#f5c518;background:#fff8d6}
.bn.l-fc .bn-medal{border-color:#aab4c3;background:#f3f6fa}
.bn.l-clear .bn-medal{border-color:#e2a27a;background:#fff3ea}
.bn.l-easy .bn-medal{border-color:#7fd6a1}.bn.l-orange .bn-medal{border-color:#ffbf73}.bn.l-failed .bn-medal{border-color:#6b7280}
.pt-empty{font-size:13px;color:var(--sub);padding:6px 4px}
.pt-foot{margin:22px 10px 0;display:flex;flex-direction:column;gap:8px}
.pt-btn{border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;font-family:inherit;background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.pt-btn.primary{background:var(--accent);color:#fff}
.pt-meta{font-size:12px;color:var(--sub);text-align:center}
details.pt-miss{background:#fff;border-radius:12px;padding:10px 12px;font-size:13px;margin-top:14px}
details.pt-miss summary{font-weight:700;color:var(--sub)}
details.pt-miss li{margin:3px 0}
.pt-msg{padding:calc(40px + env(safe-area-inset-top)) 20px;text-align:center;font-size:15px;color:var(--sub);white-space:pre-wrap}
.pt-msg .err{color:#dc2626;font-weight:700}
.pt-prog{height:6px;background:#e3e5ea;border-radius:3px;overflow:hidden;margin:14px auto 0;max-width:260px}
.pt-prog i{display:block;height:100%;background:var(--accent);transition:width .2s}

/* ---- 配色テーマ (上の指定を上書き) ---- */
:root{--bg:#f2f0ec;--card:#fff;--ink:#262b3a;--sub:#80838e;--line:#e3e0da;--accent:#ef5b7c}
body.pt{background:var(--bg);background-image:none}
.pt-top{background:rgba(242,240,236,.94);border-bottom:1px solid var(--line);padding-bottom:6px}
.pt-tabs{grid-template-columns:repeat(10,1fr);gap:2px;background:#e4e1db;padding:3px;border-radius:10px}
.pt-tabs button{padding:8px 0;font-size:14px;font-variant-numeric:tabular-nums;border-radius:7px}
.pt-tabs button.on{background:var(--ink);color:#fff;box-shadow:none}
.pt-filter{gap:5px;margin-top:6px}
.pt-filter button{font-size:12.5px;padding:6px 0;border-color:var(--line);color:var(--sub)}
.pt-filter button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.pt-view{margin-top:6px;gap:0;justify-content:center}
.pt-view button{border-radius:0;padding:4px 14px;border-color:var(--line)}
.pt-view button:first-child{border-radius:7px 0 0 7px}
.pt-view button:last-child{border-radius:0 7px 7px 0;border-left:0}
.pt-view button.on{background:var(--ink);border-color:var(--ink)}
.pt-row2{display:flex;justify-content:center;gap:10px;margin-top:6px}
.pt-row2 .pt-view{margin-top:0}
/* 譜面の種類: H = 黄色、EX = 赤。どのバナーの色の上でも読めるよう、白い縁と影を付ける */
.pt-type,.bn-type{background:#ffd21f;color:#3b2c00;border:1.5px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.35)}
.pt-type.EX,.bn-type.EX{background:#e5202e;color:#fff}
.pt-type.N,.bn-type.N{background:#3d8fe0;color:#fff}
.bn-type{font-size:9px;line-height:13px;padding:0 4px;border-radius:4px;top:2px;right:2px}
.bn-cat{top:17px;border:1.5px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.35)}
/* 未プレイの曲はバナーの背景だけを薄くし、H/EXの表示や文字は薄くしない */
.bn.l-noplay .bn-banner,.bn.l-nodata .bn-banner{filter:none}
.bn.l-noplay .bn-banner::after,.bn.l-nodata .bn-banner::after{background:rgba(242,240,236,.6)}
.bn-genre{z-index:1}
/* 曲名・ジャンル名: 薄い色のバナーの上でも読めるよう、太めの黒い縁取りと影を付ける */
/* 曲名: 細めで薄めの縁取り (黒っぽくなりすぎないように) */
.bn-title{font-size:11px;text-shadow:
  1px 0 0 rgba(30,30,40,.6),-1px 0 0 rgba(30,30,40,.6),0 1px 0 rgba(30,30,40,.6),0 -1px 0 rgba(30,30,40,.6),
  0 0 2px rgba(30,30,40,.35)}
/* ジャンル名: 影なし */
.bn-genre{text-shadow:none}
.bn.l-noplay .bn-banner::after,.bn.l-nodata .bn-banner::after{background:rgba(242,240,236,.45)}
/* 曲名の後ろ (バナーの下側) だけに薄い影を敷いて、白い曲名を読みやすくする */
.bn-banner::before{content:"";position:absolute;left:0;right:0;bottom:0;height:58%;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.16));pointer-events:none}
.bn-title{z-index:2}
.hero{margin:10px 0 0;padding:12px 14px;background:var(--card);border:0;border-radius:16px;box-shadow:0 1px 3px rgba(38,43,58,.06)}
.hero-row{align-items:center}
.hero-lv{color:var(--ink);text-shadow:none;display:flex;align-items:baseline;gap:2px;line-height:1}
.hero-lv small{display:inline;font-size:18px;font-weight:800;letter-spacing:0;color:var(--ink)}
.hero-lv b{font-size:46px;font-weight:900}
.hero-title{color:var(--sub);font-size:12px;font-weight:700;letter-spacing:.02em}
.hero-date{color:var(--sub);font-size:11px}
.hero-clear{color:var(--ink);font-size:13px;margin-top:3px}
.hero-clear b{font-size:22px;color:var(--accent)}
.medals{margin:10px -14px 0;padding:0 14px 2px;gap:5px}
.medals span{background:var(--bg);border:0;border-radius:8px;padding:2px 7px 2px 3px;color:var(--ink)}
.medals span.tot{background:var(--bg);color:var(--sub);font-weight:700;font-size:12px;padding:2px 9px}
.hero .pt-bar{border:0;height:7px;background:#e8e5df}
.c-詐称{background:#7a5bbf}.c-強{background:#d65a6e}.c-中{background:#dd9a43}.c-弱{background:#4d9e7c}
.c-逆詐称{background:#4a87c0}.c-個人差{background:#8b8e98}.c-未評価{background:#b3ada3}.c-ソフラン{background:#3a3f52}
.bn-label{border:0;box-shadow:none;border-radius:9px}
.bn-medal{border-width:1.5px;border-color:#e3e0da}
.bn-banner{background:linear-gradient(90deg,var(--c1) 0%,var(--c2) 50%,var(--c3) 100%);box-shadow:0 1px 2px rgba(0,0,0,.18)}
.bn-banner::after{background:linear-gradient(180deg,rgba(255,255,255,.12),transparent 40%)}
.bn-foot{color:var(--ink)}
.bn-genre{text-shadow:none;color:#fff}
/* Lv・クリア数・メダルは上部の固定エリアに置く (スクロールしても見えるよう、小さめに表示) */
.pt-top .hero{margin:7px 0 0;padding:6px 10px 7px;border-radius:12px;box-shadow:none}
.pt-top .hero-row{gap:10px}
.pt-top .hero-lv b{font-size:30px}
.pt-top .hero-lv small{font-size:14px}
.pt-top .hero-clear{margin-top:0;font-size:12.5px}
.pt-top .hero-clear b{font-size:18px}
.pt-top .medals{margin:5px -10px 0;padding:0 10px 1px;gap:4px}
.pt-top .medals span{font-size:12px;padding:1px 6px 1px 2px}
.pt-top .medals img{width:19px;height:19px}
.pt-top .hero .pt-bar{margin-top:5px;height:5px}
.pt-wrap > .bn-group:first-of-type,.pt-wrap > .pt-group:first-of-type{margin-top:10px}
/* 閉じている枠のまとめカード */
.card{flex:1;min-width:0;background:#fff;border-radius:12px;padding:9px 11px;box-shadow:0 1px 3px rgba(38,43,58,.08);cursor:pointer;display:flex;flex-direction:column;gap:6px}
.card:active{transform:scale(.99)}
.card-top{display:flex;align-items:center;gap:8px}
.card-n{font-size:13px;font-weight:800;color:var(--ink)}
.card-n b{font-size:18px;color:var(--accent)}
.card .hit{font-size:11px;font-weight:800;color:var(--sub);background:var(--bg);border-radius:6px;padding:1px 6px}
.card-btn{margin-left:auto;font-size:12px;font-weight:800;color:#fff;background:var(--ink);border-radius:999px;padding:3px 10px;white-space:nowrap}
.card-bar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:#e8e5df}
.card-bar i{display:block;height:100%}
.card-chips{display:flex;flex-wrap:wrap;gap:3px 8px;font-size:10.5px;font-weight:700;color:var(--sub)}
.card-chips span{display:inline-flex;align-items:center;gap:3px}
.card-chips i{width:8px;height:8px;border-radius:2px;display:inline-block}
.bn-group.shut{align-items:stretch}
.bn-group.shut .bn-label .bn-in{position:static}
.pt-group.shut .card{margin-top:2px}
.bn-in .fold{font-size:10px;opacity:.9}
/* 開いている枠の「閉じる」ボタン (枠の上と下) */
.openbox{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.openhead{display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:10px;padding:5px 6px 5px 11px;font-size:12.5px;font-weight:800;box-shadow:0 1px 2px rgba(38,43,58,.06)}
.openhead b{font-size:16px;color:var(--accent)}
.openfoot{display:flex;justify-content:center;margin-top:4px}
.closebtn{border:0;font-family:inherit;font-size:12px;font-weight:800;color:var(--ink);background:#e6e3dd;border-radius:999px;padding:5px 14px;white-space:nowrap}
.openfoot .closebtn{padding:7px 26px}
.pt-gh .closebtn{margin-left:8px;padding:3px 10px;font-size:11px}
.allbar{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}
.allbar button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 12px;font-size:11.5px;font-weight:700;color:var(--sub);font-family:inherit}
.pt-wrap > .allbar + .bn-group,.pt-wrap > .allbar + .pt-group{margin-top:8px}
.pt-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;font-size:11px;color:var(--sub)}
.pt-head b{font-size:15px;font-weight:900;color:var(--ink);white-space:nowrap;flex:none}
.pt-head span{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.bn-label{position:relative;top:auto;align-self:stretch;padding:0}
.bn-in{position:sticky;top:var(--toph,150px);display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0}
`;

const LAMP_COLOR = {
  perfect: "#f5c518", fc: "#9aa4b2", clear: "#c46a2c", orange: "#ff8a00", easy: "#22b357",
  failed: "#3b3f4a", noplay: "#d9dce3",
};

function setupPage() {
  document.head.innerHTML =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    "<title>ポップン難易度表</title>" +
    // iPhoneは標準の丸ゴシック(ヒラギノ丸ゴ)を使う。Android等ではWebフォントの丸ゴシックで代用
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800;900&display=swap">';
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
  document.body.removeAttribute("style");
  document.body.className = "pt";
  document.body.innerHTML = "";
  window.scrollTo(0, 0);
}

function showMessage(html, progress) {
  document.body.innerHTML =
    `<div class="pt-msg">${html}${progress != null ? `<div class="pt-prog"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ""}</div>`;
}

function rowHTML(r, showCat) {
  const lamp = lampOf(r);
  let res;
  if (!r.found) res = `<span class="pt-none">データなし</span>`;
  else if (lamp === "noplay") res = `<span class="pt-none">未プレイ</span>`;
  else {
    const icons =
      (r.rank ? `<img src="${BASE_URL}/icon/s_${r.rank}.png" alt="">` : "") +
      (r.medal ? `<img src="${BASE_URL}/icon/c_${r.medal}.png" alt="">` : "");
    res = `<div class="pt-icons">${icons}</div><div class="pt-score">${r.score.toLocaleString()}</div>`;
  }
  const cat = showCat ? `<span class="pt-cat c-${r.category}">${r.category}</span>` : "";
  const bpm = r.soflan ? `<span>BPM ${esc(r.bpm)}</span>` : "";
  return `<div class="pt-row l-${lamp}">
    <div class="pt-lamp"></div>
    <div class="pt-main"><div class="pt-name">${esc(r.title)}</div>
      <div class="pt-sub">${cat}${r.type ? `<span class="pt-type ${r.type}">${r.type}</span>` : ""}<span>${esc(r.genre)}</span>${bpm}</div></div>
    <div class="pt-res">${res}</div></div>`;
}

// 曲名から決まった色相を作る (毎回同じ曲は同じ色になる)
function hueOf(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

// バナーの色: list/banner_colors.json (実際のバナー画像から抽出した2色) があればそれを使う。
// 無い曲は曲名から決めた落ち着いた色で代用する
let BANNER_COLORS = {};
async function loadBannerColors() {
  try {
    const res = await fetch(BASE_URL + COLORS_PATH + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const raw = await res.json();
    for (const [k, v] of Object.entries(raw)) BANNER_COLORS[norm(k)] = v;
  } catch (e) {
    console.warn("バナー色データを読み込めませんでした", e);
  }
}
function bannerStyle(title) {
  const c = BANNER_COLORS[norm(title)];
  // 色データは [左, 中央, 右] の3色 (古い2色形式にも対応)
  if (c) return `--c1:${c[0]};--c2:${c[1]};--c3:${c[2] || c[1]}`;
  const h = hueOf(title);
  return `--c1:hsl(${h} 38% 58%);--c2:hsl(${(h + 15) % 360} 36% 52%);--c3:hsl(${(h + 30) % 360} 34% 46%)`;
}

function tileHTML(r, showCat) {
  const lamp = lampOf(r);
  const medal = r.found && r.medal ? `<img src="${BASE_URL}/icon/c_${r.medal}.png" alt="">` : "";
  let foot;
  if (!r.found) foot = `<span class="none">データなし</span>`;
  else if (lamp === "noplay") foot = `<span class="none">未プレイ</span>`;
  else foot = (r.rank ? `<img src="${BASE_URL}/icon/s_${r.rank}.png" alt="">` : "") + `<span>${r.score.toLocaleString()}</span>`;
  const lampColor = LAMP_COLOR[lamp] || "transparent";
  const cat = showCat ? `<span class="bn-cat c-${r.category}">${r.category}</span>` : "";
  return `<div class="bn l-${lamp}">
    <div class="bn-top"><div class="bn-medal">${medal}</div>
      <div class="bn-banner pop" style="${bannerStyle(r.title)}">
        <span class="bn-genre">${esc(r.genre)}</span>${r.type ? `<span class="bn-type ${r.type}">${r.type}</span>` : ""}${cat}
        <span class="bn-title">${esc(r.title)}</span></div></div>
    <div class="bn-foot">${foot}<i class="bn-lamp" style="background:${lampColor}"></i></div></div>`;
}

function keepInView(key) {
  const sec = Array.from(document.querySelectorAll("section[data-key]")).find((s) => s.dataset.key === key);
  const top = document.querySelector(".pt-top");
  if (!sec || !top) return;
  const y = sec.getBoundingClientRect().top - top.offsetHeight - 8;
  if (y < 0) window.scrollBy(0, y);
}
// 枠が開いているか (初期状態は閉じている。開いた枠だけ覚えておく)
const isOpen = (settings, key) => !!(settings.opened && settings.opened[key]);

// 閉じている枠に表示する「まとめカード」: クリア数・メダルの内訳・開くボタン
function closedCardHTML(rows, shownCount, filter) {
  const cleared = rows.filter((r) => isCleared(r.medal)).length;
  const counts = {};
  for (const r of rows) { const l = lampOf(r); counts[l] = (counts[l] || 0) + 1; }
  const order = LAMPS.map((l) => l.id).filter((id) => counts[id]);
  const bar = order.map((id) => `<i style="width:${(counts[id] / rows.length) * 100}%;background:${LAMP_COLOR[id]}"></i>`).join("");
  const chips = order.map((id) => `<span><i style="background:${LAMP_COLOR[id]}"></i>${LAMPS.find((l) => l.id === id).label} ${counts[id]}</span>`).join("");
  const hit = filter !== "all" ? `<span class="hit">該当 ${shownCount}曲</span>` : "";
  return `<div class="card" data-open="1">
    <div class="card-top"><span class="card-n">クリア <b>${cleared}</b> / ${rows.length}</span>${hit}<span class="card-btn">開く ▾</span></div>
    <div class="card-bar">${bar}</div>
    <div class="card-chips">${chips}</div></div>`;
}

function bannerGroupHTML(key, label, rows, filter, settings, showCat) {
  const cleared = rows.filter((r) => isCleared(r.medal)).length;
  const shown = rows.filter((r) => passFilter(r, filter));
  const open = isOpen(settings, key);
  const body = !open
    ? closedCardHTML(rows, shown.length, filter)
    : `<div class="openbox">
        <div class="openhead"><span>クリア <b>${cleared}</b> / ${rows.length}</span><button class="closebtn" data-toggle="1">閉じる ▴</button></div>
        <div class="bn-grid">${shown.length ? shown.map((r) => tileHTML(r, showCat)).join("") : `<div class="pt-empty" style="grid-column:1/-1">該当する曲はありません</div>`}</div>
        ${shown.length > 6 ? `<div class="openfoot"><button class="closebtn" data-toggle="1">閉じる ▴</button></div>` : ""}
      </div>`;
  return `<section class="bn-group${open ? "" : " shut"}" data-key="${esc(key)}">
    <div class="bn-label c-${label} pop" data-toggle="1"><div class="bn-in"><span class="vt">${label}</span><small>${cleared}/${rows.length}</small>${open ? `<span class="fold">▲</span>` : ""}</div></div>
    ${body}
  </section>`;
}

function heroHTML(lv, rows, store) {
  const has = !!store?.levels?.[lv];
  const total = rows.length;
  const cleared = rows.filter((r) => isCleared(r.medal)).length;
  let strip = "", bar = "";
  if (has) {
    const mc = Array(13).fill(0);
    let nomedal = 0;
    for (const r of rows) {
      if (r.found && r.medal) mc[r.medal]++;
      else nomedal++;
    }
    // 獲得しているメダルだけを表示する
    strip = `<div class="medals">` +
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].filter((m) => mc[m] > 0)
        .map((m) => `<span><img src="${BASE_URL}/icon/c_${m}.png" alt="">${mc[m]}</span>`).join("") +
      `<span class="tot">メダルなし ${nomedal}</span></div>`;
    const counts = {};
    for (const r of rows) { const l = lampOf(r); counts[l] = (counts[l] || 0) + 1; }
    bar = `<div class="pt-bar">` + LAMPS.map((l) => (counts[l.id] ? `<i style="width:${(counts[l.id] / total) * 100}%;background:${LAMP_COLOR[l.id]}"></i>` : "")).join("") + `</div>`;
  }
  return `<div class="hero pop">
    <div class="hero-row">
      <div class="hero-lv"><small>Lv</small><b>${lv}</b></div>
      <div class="hero-txt">
        <div class="hero-clear">${has ? `クリア <b>${cleared}</b> / ${total}（${total ? ((cleared / total) * 100).toFixed(1) : "0.0"}%）` : "プレイデータ未取得"}</div></div>
    </div>${strip}${bar}</div>`;
}

function passFilter(r, filter) {
  if (filter === "cleared") return isCleared(r.medal);
  if (filter === "notclear") return !isCleared(r.medal);
  if (filter === "noplay") return lampOf(r) === "noplay" || !r.found;
  return true;
}

function groupHTML(key, label, rows, filter, settings, showCat) {
  const cleared = rows.filter((r) => isCleared(r.medal)).length;
  const shown = rows.filter((r) => passFilter(r, filter));
  const open = isOpen(settings, key);
  return `<section class="pt-group${open ? "" : " shut"}" data-key="${esc(key)}">
    <div class="pt-gh" data-toggle="1"><span class="chev">${open ? "▲" : "▼"}</span><span class="tag c-${label}">${label}</span>
      <span class="cnt">クリア ${cleared}/${rows.length}</span>${open ? `<button class="closebtn">閉じる ▴</button>` : ""}</div>
    ${open
      ? `<div class="pt-list">${shown.length ? shown.map((r) => rowHTML(r, showCat)).join("") : `<div class="pt-empty">該当する曲はありません</div>`}</div>
         ${shown.length > 6 ? `<div class="openfoot"><button class="closebtn" data-toggle="1">閉じる ▴</button></div>` : ""}`
      : closedCardHTML(rows, shown.length, settings.filter)}
  </section>`;
}

function summaryHTML(rows) {
  const counts = {};
  for (const l of LAMPS) counts[l.id] = 0;
  let nodata = 0;
  for (const r of rows) {
    const l = lampOf(r);
    if (l === "nodata") nodata++;
    else counts[l]++;
  }
  const total = rows.length;
  const cleared = rows.filter((r) => isCleared(r.medal)).length;
  const bar = LAMPS.map((l) => (counts[l.id] ? `<i style="width:${(counts[l.id] / total) * 100}%;background:${LAMP_COLOR[l.id]}"></i>` : "")).join("");
  const legend = LAMPS.map((l) => `<span><i style="background:${LAMP_COLOR[l.id]}"></i>${l.label} ${counts[l.id]}</span>`).join("") +
    (nodata ? `<span><i style="background:repeating-linear-gradient(45deg,#e5e7eb 0 3px,#fff 3px 6px)"></i>データなし ${nodata}</span>` : "");
  return `<div class="pt-sum">
    <div class="pt-sum-head"><div class="big">${cleared}<small> / ${total} クリア</small></div>
      <div class="rate">${total ? ((cleared / total) * 100).toFixed(1) : "0.0"}%</div></div>
    <div class="pt-bar">${bar}</div>
    <div class="pt-legend">${legend}</div></div>`;
}

function render(state) {
  const { table, store, settings } = state;
  const lv = settings.lv;
  const rows = matchLevel(table[lv] || [], store?.levels?.[lv]);
  const normal = rows.filter((r) => !r.soflan);
  const soflan = rows.filter((r) => r.soflan);
  // 並び順: 難しい順 (詐称→逆詐称) / 簡単順 (逆詐称→詐称)。
  // 入れ替えるのは枠の順番だけで、同じ枠の中の曲順はCSVのまま。個人差・未評価・ソフランは常に後ろ
  const easyFirst = settings.order === "easy";
  const MAIN = ["詐称", "強", "中", "弱", "逆詐称"];
  const catOrder = [...(easyFirst ? [...MAIN].reverse() : MAIN), ...CATEGORIES.filter((c) => !MAIN.includes(c))];
  const catRank = (c) => catOrder.indexOf(c);
  const byDifficulty = (a, b) => catRank(a.category) - catRank(b.category) || a.index - b.index;
  normal.sort(byDifficulty);
  soflan.sort(byDifficulty);

  const view = settings.view === "compact" ? "compact" : "banner";
  const gfn = view === "banner" ? bannerGroupHTML : groupHTML;
  let groups = "";
  for (const c of catOrder) {
    const g = normal.filter((r) => r.category === c);
    if (g.length) groups += gfn(`${lv}-${c}`, c, g, settings.filter, settings, false);
  }
  if (soflan.length) groups += gfn(`${lv}-ソフラン`, "ソフラン", soflan, settings.filter, settings, true);

  const missing = rows.filter((r) => !r.found);
  const missHTML = store?.levels?.[lv] && missing.length
    ? `<details class="pt-miss"><summary>公式データと照合できなかった曲 (${missing.length})</summary>
        <div style="margin-top:6px">CSVの曲名と公式サイトの曲名が一致しない可能性があります。</div>
        <ul>${missing.map((r) => `<li>${esc(r.title)} <span style="color:#6b7280">(${esc(r.genre)} ${r.type})</span></li>`).join("")}</ul></details>`
    : "";

  const f = settings.filter;
  document.body.innerHTML = `
    <div class="pt-top">
      <div class="pt-head pop"><b>pop'n music 難易度表</b><span>取得 ${esc(formatDate(store?.timestamps?.[lv]).replace(/^\d{4}\//, ""))}</span></div>
      <div class="pt-tabs">${LEVELS.map((l) => `<button data-lv="${l}" class="${l === lv ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="pt-filter">
        ${[["all", "すべて"], ["cleared", "クリア済み"], ["notclear", "未クリア"], ["noplay", "未プレイ"]]
          .map(([k, t]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${t}</button>`).join("")}
      </div>
      <div class="pt-row2">
        <div class="pt-view">
          <button data-v="banner" class="${view === "banner" ? "on" : ""}">バナー</button>
          <button data-v="compact" class="${view === "compact" ? "on" : ""}">コンパクト</button>
        </div>
        <div class="pt-view">
          <button data-o="hard" class="${!easyFirst ? "on" : ""}">難しい順</button>
          <button data-o="easy" class="${easyFirst ? "on" : ""}">簡単順</button>
        </div>
      </div>
      ${heroHTML(lv, rows, store)}
    </div>
    <div class="pt-wrap${view === "compact" ? " compact" : ""}" style="padding-top:0">
      ${store?.levels?.[lv] ? "" : `<div class="pt-sum" style="margin-top:10px">Lv${lv} のプレイデータがまだありません。下の「データを更新」を押してください。</div>`}
      <div class="allbar"><button data-all="open">すべて開く</button><button data-all="close">すべて閉じる</button></div>
      ${groups}
      ${missHTML}
    </div>
    <div class="pt-foot">
      <button class="pt-btn primary" data-act="update-lv">Lv${lv} のデータを更新</button>
      <button class="pt-btn" data-act="update-all">全Lv(${LEVELS[0]}～${LEVELS[LEVELS.length - 1]})のデータを更新</button>
      <div class="pt-meta">難易度表: list/popn3842.csv ／ 全${LEVELS.reduce((a, l) => a + (table[l]?.length || 0), 0)}曲</div>
    </div>`;

  document.querySelectorAll(".pt-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      settings.lv = parseInt(b.dataset.lv, 10);
      saveSettings(settings);
      render(state);
      window.scrollTo(0, 0);
    })
  );
  document.querySelectorAll(".pt-filter button").forEach((b) =>
    b.addEventListener("click", () => {
      settings.filter = b.dataset.f;
      saveSettings(settings);
      render(state);
    })
  );
  document.querySelectorAll("[data-v]").forEach((b) =>
    b.addEventListener("click", () => {
      settings.view = b.dataset.v;
      saveSettings(settings);
      render(state);
    })
  );
  document.querySelectorAll("[data-o]").forEach((b) =>
    b.addEventListener("click", () => {
      settings.order = b.dataset.o;
      saveSettings(settings);
      render(state);
    })
  );
  // 縦ラベルを固定表示する位置 = 上部の固定バーの高さ
  const top = document.querySelector(".pt-top");
  if (top) document.body.style.setProperty("--toph", top.offsetHeight + 6 + "px");
  // 枠の開閉: 左のラベル・見出し・まとめカードのどれを押しても切り替わる
  settings.opened = settings.opened || {};
  document.querySelectorAll("[data-toggle], [data-open]").forEach((h) =>
    h.addEventListener("click", () => {
      const key = h.closest("section").dataset.key;
      settings.opened[key] = !settings.opened[key];
      saveSettings(settings);
      render(state);
      // 閉じたとき、その枠が画面の上に隠れていたら枠の位置まで戻す (下の「閉じる」を押した場合など)
      if (!settings.opened[key]) keepInView(key);
    })
  );
  // すべて開く / すべて閉じる (このLvの枠が対象)
  document.querySelectorAll("[data-all]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("section[data-key]").forEach((s) => { settings.opened[s.dataset.key] = b.dataset.all === "open"; });
      saveSettings(settings);
      render(state);
    })
  );
  document.querySelector('[data-act="update-lv"]').addEventListener("click", () => runUpdate(state, [lv]));
  document.querySelector('[data-act="update-all"]').addEventListener("click", () => runUpdate(state, LEVELS));
}

async function runUpdate(state, levels) {
  const label = levels.length === 1 ? `Lv${levels[0]}` : `Lv${levels[0]}～${levels[levels.length - 1]}`;
  showMessage(`${label} のプレイデータを取得中・・・\n公式サイトに負荷をかけないよう少しずつ取得しています`, 0);
  try {
    state.store = await updatePlayData(levels, state.mock, (lv, cur, size) => {
      const p = (levels.indexOf(lv) + cur / size) / levels.length;
      showMessage(`${label} のプレイデータを取得中・・・\nLv${lv} ${cur}/${size} ページ`, p);
    });
    render(state);
  } catch (e) {
    console.error(e);
    showMessage(`<span class="err">${esc(e.message)}</span>\n\n<button class="pt-btn" onclick="location.reload()">ページを再読み込み</button>`);
  }
}

/* ------------------------------------------------------------------ */
/* エントリポイント                                                       */
/* ------------------------------------------------------------------ */

// options.mock: 公式サイトを使わずに動作確認するためのダミーデータ生成関数 (preview.html用)
export default async (options = {}) => {
  try {
    setupPage();
    showMessage("難易度表を読み込み中・・・");
    const table = await loadTable();
    await loadBannerColors();
    const settings = loadSettings();
    if (!LEVELS.includes(settings.lv)) settings.lv = LEVELS[0];
    const state = { table, settings, store: loadPlayData(), mock: options.mock || null };
    if (!state.store) {
      // 初回は全Lvのデータを取得する
      await runUpdate(state, LEVELS);
    } else {
      render(state);
    }
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<div style="padding:40px 20px;color:#dc2626">エラーが発生しました: ${esc(e && e.message ? e.message : e)}</div>`;
  }
};
