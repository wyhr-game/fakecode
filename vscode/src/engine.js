/**
 * engine.js —— 引擎：扫描 / 规划节奏 / 逐字推进
 *
 * 这个文件是整个项目的核心，也是唯一有"智能"的地方。
 * 三条原则：
 *   1. 不匀速（对数正态，有长尾）
 *   2. 有语义（写 def 比写 import 慢）
 *   3. 可复现（同种子同事件序列）
 *
 * 它不碰任何 UI：调用方传一个 onChunk / onBackspace，它只负责"什么时候该敲什么"。
 */

const fs = require("node:fs");
const path = require("node:path");

/* ================= 随机数 ================= */

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
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * Math.PI * v);
      return mag * Math.cos(2 * Math.PI * v);
    },
  };
}

/* ================= 扫描（只读） ================= */

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", ".venv", "venv", "env", "node_modules", "__pycache__",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", "build", "dist",
  "site-packages", ".idea", ".vscode", ".eggs", "htmlcov",
]);

const LIMITS = {
  maxFileBytes: 1_048_576,
  maxFileLines: 20_000,
  maxTotalBytes: 52_428_800,
};

const WEIGHT = (rel) => {
  const p = rel.toLowerCase().replace(/\\/g, "/");
  if (/\/(models|entities|domain)\//.test(p)) return 0;
  if (/\/(services|core|lib|internal)\//.test(p)) return 1;
  if (/\/(routes|api|views|handlers|controllers)\//.test(p)) return 2;
  if (/\/(utils|helpers|common|config)\//.test(p)) return 3;
  if (/\/(tests?|specs?|__tests__)\//.test(p)) return 8;
  if (/\/(examples?|docs?|scripts?|migrations?)\//.test(p)) return 9;
  return 5;
};

function scanSource(root, opts) {
  const cfg = { ...LIMITS, ...(opts || {}) };
  const absRoot = path.resolve(root);
  if (!fs.statSync(absRoot).isDirectory()) throw new Error("不是目录：" + absRoot);

  const cands = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(abs);
        continue;
      }
      if (!e.isFile() || path.extname(e.name) !== ".py") continue;
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      if (size > cfg.maxFileBytes) continue;
      cands.push({ rel: path.relative(absRoot, abs).split(path.sep).join("/"), abs, size });
    }
  };
  walk(absRoot);

  cands.sort((a, b) => {
    const wa = WEIGHT(a.rel), wb = WEIGHT(b.rel);
    if (wa !== wb) return wa - wb;
    return a.rel < b.rel ? -1 : 1;
  });

  const files = [];
  let total = 0;
  for (const c of cands) {
    if (total + c.size > cfg.maxTotalBytes) break;
    let text;
    try {
      text = fs.readFileSync(c.abs, "utf8"); // 只读
    } catch {
      continue;
    }
    const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length > cfg.maxFileLines) continue;
    files.push({ path: c.rel, lines });
    total += c.size;
  }
  return { root: absRoot, files, totalBytes: total };
}

/** 大文件只播头尾：人不会一口气看完两千行 */
function trimLargeFile(lines, o) {
  const { threshold = 350, head = 300, tail = 50 } = o || {};
  if (lines.length <= threshold) return { lines, skipped: 0 };
  const headEnd = Math.min(head, lines.length);
  const tailStart = Math.max(headEnd, lines.length - tail);
  return {
    lines: [...lines.slice(0, headEnd), "# … skipped " + (tailStart - headEnd) + " lines …", ...lines.slice(tailStart)],
    skipped: tailStart - headEnd,
  };
}

/* ================= 节奏 ================= */

const BASE_CHAR_MS = 62;
const KIND_FACTOR = { import: 0.72, decl: 1.8, comment: 0.8, blank: 0.15, control: 1.15, return: 1.0, body: 1.0 };
const NEIGHBORS = { a:"s",s:"d",d:"f",f:"g",g:"h",h:"j",q:"w",w:"e",e:"r",r:"t",t:"y",z:"x",x:"c",c:"v",v:"b",i:"o",o:"p",j:"k",k:"l",n:"m",m:"n",u:"i",y:"u" };

const DEFAULT_RHYTHM = {
  seed: 42, speed: 1, errorRate: 0.012,
  thinkEveryLines: 47, driftEveryLines: 420,
};

function classifyLine(line) {
  if (!line.trim()) return "blank";
  if (/^\s*#/.test(line)) return "comment";
  if (/^\s*(import|from)\s+\S/.test(line)) return "import";
  if (/^\s*(async\s+)?(def|class)\s+\w+/.test(line)) return "decl";
  if (/^\s*(if|elif|else|for|while|try|except|finally|with|match|case)\b/.test(line)) return "control";
  if (/^\s*(return|yield|raise|pass|continue|break)\b/.test(line)) return "return";
  return "body";
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function stepDelay(median, cfg, rng) {
  const raw = median * Math.exp(rng.normal() * 0.42);
  const v = raw / cfg.speed;
  return clamp(Number.isFinite(v) ? v : 20, 0.05, 900);
}

function makeTypo(ch, rng) {
  const lower = ch.toLowerCase();
  const r = rng.next();
  if (r < 0.3) return "";
  if (r < 0.5) return ch === lower ? ch.toUpperCase() : ch.toLowerCase();
  const nb = NEIGHBORS[lower];
  return nb ? (ch === lower ? nb : nb.toUpperCase()) : ch;
}

/**
 * 规划一行。事件类型：type / wrong / backspace / newline / pause / line
 * 保证：把所有事件重放一遍，结果与原文一字不差（有单测盯着）。
 */
function planLine(line, lineNo, cfg, rng) {
  const ev = [];
  const factor = KIND_FACTOR[classifyLine(line)] || 1;

  if (lineNo > 0 && lineNo % Math.max(1, cfg.thinkEveryLines) === 0) {
    ev.push({ type: "pause", delay: rng.float(120, 450) });
  }
  if (lineNo > 0 && lineNo % Math.max(1, cfg.driftEveryLines) === 0) {
    ev.push({ type: "pause", delay: rng.float(3000, 15000) });
  }

  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) {
    ev.push({ type: "type", text: line[i++], delay: stepDelay(BASE_CHAR_MS * 0.45, cfg, rng) });
  }

  for (; i < line.length; i++) {
    const ch = line[i];

    if (cfg.errorRate > 0 && rng.chance(cfg.errorRate)) {
      const wrong = makeTypo(ch, rng);

      if (wrong === "") {
        // 漏打：什么都不敲，补上这个字就行（不能退格，退了会吃掉前面的字）
        ev.push({ type: "pause", delay: rng.float(200, 900) });
        ev.push({ type: "type", text: ch, delay: stepDelay(BASE_CHAR_MS * factor, cfg, rng) });
        continue;
      }

      // 打错：敲错 → 发现 → 退一格 → 重敲
      ev.push({ type: "wrong", text: wrong, delay: stepDelay(BASE_CHAR_MS * factor, cfg, rng) });
      ev.push({ type: "pause", delay: rng.float(300, 1500) });
      ev.push({ type: "backspace", count: 1, delay: stepDelay(BASE_CHAR_MS * 0.3, cfg, rng) });
      ev.push({ type: "type", text: ch, delay: stepDelay(BASE_CHAR_MS * factor, cfg, rng) });

      // 整词重打：退 extra+1 格，就补 extra+1 个，账要对平
      if (i >= 2 && rng.chance(0.22)) {
        const extra = Math.min(rng.int(1, 2), i - 1);
        const redo = line.slice(i - extra, i);
        ev.push({ type: "pause", delay: rng.float(120, 320) });
        for (let b = 0; b < extra + 1; b++) {
          ev.push({ type: "backspace", count: 1, delay: stepDelay(BASE_CHAR_MS * 0.3, cfg, rng) });
        }
        for (const rc of redo) ev.push({ type: "type", text: rc, delay: stepDelay(BASE_CHAR_MS * factor, cfg, rng) });
        ev.push({ type: "type", text: ch, delay: stepDelay(BASE_CHAR_MS * factor, cfg, rng) });
      }

      if (rng.chance(0.35)) ev.push({ type: "pause", delay: rng.float(80, 260) });
      continue;
    }

    let base = BASE_CHAR_MS * factor;
    if (ch === ":" || ch === ",") base *= 1.5;
    else if (ch === ")" || ch === "]") base *= 1.25;
    else if (ch === "(" || ch === "[") base *= 1.1;
    ev.push({ type: "type", text: ch, delay: stepDelay(base, cfg, rng) });
  }

  ev.push({ type: "newline", delay: stepDelay(BASE_CHAR_MS * 0.9 * factor, cfg, rng) });
  ev.push({ type: "line", lineNo });
  return ev;
}

function planLines(lines, cfg, rng, startLineNo) {
  const out = [];
  const base = startLineNo || 0;
  for (let i = 0; i < lines.length; i++) out.push(...planLine(lines[i], base + i, cfg, rng));
  return out;
}

/** 重放事件成文本（自检用） */
function replayEvents(events) {
  let buf = "";
  for (const e of events) {
    if (e.type === "type" || e.type === "wrong") buf += e.text;
    else if (e.type === "backspace") buf = buf.slice(0, Math.max(0, buf.length - (e.count || 1)));
    else if (e.type === "newline") buf += "\n";
  }
  return buf;
}

/* ================= 推进 ================= */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 跑一整趟。
 * @param {object} o
 * @param {Array<{path:string,lines:string[]}>} o.files
 * @param {object} o.cfg 节奏配置
 * @param {(t:string)=>void} o.onChunk 输出文字
 * @param {(n:number)=>void} o.onBackspace 退格
 * @param {(p:{file:string,line:number,percent:number,files:number,fileIndex:number})=>void} o.onProgress
 * @param {{paused:boolean,aborted:boolean}} o.state 外部可改的状态
 */
async function run(o) {
  const { files, cfg, onChunk, onBackspace, onProgress, state } = o;
  const playable = files.filter((f) => f && Array.isArray(f.lines) && f.lines.length);
  if (!playable.length) return;

  const total = playable.reduce((n, f) => n + f.lines.length, 0);
  const rng = createRng(cfg.seed || 42);
  let done = 0;
  let globalLine = 0;

  const wait = async (ms) => {
    let left = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    while (left > 0) {
      if (state.aborted) return false;
      while (state.paused) {
        if (state.aborted) return false;
        await sleep(40);
      }
      const step = Math.min(left, 40);
      await sleep(step);
      left -= step;
    }
    if (state.aborted) return false;
    while (state.paused) {
      if (state.aborted) return false;
      await sleep(40);
    }
    return !state.aborted;
  };

  for (let fi = 0; fi < playable.length; fi++) {
    const f = playable[fi];
    if (typeof o.onFileStart === "function") await o.onFileStart(f.path, fi, playable.length);
    state.currentFile = f.path;
    for (let li = 0; li < f.lines.length; li++) {
      const ev = planLine(f.lines[li], globalLine++, cfg, rng);
      for (const e of ev) {
        if (!(await wait(e.delay))) return;
        if (e.type === "type" || e.type === "wrong") onChunk(e.text);
        else if (e.type === "backspace") onBackspace(e.count || 1);
        else if (e.type === "newline") onChunk("\n");
      }
      done++;
      onProgress({
        file: f.path,
        line: li + 1,
        percent: Math.min(100, (done / total) * 100),
        fileIndex: fi,
        files: playable.length,
      });
    }
  }
}

module.exports = {
  createRng, scanSource, trimLargeFile,
  classifyLine, planLine, planLines, replayEvents,
  run, DEFAULT_RHYTHM,
};
