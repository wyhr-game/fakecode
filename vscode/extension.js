/**
 * 魈公引擎 · 扩展入口（1.0.0 重构版）
 *
 * 结构只剩三个模块：
 *   src/engine.js  扫描 + 节奏 + 推进（纯逻辑，不碰 vscode）
 *   src/render.js  唯一输出通道：只读虚拟文档 + 节流刷新
 *   src/ui.js      状态栏 / 左侧列表 / 输出通道
 *   extension.js   命令与编排（这个文件）
 *
 * 三条红线：只读源目录 · 不落盘（虚拟文档）· 不联网
 */

const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");

const engine = require("./src/engine.js");
const { ensureDocProvider, Renderer } = require("./src/render.js");
const ui = require("./src/ui.js");
const { openSettingsPanel } = require("./src/panel.js");

/** engine 只读这个状态，不负责改它 */
const state = { paused: false, aborted: false, running: false };
let ctxRef = null;
let lastTarget = "";

/* ================= 内置示例 ================= */

function loadSample() {
  const dir = path.join(__dirname, "sample");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".py")).sort();
  } catch {
    return null;
  }
  const files = [];
  for (const n of names) {
    try {
      const lines = fs.readFileSync(path.join(dir, n), "utf8").split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      files.push({ path: n, lines });
    } catch {
      /* 跳过坏文件 */
    }
  }
  return files.length ? { name: "示例项目", files } : null;
}

/* ================= 配置 ================= */

function readConfig() {
  const c = vscode.workspace.getConfiguration("xiaogong");
  return {
    seed: c.get("seed", 42),
    speed: Math.min(1000, Math.max(0.1, c.get("speed", 1))),
    errorRate: Math.min(0.05, Math.max(0, c.get("errorRate", 0.012))),
    thinkEveryLines: c.get("thinkEveryLines", 47),
    driftEveryLines: c.get("driftEveryLines", 420),
    multi: c.get("multiDocument", true),
    afterFinish: c.get("afterFinish", "stop"),
  };
}

/* ================= 播放 ================= */

async function play(files, projectName, cfg) {
  if (!files || !files.length) {
    vscode.window.showWarningMessage("没有可播放的 .py 文件。");
    return;
  }
  if (state.running) {
    vscode.window.showInformationMessage("魈公引擎已经在跑了，先停止再开新的。");
    return;
  }

  state.running = true;
  state.paused = false;
  state.aborted = false;

  const tree = ui.ensureTree(ctxRef);
  if (typeof tree.setFiles === "function") tree.setFiles(files.map((f) => f.path));
  else tree.reset();
  try { await vscode.commands.executeCommand("workbench.view.explorer"); } catch { /* 忽略 */ }

  let renderer = null;
  let content = "";
  const multi = cfg.multi !== false;

  try {
    renderer = await Renderer.open(multi ? files[0].path : projectName);
  } catch (err) {
    state.running = false;
    ui.log("打开虚拟文档失败：" + err.message);
    vscode.window.showErrorMessage("魈公引擎：打不开文档 —— " + err.message);
    return;
  }

  ui.log("开始：" + projectName + " · " + files.length + " 个文件 · 速度 " + cfg.speed + "×" + (multi ? " · 分文件" : " · 单文档"));
  let lastFile = null;

  try {
    await engine.run({
      files,
      cfg,
      state,
      onChunk: (t) => { content += t; renderer.chunk(t); },
      onBackspace: (n) => {
        content = content.slice(0, Math.max(0, content.length - n));
        renderer.backspace(n);
      },
      onFileStart: async (file, index) => {
        if (!multi) {
          // 单文档：只在中间插一行分隔注释
          if (lastFile) tree.finish(lastFile);
          lastFile = file;
          tree.touch(file);
          const sep = (content ? "\n" : "") + "# ── " + file + " ──\n";
          content += sep;
          renderer.chunk(sep);
          ui.log("$ code --goto " + file);
          return;
        }
        // 分文件：先把这个文件写完的内容留在自己的标签页里，再开下一个
        try {
          if (renderer) renderer.flushNow();
          renderer = await Renderer.open(file);
        } catch (err) {
          ui.log("打开 " + file + " 的标签页失败：" + err.message);
        }
        if (lastFile) tree.finish(lastFile);
        lastFile = file;
        tree.touch(file);
        ui.log("$ code --goto " + file);
      },
      onMistake: (m) => {
        // 记一笔：错的 → 对的
        ui.log(
          "打错 " + JSON.stringify(m.wrong) + " → 改成 " + JSON.stringify(m.correct) +
            "（第 " + (m.at + 1) + " 个字符）",
        );
      },
      onProgress: (p) => {
        ui.setStatus(
          "魈公引擎：" +
            p.file.split("/").pop() +
            " · " +
            p.line +
            " 行 · " +
            Math.round(p.percent) +
            "%" +
            (state.paused ? " · PAUSED" : ""),
        );
      },
    });

    renderer.flushNow();
    if (lastFile) tree.finish(lastFile);

    if (!state.aborted) {
      const expect = files.map((f) => f.lines.join("\n")).join("\n");
      const strip = (s) => s.replace(/^# ── .+ ──$/gm, "").replace(/\n{2,}/g, "\n").trim();
      const ok = strip(content) === strip(expect);
      ui.log(
        "自检：" +
          (ok
            ? "内容与源文件一致"
            : "内容有差异（期望 " + strip(expect).length + " 字 / 实际 " + strip(content).length + " 字）"),
      );
      vscode.window.showInformationMessage(
        "魈公引擎：写完了。" + (ok ? "内容与源文件一致。" : "自检有差异，详见「输出 → 魈公引擎」。"),
      );
    }
  } catch (err) {
    ui.log("中断：" + (err && err.message));
    vscode.window.showWarningMessage("魈公引擎：中断 —— " + (err && err.message ? err.message : "未知原因"));
  } finally {
    state.running = false;
    state.paused = false;
    ui.setStatus("魈公引擎：待机");
  }

  // 写完之后的动作：停止 / 循环
  if (!state.aborted && cfg.afterFinish === "loop") {
    ui.log("写完，按设置循环播放：" + projectName);
    setTimeout(() => {
      if (state.running) return;
      play(files, projectName, cfg).catch((e) => ui.log("循环失败：" + (e && e.message)));
    }, 800);
  }
}

/* ================= 命令 ================= */

async function cmdStart() {
  if (state.running) {
    const pick = await vscode.window.showQuickPick(["重新选择目录", "继续当前播放"], {
      placeHolder: "魈公引擎正在运行",
    });
    if (pick !== "重新选择目录") return;
    stop();
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "用这个目录播放（只读）",
    title: "选择要重放的代码目录",
  });
  if (!picked || !picked.length) return;

  const root = picked[0].fsPath;
  let scan;
  try {
    scan = engine.scanSource(root);
  } catch (err) {
    vscode.window.showErrorMessage("扫描失败：" + err.message);
    return;
  }
  if (!scan.files.length) {
    vscode.window.showWarningMessage("这个目录里没有可播放的 .py 文件。");
    return;
  }

  await ctxRef.globalState.update("xiaogong.lastRoot", root);
  const files = scan.files.map((f) => ({ path: f.path, lines: engine.trimLargeFile(f.lines).lines }));
  await play(files, path.basename(root) || "xiaogong", readConfig());
}

async function cmdQuickStart() {
  const lastRoot = ctxRef.globalState.get("xiaogong.lastRoot", "");
  if (lastRoot && fs.existsSync(lastRoot)) {
    try {
      const scan = engine.scanSource(lastRoot);
      if (scan.files.length) {
        const files = scan.files.map((f) => ({ path: f.path, lines: engine.trimLargeFile(f.lines).lines }));
        await play(files, path.basename(lastRoot) || "xiaogong", readConfig());
        return;
      }
    } catch {
      /* 落到示例 */
    }
  }
  const sample = loadSample();
  if (!sample) {
    vscode.window.showWarningMessage("没有可用的示例，请先用「开始（选目录）」选一次。");
    return;
  }
  await play(sample.files, sample.name, readConfig());
}

/** 设置面板：来源目录 / 速度 / 错误率 / 种子 / 分文件 */
async function cmdSettings() {
  openSettingsPanel(ctxRef, async (root, cfgOverride) => {
    const cfg = { ...readConfig(), ...(cfgOverride || {}) };
    if (cfgOverride && typeof cfgOverride.multi === "boolean") {
      cfg.multi = cfgOverride.multi;
    }

    let files = null;
    let name = "示例项目";

    if (root) {
      try {
        const scan = engine.scanSource(root);
        if (scan.files.length) {
          files = scan.files.map((f) => ({ path: f.path, lines: engine.trimLargeFile(f.lines).lines }));
          name = path.basename(root) || "xiaogong";
          await ctxRef.globalState.update("xiaogong.lastRoot", root);
        }
      } catch (err) {
        ui.log("扫描失败：" + err.message);
        vscode.window.showErrorMessage("扫描失败：" + err.message);
      }
    }

    if (!files) {
      const sample = loadSample();
      if (!sample) {
        vscode.window.showWarningMessage("没有可播放的内容。");
        return;
      }
      files = sample.files;
      name = sample.name;
    }

    await play(files, name, cfg);
  });
}

function cmdPause() {
  if (!state.running) {
    vscode.window.showInformationMessage("魈公引擎没在跑。");
    return;
  }
  state.paused = !state.paused;
  ui.setStatus(state.paused ? "魈公引擎：PAUSED" : "魈公引擎：播放中");
  ui.log(state.paused ? "暂停" : "继续");
}

function stop() {
  state.aborted = true;
  state.paused = false;
  ui.setStatus("魈公引擎：已停止");
  ui.log("已停止");
}

async function cmdBossKey() {
  state.paused = true;
  ui.setStatus("魈公引擎：PAUSED");
  const target = vscode.workspace.getConfiguration("xiaogong").get("bossKeyTarget", "") || lastTarget;
  if (!target) {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(
      () => undefined,
      () => undefined,
    );
    return;
  }
  try {
    if (/^https?:\/\//i.test(target)) await vscode.env.openExternal(vscode.Uri.parse(target));
    else {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    lastTarget = target;
  } catch (err) {
    vscode.window.showErrorMessage("老板键切走失败：" + err.message);
  }
}

/* ================= 生命周期 ================= */

function activate(context) {
  ctxRef = context;
  ensureDocProvider(context);
  ui.ensureChannel();
  ui.ensureStatusBar(context);
  ui.ensureTree(context);
  ui.setStatus("魈公引擎：待机（命令面板搜「魈公引擎」）");
  ui.log(
    "扩展已激活 · 版本 " +
      (context.extension && context.extension.packageJSON ? context.extension.packageJSON.version : "?"),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xiaogong.start", cmdStart),
    vscode.commands.registerCommand("xiaogong.quickStart", cmdQuickStart),
    vscode.commands.registerCommand("xiaogong.settings", cmdSettings),
    vscode.commands.registerCommand("xiaogong.pause", cmdPause),
    vscode.commands.registerCommand("xiaogong.stop", stop),
    vscode.commands.registerCommand("xiaogong.bossKey", cmdBossKey),
  );
}

function deactivate() {
  state.aborted = true;
}

module.exports = { activate, deactivate };
