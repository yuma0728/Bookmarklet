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
  { id: "normal", label: "ノマゲ以下", goal: 2, goalLabel: "ノマゲ以下" }, // ASSIST以上
  { id: "hard", label: "ハード", goal: 5, goalLabel: "HARD" },
  { id: "exhard", label: "エクハ", goal: 6, goalLabel: "EX HARD" },
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
function pageURL(level, offset) {
  return `https://p.eagate.573.jp/game/2dx/${gameVersion()}/djdata/music/difficulty.html?difficult=${level - 1}&style=0&disp=1&offset=${offset}`;
}
async function fetchDoc(url) {
  const res = await fetch(url, { credentials: "include" });
  const buf = await res.arrayBuffer();
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  let text = new TextDecoder(ct.includes("shift_jis") || ct.includes("sjis") ? "shift_jis" : "utf-8").decode(buf);
  return new DOMParser().parseFromString(text, "text/html");
}
function parseDoc(doc) {
  const table = doc.querySelector(".series-difficulty table");
  if (!table) return null;
  const rows = [];
  for (const tr of table.querySelectorAll("tr")) {
    const td = tr.querySelectorAll("td");
    const a = td[0] && td[0].querySelector("a");
    if (!a || td.length < 5) continue;
    const chart = (td[1].textContent || "").trim().toUpperCase();
    const djm = (td[2].querySelector("img")?.getAttribute("src") || "").match(/\/([A-F]{1,3}|---)\.gif/);
    const score = parseInt((td[3].textContent || "").trim(), 10) || 0;
    const lm = (td[4].querySelector("img")?.getAttribute("src") || "").match(/clflg(\d)/);
    rows.push({
      title: a.textContent.trim(),
      chart: chart.charAt(0), // N / H / A / L / B
      dj: djm && djm[1] !== "---" ? djm[1] : "",
      score,
      lamp: lm ? parseInt(lm[1], 10) : 0,
    });
  }
  const hasNext = !!doc.querySelector(".navi-next a");
  return { rows, hasNext };
}
async function fetchLevel(level, progress) {
  const all = [];
  for (let page = 0; page < 40; page++) {
    const doc = await fetchDoc(pageURL(level, page * 50));
    const r = parseDoc(doc);
    if (!r) {
      if (page === 0) throw new Error("プレイデータを読み取れませんでした。IIDXの公式サイトにログインした状態で実行してください。");
      break;
    }
    all.push(...r.rows);
    progress(level, page + 1, r.hasNext);
    if (!r.hasNext) break;
    await sleep(FETCH_BATCH_INTERVAL_MS);
  }
  return all;
}
async function updatePlayData(levels, mock, progress) {
  const store = loadPlayData() || { levels: {}, timestamps: {} };
  for (const lv of levels) {
    store.levels[lv] = mock ? mock(lv) : await fetchLevel(lv, progress);
    store.timestamps[lv] = Date.now();
    if (!mock) await sleep(FETCH_BATCH_INTERVAL_MS);
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
  return { exact, byTitle, byLoose };
}
function findRow(idx, title, chart) {
  const e = idx.exact.get(norm(title) + "|" + chart);
  if (e) return e;
  for (const list of [idx.byTitle.get(norm(title)), idx.byLoose.get(loose(title))]) {
    if (!list) continue;
    const c = list.find((r) => r.chart === chart);
    if (c) return c;
    if (list.length === 1 || !chart) return list[0];
  }
  return null;
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
.hero-p{font-size:12px;font-weight:800;color:var(--sub)}
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
.grp.closed .cells{display:block;font-size:12px;color:var(--sub);padding:10px 0}
.grp.closed .cells > *{display:none}
.grp.closed .cells::before{content:"タップで開く"}
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
    : `<span>データなし</span>`;
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
  const purpose = PURPOSES.find((p) => p.id === settings.purpose) || PURPOSES[0];
  const levels = data.tables.filter((t) => t.purpose === purpose.id).map((t) => t.level);
  if (!levels.includes(settings.level)) settings.level = levels[levels.length - 1];
  const table = data.tables.find((t) => t.purpose === purpose.id && t.level === settings.level);
  const lv = table.level;
  const played = store?.levels?.[lv];
  const idx = makeIndex(played);

  // 譜面ごとにプレイデータを紐付け
  const groups = table.groups.map((g) => ({
    ...g,
    charts: g.charts.map(([t, chart, option]) => ({ t, chart, option, row: played ? findRow(idx, t, chart) : null })),
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
      (nodata ? `<span><i style="background:#fff;border:1px solid #ccc"></i>データなし ${nodata}</span>` : "")
    : "";
  const bar = played
    ? `<div class="bar">${order.filter((i) => counts[i] > 0).map((i) => `<i style="width:${(counts[i] / all.length) * 100}%;background:${LAMPS[i].color}"></i>`).join("")}</div>`
    : "";

  const mainCount = groups.filter((g) => !/未分類|未定|超個人差/.test(g.name)).length;
  let gi = -1, prevName = null;
  const f = settings.filter;
  const groupsHTML = groups.map((g) => {
    if (g.name !== prevName && !/未分類|未定|超個人差/.test(g.name)) gi++;
    prevName = g.name;
    const color = groupColor(Math.max(0, gi), mainCount / 1.6, g.name);
    const key = `${purpose.id}-${lv}-${g.kojin ? "k" : ""}${g.name}`;
    const shown = g.charts.filter((c) => passFilter(c, f, goal));
    const gDone = g.charts.filter((c) => c.row && c.row.lamp >= goal).length;
    const long = g.name.length > 3;
    return `<section class="grp${settings.collapsed[key] ? " closed" : ""}" data-key="${esc(key)}">
      <div class="glabel${g.kojin ? " kojin" : ""}" style="background-color:${color}"><div class="in">
        ${g.kojin ? `<span class="k">個人差</span>` : ""}<span class="n${long ? " long" : ""}">${esc(g.name)}</span><small>${gDone}/${g.charts.length}</small></div></div>
      <div class="cells">${shown.length ? shown.map((c) => cellHTML(c, goal)).join("") : `<div class="empty">該当する譜面はありません</div>`}</div>
    </section>`;
  }).join("");

  const missing = played ? all.filter((c) => !c.row) : [];
  const missHTML = missing.length
    ? `<details class="miss"><summary>公式データと照合できなかった譜面 (${missing.length})</summary>
        <div style="margin-top:6px">難易度表と公式サイトで曲名の表記が違う可能性があります。</div>
        <ul>${missing.map((c) => `<li>${esc(c.t)} <span style="color:#7f838d">${c.chart ? CHART_NAME[c.chart] : ""}</span></li>`).join("")}</ul></details>`
    : "";

  document.body.innerHTML = `
    <div class="top">
      <div class="head"><b>beatmania IIDX 難易度表</b><span>取得 ${esc(formatDate(store?.timestamps?.[lv]))}</span></div>
      <div class="seg" style="grid-template-columns:repeat(${PURPOSES.length},1fr)">${PURPOSES.map((p) => `<button data-p="${p.id}" class="${p.id === purpose.id ? "on" : ""}">${p.label}</button>`).join("")}</div>
      <div class="seg lv" style="grid-template-columns:repeat(${levels.length},1fr)">${levels.map((l) => `<button data-lv="${l}" class="${l === lv ? "on" : ""}">☆${l}</button>`).join("")}</div>
      <div class="chips">${[["all", "すべて"], ["done", "達成済み"], ["notdone", "未達成"], ["noplay", "未プレイ"]].map(([k, t]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${t}</button>`).join("")}</div>
    </div>
    <div class="wrap">
      <div class="hero"><div class="hero-row">
        <div class="hero-lv"><small>☆</small><b>${lv}</b></div>
        <div class="hero-txt"><div class="hero-p">SP ${purpose.label} 難易度表</div>
          <div class="hero-c">${played ? `${purpose.goalLabel} 達成 <b>${doneN}</b> / ${all.length}（${((doneN / all.length) * 100).toFixed(1)}%）` : "プレイデータ未取得"}</div></div></div>
        ${lampChips ? `<div class="lamps">${lampChips}</div>` : ""}${bar}
        ${played ? "" : `<div style="margin-top:8px;font-size:12.5px;color:#7f838d">☆${lv} のプレイデータがまだありません。下の「データを更新」を押してください。</div>`}
      </div>
      ${groupsHTML}
      ${missHTML}
    </div>
    <div class="foot">
      <button class="btn primary" data-act="lv">☆${lv} のデータを更新</button>
      <button class="btn" data-act="all">全☆(${state.allLevels.join("・")})のデータを更新</button>
      <div class="meta">難易度表: ${esc(table.source)}<br>※ = 正規・鏡以外のオプション推奨</div>
    </div>`;

  const top = document.querySelector(".top");
  document.body.style.setProperty("--toph", top.offsetHeight + 6 + "px");
  const rerender = () => { saveSettings(settings); render(state); };
  document.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { settings.purpose = b.dataset.p; rerender(); window.scrollTo(0, 0); }));
  document.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => { settings.level = +b.dataset.lv; rerender(); window.scrollTo(0, 0); }));
  document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { settings.filter = b.dataset.f; rerender(); }));
  document.querySelectorAll(".glabel").forEach((h) => h.addEventListener("click", () => {
    const sec = h.parentElement;
    sec.classList.toggle("closed");
    settings.collapsed[sec.dataset.key] = sec.classList.contains("closed");
    saveSettings(settings);
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
    showMessage(`<span class="err">${esc(e.message)}</span>\n\n<button class="btn" onclick="location.reload()">ページを再読み込み</button>`);
  }
}

// 動作確認用に一部の関数を公開
export { parseDoc, makeIndex, findRow };

// options.mock: 公式サイトを使わずに動作確認するためのダミーデータ生成関数 (preview.html用)
export default async (options = {}) => {
  try {
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
