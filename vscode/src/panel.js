/**
 * panel.js —— 设置面板（Webview）
 *
 * 一屏看完：来源目录、生成速度（0.1~1000，滑块+数字框）、错误率、随机种子、分文件开关，
 * 然后「开始 / 取消」。它只收集参数，开播由扩展传进来的 onStart 回调做。
 */

const vscode = require("vscode");
const path = require("node:path");
const engine = require("./engine.js");
const ui = require("./ui.js");

const CSS = `
:root{--bg:#0b0f14;--line:#22303c;--ink:#dbe7f2;--dim:#7d8fa0;--dim2:#4b5a68;
--acc:#0a84ff;--ok:#5fd0a0;--mono:Consolas,"Cascadia Mono",monospace;--ui:"Segoe UI","Microsoft YaHei",sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(900px 500px at 50% 0%,rgba(10,132,255,.10),transparent 65%),var(--bg);
color:var(--ink);font-family:var(--ui);padding:26px 30px 22px;user-select:none}
.brand{display:flex;align-items:baseline;gap:12px}
h1{font-size:26px;font-weight:600}
.en{font-size:11px;letter-spacing:.22em;color:var(--dim2)}
.ver{margin-left:auto;font-size:11px;color:var(--dim2)}
.tag{margin-top:8px;font-size:13px;color:var(--dim)}
.free{display:inline-block;margin-top:12px;font-size:11.5px;padding:3px 9px;border-radius:5px;
color:var(--ok);border:1px solid #1f4a3a;background:rgba(95,208,160,.08)}
.src{margin-top:16px;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:#0c1218;
display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--dim)}
.src b{color:var(--ink);font-weight:400;font-size:13px}
.src .meta{margin-left:auto;color:var(--dim2);font-size:11.5px}
.row{display:flex;align-items:center;gap:12px;margin-top:13px;font-size:12.5px;color:var(--dim)}
.row label{width:82px;flex:none}
input[type=range]{flex:1;accent-color:var(--acc)}
.num{width:76px;background:#0c1218;border:1px solid var(--line);color:var(--ink);border-radius:6px;
padding:4px 7px;font-family:var(--mono);font-size:12px}
.val{width:60px;text-align:right;color:#cfe0ee;font-family:var(--mono);font-size:12px}
.chips{display:flex;gap:6px;margin-top:9px;margin-left:94px;flex-wrap:wrap}
.chips button{font-size:11.5px;padding:3px 9px;border-radius:6px;cursor:pointer;background:#141d26;
color:#9fb2c4;border:1px solid #22303c;font-family:var(--ui)}
.chips button:hover{background:#1b2734;color:#d7e6f4}
.btns{display:flex;gap:10px;margin-top:20px}
button.main{font-size:13px;padding:9px 20px;border-radius:8px;cursor:pointer;font-family:var(--ui);
border:1px solid #2b3a49;background:#16202a;color:#c8d8e6}
button.main:hover{background:#1d2a36}
button.main.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.foot{margin-top:16px;font-size:11px;color:var(--dim2);line-height:1.7}
select{background:#0c1218;border:1px solid var(--line);color:var(--ink);border-radius:6px;
padding:4px 8px;font-family:var(--ui);font-size:12px}
`;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(nonce, st) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${CSS}</style></head><body>
<div class="brand"><h1>魈公引擎</h1><span class="en">XIAOGONG ENGINE</span><span class="ver">v${st.version}</span></div>
<div class="tag">把代码按人的节奏，重放一遍</div>
<div class="free">纯公益 · 永久免费 · 禁止商用 · 源码公开</div>

<div class="src">
  <span>代码来源</span>
  <b id="srcName">${st.root ? esc(path.basename(st.root)) : "未选择（用内置示例）"}</b>
  <span class="meta" id="srcMeta">${esc(st.meta || "")}</span>
  <button class="main" id="pick" style="margin-left:12px;padding:5px 12px;font-size:12px">选择目录…</button>
</div>

<div class="row"><label>生成速度</label>
  <input type="range" id="speed" min="0" max="1000" step="1" value="500">
  <input class="num" type="number" id="speedNum" min="0.1" max="1000" step="0.1" value="${st.speed}">
  <span class="val" id="speedVal">${st.speed}×</span>
</div>
<div class="chips">
  <button data-s="0.5">0.5×</button><button data-s="1">1×</button><button data-s="3">3×</button>
  <button data-s="10">10×</button><button data-s="100">100×</button><button data-s="1000">1000×</button>
  <span style="font-size:11px;color:var(--dim2);align-self:center;margin-left:6px">0.1 ~ 1000，也能直接填</span>
</div>

<div class="row"><label>错误率</label>
  <input type="range" id="err" min="0" max="5" step="0.1" value="${(st.errorRate * 100).toFixed(1)}">
  <span class="val" id="errVal">${(st.errorRate * 100).toFixed(1)}%</span>
</div>

<div class="row"><label>随机种子</label>
  <input class="num" type="number" id="seed" min="0" step="1" value="${st.seed}">
  <span class="val" style="width:auto;color:var(--dim2);text-align:left">同种子同节奏</span>
</div>

<div class="row"><label>分文件</label>
  <select id="multi">
    <option value="1"${st.multi ? " selected" : ""}>每个文件一个新标签页</option>
    <option value="0"${st.multi ? "" : " selected"}>全程一个文档</option>
  </select>
  <span class="val" style="width:auto;color:var(--dim2);text-align:left">分文件更像在新建文件</span>
</div>

<div class="row"><label>写完</label>
  <select id="after">
    <option value="stop"${st.afterFinish === "stop" ? " selected" : ""}>停止</option>
    <option value="loop"${st.afterFinish === "loop" ? " selected" : ""}>继续播放（循环）</option>
  </select>
  <span class="val" style="width:auto;color:var(--dim2);text-align:left">默认写完就停</span>
</div>

<div class="btns">
  <button class="main primary" id="start">开始</button>
  <button class="main" id="cancel">取消</button>
</div>

<div class="foot">作者 魈公 · 只读源目录 · 不落盘（虚拟文档）· 不联网</div>

<script nonce="${nonce}">
const api = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let speed = ${st.speed}, errorRate = ${st.errorRate}, seed = ${st.seed};
let root = ${st.root ? JSON.stringify(st.root) : "null"};
let multi = ${st.multi ? "true" : "false"};
let afterFinish = ${JSON.stringify(st.afterFinish || "stop")};

function sliderToSpeed(v){ const t = v/1000; return Number(Math.pow(10, -1 + t*4).toFixed(t > 0.75 ? 0 : 2)); }
function speedToSlider(s){ const v = (Math.log10(Math.max(0.1, s)) + 1) / 4; return Math.round(Math.min(1, Math.max(0, v)) * 1000); }
function applySpeed(s){
  speed = Math.min(1000, Math.max(0.1, Number(s) || 1));
  $("speed").value = String(speedToSlider(speed));
  $("speedNum").value = String(speed);
  $("speedVal").textContent = (speed >= 100 ? Math.round(speed) : speed.toFixed(speed < 10 ? 1 : 0)) + "×";
}
$("speed").addEventListener("input", (e) => applySpeed(sliderToSpeed(e.target.value)));
$("speedNum").addEventListener("change", (e) => applySpeed(e.target.value));
document.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => applySpeed(b.dataset.s)));
$("err").addEventListener("input", (e) => {
  errorRate = Number(e.target.value) / 100;
  $("errVal").textContent = Number(e.target.value).toFixed(1) + "%";
});
$("seed").addEventListener("change", (e) => { seed = Number(e.target.value) || 0; });
$("multi").addEventListener("change", (e) => { multi = e.target.value === "1"; });
$("after").addEventListener("change", (e) => { afterFinish = e.target.value; });

$("pick").addEventListener("click", () => {
  $("srcMeta").textContent = "正在打开选择框…";
  api.postMessage({ type: "pick" });
});
$("start").addEventListener("click", () => api.postMessage({ type: "start", root, cfg: { speed, errorRate, seed, multi, afterFinish } }));
$("cancel").addEventListener("click", () => api.postMessage({ type: "cancel" }));

window.addEventListener("message", (ev) => {
  const m = ev.data || {};
  if (m.type === "picked") {
    root = m.root;
    $("srcName").textContent = m.name;
    $("srcMeta").textContent = m.meta;
  } else if (m.type === "error") {
    $("srcMeta").textContent = m.message;
  }
});
applySpeed(speed);
</script>
</body></html>`;
}

function openSettingsPanel(context, onStart) {
  const c = vscode.workspace.getConfiguration("xiaogong");
  const lastRoot = context.globalState.get("xiaogong.lastRoot", "");

  const panel = vscode.window.createWebviewPanel("xiaogong.settings", "魈公引擎 · 设置", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  panel.webview.html = renderHtml(nonce, {
    version:
      (context.extension && context.extension.packageJSON && context.extension.packageJSON.version) || "1.1.0",
    root: lastRoot,
    meta: context.globalState.get("xiaogong.lastMeta", ""),
    speed: c.get("speed", 1),
    errorRate: c.get("errorRate", 0.012),
    seed: c.get("seed", 42),
    multi: c.get("multiDocument", true),
    afterFinish: c.get("afterFinish", "stop"),
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg) return;
      if (msg.type === "cancel") {
        panel.dispose();
        return;
      }

      if (msg.type === "pick") {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: "用这个目录播放（只读）",
          title: "选择要重放的代码目录",
        });
        if (!picked || !picked.length) {
          panel.webview.postMessage({ type: "error", message: "没有选中目录" });
          return;
        }
        const root = picked[0].fsPath;
        try {
          const scan = engine.scanSource(root);
          const lines = scan.files.reduce((n, f) => n + f.lines.length, 0);
          const meta = scan.files.length + " 个文件 · " + lines + " 行";
          await context.globalState.update("xiaogong.lastMeta", meta);
          panel.webview.postMessage({ type: "picked", root, name: path.basename(root), meta });
        } catch (err) {
          panel.webview.postMessage({ type: "error", message: "扫描失败：" + err.message });
        }
        return;
      }

      if (msg.type === "start") {
        panel.dispose();
        await onStart(msg.root || null, msg.cfg || {});
      }
    } catch (err) {
      ui.log("面板出错：" + (err && err.message));
      try {
        panel.webview.postMessage({ type: "error", message: "出错：" + (err && err.message) });
      } catch {
        /* 面板可能已关 */
      }
    }
  });
}

module.exports = { openSettingsPanel };
