/* 魈公引擎 · 前端逻辑
 *
 * 三条自我约束：
 *   1. 节奏模型不许用 Math.random（用 seeded rng，保证同种子可复现）
 *   2. 一次只处理一个文件：树上的文件是"写出来"的，不是一开始就铺满
 *   3. 速度范围 0.1× ~ 1000×：高速时按帧批量落字，不能逐字符 await
 */

const $ = (id) => document.getElementById(id);

/* ================= 种子随机 ================= */
function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  let spare = null;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    normal() {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0; while (u === 0) u = next();
      const v = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * Math.PI * v);
      return mag * Math.cos(2 * Math.PI * v);
    },
  };
}

/* ================= 节奏模型 ================= */
const BASE_CHAR_MS = 62;
const KIND_FACTOR = { import: 0.72, decl: 1.8, comment: 0.8, blank: 0.15, control: 1.15, return: 1.0, body: 1.0 };
const NEIGHBORS = { a:"s",s:"d",d:"f",f:"g",g:"h",h:"j",q:"w",w:"e",e:"r",r:"t",t:"y",z:"x",x:"c",c:"v",v:"b",i:"o",o:"p",j:"k",k:"l",n:"m",m:"n",u:"i",y:"u" };

function classify(line) {
  if (!line.trim()) return "blank";
  if (/^\s*#/.test(line)) return "comment";
  if (/^\s*(import|from)\s+\S/.test(line)) return "import";
  if (/^\s*(async\s+)?(def|class)\s+\w+/.test(line)) return "decl";
  if (/^\s*(if|elif|else|for|while|try|except|finally|with|match|case)\b/.test(line)) return "control";
  if (/^\s*(return|yield|raise|pass|continue|break)\b/.test(line)) return "return";
  return "body";
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function makeTypo(ch, rng) {
  const lower = ch.toLowerCase();
  const r = rng.next();
  if (r < 0.3) return "";
  if (r < 0.5) return ch === lower ? ch.toUpperCase() : ch.toLowerCase();
  const nb = NEIGHBORS[lower];
  return nb ? (ch === lower ? nb : nb.toUpperCase()) : ch;
}

/** 把一行变成 [{kind,char,delayMs}] */
function lineToKeys(line, lineIndex, cfg, rng) {
  const out = [];
  const factor = KIND_FACTOR[classify(line)] ?? 1;
  // 速度上限保护：1000× 时把单键延迟压到 0.05ms 级别，避免 Infinity
  const delay = (base) => clamp((base * Math.exp(rng.normal() * 0.42)) / cfg.speed, 0.05, 900);

  if (lineIndex > 0 && lineIndex % cfg.thinkEveryLines === 0) out.push({ kind: "pause", delayMs: rng.float(120, 450) / Math.min(cfg.speed, 8) });
  if (lineIndex > 0 && lineIndex % cfg.driftEveryLines === 0) out.push({ kind: "pause", delayMs: rng.float(3000, 15000) / Math.min(cfg.speed, 20) });

  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) {
    out.push({ kind: "char", char: line[i], delayMs: delay(BASE_CHAR_MS * 0.45) });
    i++;
  }
  for (; i < line.length; i++) {
    const ch = line[i];
    if (cfg.errorRate > 0 && rng.chance(cfg.errorRate)) {
      const wrong = makeTypo(ch, rng);
      if (wrong) out.push({ kind: "char", char: wrong, delayMs: delay(BASE_CHAR_MS * factor) });
      out.push({ kind: "pause", delayMs: rng.float(300, 1500) / Math.min(cfg.speed, 10) });
      const back = wrong === "" ? rng.int(1, 2) : rng.int(1, 4);
      for (let b = 0; b < back; b++) out.push({ kind: "backspace", delayMs: delay(BASE_CHAR_MS * 0.35) });
      out.push({ kind: "char", char: ch, delayMs: delay(BASE_CHAR_MS * factor) });
      if (rng.chance(0.35)) out.push({ kind: "pause", delayMs: rng.float(80, 260) / Math.min(cfg.speed, 10) });
      continue;
    }
    let base = BASE_CHAR_MS * factor;
    if (ch === ":" || ch === ",") base *= 1.5;
    else if (ch === ")" || ch === "]") base *= 1.25;
    else if (ch === "(" || ch === "[") base *= 1.1;
    out.push({ kind: "char", char: ch, delayMs: delay(base) });
  }
  out.push({ kind: "newline", delayMs: delay(BASE_CHAR_MS * 0.9 * factor) });
  return out;
}

/* ================= 语法高亮 ================= */
const KW = /^(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)$/;
const BI = /^(self|cls|print|len|range|str|int|float|list|dict|set|tuple|super|type|isinstance|getattr|setattr|open|sorted|enumerate|zip|min|max|sum|any|all|map|filter)$/;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function hl(line) {
  let out = "", i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === "#") { out += '<span class="c">' + esc(line.slice(i)) + "</span>"; break; }
    if (ch === '"' || ch === "'") {
      const q = ch;
      if (line.substr(i, 3) === q.repeat(3)) {
        const e = line.indexOf(q.repeat(3), i + 3);
        const end = e === -1 ? n : e + 3;
        out += '<span class="s">' + esc(line.slice(i, end)) + "</span>";
        i = end; continue;
      }
      let j = i + 1;
      while (j < n && line[j] !== q) { if (line[j] === "\\") j++; j++; }
      out += '<span class="s">' + esc(line.slice(i, j + 1)) + "</span>";
      i = j + 1; continue;
    }
    if (ch === "@") {
      let m = i + 1;
      while (m < n && /[A-Za-z0-9_.]/.test(line[m])) m++;
      out += '<span class="d">' + esc(line.slice(i, m)) + "</span>";
      i = m; continue;
    }
    if (ch >= "0" && ch <= "9") {
      let k = i;
      while (k < n && /[0-9._xXa-fA-F]/.test(line[k])) k++;
      out += '<span class="n">' + esc(line.slice(i, k)) + "</span>";
      i = k; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let m = i;
      while (m < n && /[A-Za-z0-9_]/.test(line[m])) m++;
      const w = line.slice(i, m);
      let cls = null;
      if (KW.test(w)) cls = "k";
      else if (BI.test(w)) cls = "d";
      else if (line[m] === "(") cls = "f";
      else if (w[0] >= "A" && w[0] <= "Z") cls = "t";
      out += cls ? '<span class="' + cls + '">' + esc(w) + "</span>" : esc(w);
      i = m; continue;
    }
    out += esc(ch); i++;
  }
  return out || "&nbsp;";
}

/* ================= 音效 ================= */
let audioCtx = null;
function click(volume) {
  if (volume <= 0) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1400 + Math.random() * 700, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.02 * volume, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.04);
  } catch (e) { /* 静音也要能跑 */ }
}

/* ================= 状态 ================= */
const S = {
  allFiles: [],
  playlist: [],
  fi: 0,
  li: 0,
  cfg: { speed: 1, errorRate: 0.012, seed: 42, thinkEveryLines: 47, driftEveryLines: 420, afterFinish: "stop" },
  volume: 0,
  paused: false,
  aborted: false,
  playing: false,
  root: "",
  name: "",
  totalLines: 0,
  doneLines: 0,
  startedAt: 0,
  elapsed: 0,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 2600);
};

/* ================= 界面元素 ================= */
const codeEl = $("code"), logEl = $("log"), treeEl = $("tree"), miniEl = $("mini");

function log(text, cls) {
  const d = document.createElement("div");
  d.className = "l";
  const s = document.createElement("span");
  if (cls) s.className = cls;
  s.textContent = text;
  d.appendChild(s);
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
}

/* ---------- 文件树：只显示"已经写出来"的文件 ---------- */
const treeDirs = new Set();

function treeEnsureDirs(path) {
  const parts = path.split("/");
  const frag = document.createDocumentFragment();
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc += (i ? "/" : "") + parts[i];
    if (treeDirs.has(acc)) continue;
    treeDirs.add(acc);
    const d = document.createElement("div");
    d.className = "row dir";
    d.dataset.dir = acc;
    d.style.paddingLeft = 8 + i * 12 + "px";
    d.innerHTML = '<span class="ic">▾</span>' + parts[i];
    frag.appendChild(d);
  }
  treeEl.appendChild(frag);
}

function treeAddFile(path) {
  if (treeEl.querySelector('[data-f="' + path.replace(/"/g, '\\"') + '"]')) return;
  treeEnsureDirs(path);
  const depth = path.split("/").length - 1;
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.f = path;
  row.style.paddingLeft = 8 + depth * 12 + 12 + "px";
  row.innerHTML = '<span class="ic">🐍</span>' + path.split("/").pop();
  treeEl.appendChild(row);
  treeEl.scrollTop = treeEl.scrollHeight;
}

function treeMarkDone(path) {
  const row = treeEl.querySelector('[data-f="' + path.replace(/"/g, '\\"') + '"]');
  if (row && !row.querySelector(".done")) {
    const s = document.createElement("span");
    s.className = "done";
    s.textContent = "✓";
    s.style.cssText = "margin-left:auto;color:#4ec9b0;font-size:11px";
    row.appendChild(s);
  }
}

function markTree(path) {
  for (const row of treeEl.querySelectorAll(".row[data-f]")) {
    row.classList.toggle("on", row.getAttribute("data-f") === path);
  }
}

function setFileHeader(path, idx, total) {
  const short = path.split("/").pop();
  $("tab").textContent = short;
  $("titleFile").textContent = short;
  $("titleMid").textContent = S.name + " — " + path + "   [" + (idx + 1) + "/" + total + "]";
  $("crumb").textContent = path.split("/").slice(0, -1).join(" › ");
  $("stFile").textContent = path;
}

function miniReset() { miniEl.innerHTML = ""; }
function miniAppend(line) {
  const i = document.createElement("i");
  i.style.width = Math.min(62, Math.max(4, line.length * 0.8)) + "px";
  i.style.marginLeft = Math.min(20, (line.length - line.trimStart().length) * 0.6) + "px";
  miniEl.appendChild(i);
  while (miniEl.children.length > 160) miniEl.removeChild(miniEl.firstChild);
}

function updateStatus(pct) {
  $("stLn").textContent = "Ln " + (S.li + 1) + ", Col 1";
  $("stPct").textContent = pct + "%";
}

/* ================= 播放 ================= */
async function play() {
  if (S.playing) return;
  S.playing = true;
  S.aborted = false;
  S.startedAt = Date.now();

  const rng = createRng(S.cfg.seed);
  const fast = S.cfg.speed >= 20;           // 高速：整行落字，不逐字符
  const ultra = S.cfg.speed >= 200;         // 极速：连行间停顿都省掉

  while (!S.aborted) {
    for (S.fi = 0; S.fi < S.playlist.length && !S.aborted; S.fi++) {
      const item = S.playlist[S.fi];
      const path = item.file.path;

      treeAddFile(path);
      setFileHeader(path, S.fi, S.playlist.length);
      markTree(path);
      log("$ code --goto " + path, "mu");
      await sleep(ultra ? 20 : 260);
      if (S.aborted) return;

      for (S.li = 0; S.li < item.lines.length && !S.aborted; S.li++) {
        if (S.paused && (await gate())) return;

        const line = item.lines[S.li];
        const row = document.createElement("div");
        row.className = "ln cur";
        row.innerHTML = '<span class="g">' + (S.li + 1) + '</span><span class="t"></span>';
        const target = row.querySelector(".t");
        codeEl.appendChild(row);
        const prev = codeEl.querySelectorAll(".ln.cur");
        if (prev.length > 1) prev[prev.length - 2].classList.remove("cur");

        if (fast) {
          // 高速：整行一次落，只保留一点点随机感
          target.innerHTML = hl(line);
          codeEl.scrollTop = codeEl.scrollHeight;
          miniAppend(line);
          S.doneLines++;
          updateStatus(pct());
          if (!ultra) await raf();
          continue;
        }

        const keys = lineToKeys(line, S.li, S.cfg, rng);
        let text = "";
        for (const k of keys) {
          if (S.aborted) return;
          if (S.paused && (await gate())) return;
          if (k.kind === "char") {
            text += k.char;
            target.innerHTML = hl(text);
            click(S.volume);
          } else if (k.kind === "backspace") {
            text = text.slice(0, -1);
            target.innerHTML = hl(text);
          } else if (k.kind === "pause" && k.delayMs >= 2000) {
            idleHint(k.delayMs);
          }
          if (k.delayMs > 0) await sleep(k.delayMs);
        }

        target.innerHTML = hl(text);
        codeEl.scrollTop = codeEl.scrollHeight;
        miniAppend(text);
        S.doneLines++;
        updateStatus(pct());
      }

      treeMarkDone(path);
      log("  wrote " + item.lines.length + " lines to " + path.split("/").pop(), "ok");
    }

    if (S.aborted) break;

    if (S.cfg.afterFinish === "loop") {
      log("── 一轮播完，从头再来 ──", "mu");
      codeEl.innerHTML = "";
      miniReset();
      treeEl.innerHTML = "";
      treeDirs.clear();
      S.doneLines = 0;
      await sleep(ultra ? 150 : 900);
      continue;
    }

    log("── 播放结束（设置：写完停止）──", "ok");
    S.playing = false;
    updateStatus(pct());
    return;
  }
  S.playing = false;
}

function pct() {
  return S.totalLines ? Math.min(100, Math.floor((S.doneLines / S.totalLines) * 100)) : 0;
}

async function gate() {
  while (S.paused && !S.aborted) await sleep(40);
  return S.aborted;
}

function idleHint(ms) {
  const el = document.createElement("div");
  el.className = "l mu";
  el.textContent = "  ⏸ 走神 " + (ms / 1000).toFixed(1) + "s";
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ================= 暂停 → 存档 ================= */
function pauseMenu() {
  if (!S.playing) return;
  S.paused = true;
  $("pauseInfo").textContent =
    (S.name || "未命名") + " · 第 " + (S.fi + 1) + "/" + S.playlist.length + " 个文件 · 第 " + (S.li + 1) + " 行";
  $("pause").classList.add("on");
}

function resumeFromPause() {
  $("pause").classList.remove("on");
  S.paused = false;
}

async function exitWithSave() {
  S.elapsed += Date.now() - S.startedAt;
  const payload = {
    root: S.root, name: S.name, fileIndex: S.fi, line: S.li,
    elapsed: S.elapsed, cfg: S.cfg, files: S.playlist.length,
  };
  const r = await window.pywebview.api.save_session(payload);
  toast(r && r.ok ? "进度已保存（最多 10 个）" : "保存失败");
  doExit();
}

function doExit() {
  S.aborted = true;
  S.paused = false;
  $("pause").classList.remove("on");
  $("app").classList.remove("on");
  $("splash").style.display = "flex";
  refreshSlots();
}

/* ================= 启动界面 ================= */
let picked = null;

async function pickFolder() {
  const r = await window.pywebview.api.pick_folder();
  if (!r || !r.ok) return;

  $("srcName").textContent = "扫描中…";
  const s = await window.pywebview.api.scan(r.path);
  if (!s.ok) { toast("扫描失败：" + s.error); $("srcName").textContent = "未选择"; return; }

  const d = s.data;
  picked = d;
  S.root = d.root;
  S.name = d.name;
  S.allFiles = d.files;

  $("srcName").textContent = d.name;
  $("srcMeta").textContent = d.stats.files + " 个文件 · " + d.stats.lines + " 行 · 跳过 " + d.stats.skipped;
  $("startBtn").disabled = d.files.length === 0;
  toast(d.files.length ? "扫描完成，可以开始" : "这个目录里没有 .py 文件");
}

function startPlay() {
  if (!picked || picked.files.length === 0) return;

  S.playlist = picked.files.map((f) => {
    const lines = f.lines.length > 350
      ? [...f.lines.slice(0, 300), "# … skipped " + (f.lines.length - 350) + " lines …", ...f.lines.slice(-50)]
      : f.lines;
    return { file: f, lines };
  });
  S.totalLines = S.playlist.reduce((n, it) => n + it.lines.length, 0);
  S.fi = 0; S.li = 0; S.elapsed = 0; S.doneLines = 0;

  const afSel = $("afterFinish");
  if (afSel) {
    afSel.value = S.cfg.afterFinish || "stop";
    afSel.addEventListener("change", (e) => { S.cfg.afterFinish = e.target.value; });
  }

  $("splash").style.display = "none";
  $("app").classList.add("on");
  codeEl.innerHTML = "";
  miniReset();
  treeEl.innerHTML = "";
  treeDirs.clear();
  logEl.innerHTML = "";

  const sp = S.cfg.speed;
  const speedText = sp >= 100 ? Math.round(sp) + "×(极速)" : sp.toFixed(1) + "×";

  log("魈公引擎 · 只读播放", "mu");
  log("  来源 " + S.root, "mu");
  log("  " + picked.stats.files + " 个文件 / " + picked.stats.lines + " 行（跳过 " + picked.stats.skipped + "）", "mu");
  log("  速度 " + speedText + " · 错误率 " + (S.cfg.errorRate * 100).toFixed(1) + "% · 种子 " + S.cfg.seed, "mu");
  log("  项目规模：" + picked.stats.files + " 个 .py / " + picked.stats.lines + " 行", "mu");
  log("  一个文件写完，才出现下一个", "mu");
  log("  按 X 暂停", "mu");

  play().catch((e) => log("出错：" + e.message, "bad"));
}

async function resumeLast() {
  const info = await window.pywebview.api.info();
  const last = (info.sessions || [])[0];
  if (!last) { toast("还没有上次的进度"); return; }

  const s = await window.pywebview.api.scan(last.root);
  if (!s.ok) { toast("上次的目录没了：" + last.root); return; }

  const d = s.data;
  picked = d;
  S.root = d.root; S.name = d.name; S.allFiles = d.files;
  S.cfg = Object.assign(S.cfg, last.cfg || {});
  S.elapsed = last.elapsed || 0;

  $("srcName").textContent = d.name;
  $("srcMeta").textContent = d.stats.files + " 个文件 · 从第 " + (last.fileIndex + 1) + " 个文件继续";

  startPlay();
  if (last.fileIndex > 0 || last.line > 0) {
    log("  从上次位置继续：第 " + (last.fileIndex + 1) + " 个文件，第 " + (last.line + 1) + " 行", "wr");
  }
}

async function refreshSlots() {
  try {
    const info = await window.pywebview.api.info();
    window.__ver = info.version;
    $("ver").textContent = "v" + info.version;
    const sessions = info.sessions || [];
    $("resumeBtn").disabled = sessions.length === 0;
    $("slotInfo").textContent = sessions.length
      ? "存档 " + sessions.length + "/" + info.maxSlots + " · 最近：" + (sessions[0].name || "—")
      : "暂无存档（" + info.maxSlots + " 个名额）";
  } catch (e) { /* 首次加载 api 还没就绪 */ }
}

/* ---------- 速度：滑块是对数刻度，另外可以直接输数字 ---------- */
function sliderToSpeed(v) {
  // 0..1000 → 0.1..1000（对数）
  const t = Number(v) / 1000;
  return Number((Math.pow(10, -1 + t * 4)).toFixed(t > 0.75 ? 0 : 2));
}

function speedToSlider(speed) {
  const v = (Math.log10(Math.max(0.1, speed)) + 1) / 4;
  return Math.round(Math.min(1, Math.max(0, v)) * 1000);
}

function applySpeed(speed) {
  S.cfg.speed = Math.min(1000, Math.max(0.1, Number(speed) || 1));
  $("speed").value = String(speedToSlider(S.cfg.speed));
  const s = S.cfg.speed;
  $("speedVal").textContent = (s >= 100 ? Math.round(s).toString() : s.toFixed(s < 10 ? 1 : 0)) + "×";
  $("speedNum").value = String(s);
}

function bindSplash() {
  $("pickBtn").onclick = pickFolder;
  $("startBtn").onclick = startPlay;
  $("resumeBtn").onclick = resumeLast;
  $("quitBtn").onclick = () => window.pywebview.api.quit();

  $("speed").oninput = (e) => applySpeed(sliderToSpeed(e.target.value));
  $("speedNum").onchange = (e) => applySpeed(e.target.value);

  $("errRate").oninput = (e) => {
    S.cfg.errorRate = Number(e.target.value) / 100;
    $("errVal").textContent = Number(e.target.value).toFixed(1) + "%";
  };
  $("vol").oninput = (e) => {
    S.volume = Number(e.target.value) / 100;
    $("volVal").textContent = S.volume > 0 ? Math.round(S.volume * 100) + "%" : "关";
    if (S.volume > 0) click(S.volume);
  };

  // 常用倍速快捷键
  document.querySelectorAll("[data-speed]").forEach((b) => {
    b.onclick = () => applySpeed(b.dataset.speed);
  });

  applySpeed(1);
}

/* ================= 快捷键 ================= */
document.addEventListener("keydown", (e) => {
  if (e.key === "x" || e.key === "X") {
    if (S.playing && !S.paused) { pauseMenu(); e.preventDefault(); }
  } else if (e.key === "Escape") {
    if ($("pause").classList.contains("on")) { resumeFromPause(); e.preventDefault(); }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  bindSplash();
  $("pResume").onclick = resumeFromPause;
  $("pSave").onclick = exitWithSave;
  $("pNoSave").onclick = doExit;

  window.addEventListener("pywebviewready", refreshSlots);
  refreshSlots();
  setTimeout(refreshSlots, 600);
});
