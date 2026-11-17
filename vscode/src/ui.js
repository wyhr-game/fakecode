/**
 * ui.js —— 状态栏、左侧列表、输出通道。
 *
 * 全都不参与播放逻辑，只负责"让人看得见"。
 */

const vscode = require("vscode");

/* ---------- 输出通道（排查问题的第一现场） ---------- */

let channel = null;
function ensureChannel() {
  if (!channel) channel = vscode.window.createOutputChannel("魈公引擎");
  return channel;
}
function log(msg) {
  const line = "[" + new Date().toTimeString().slice(0, 8) + "] " + msg;
  ensureChannel().appendLine(line);
  console.log(msg);
}

/* ---------- 状态栏 ---------- */

let statusBar = null;
function ensureStatusBar(context) {
  if (statusBar) return statusBar;
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "xiaogong.pause";
  statusBar.text = "魈公引擎：待机";
  statusBar.show();
  context.subscriptions.push(statusBar);
  return statusBar;
}
function setStatus(text, tip) {
  if (!statusBar) return;
  statusBar.text = text;
  if (tip) statusBar.tooltip = tip;
}

/* ---------- 左侧「魈公引擎」列表 ---------- */

class FileNode extends vscode.TreeItem {
  constructor(file, done, pending) {
    super(file.split("/").pop(), vscode.TreeItemCollapsibleState.None);
    this.file = file;
    this.description = done ? "✓ 写完" : pending ? "待写" : "写…";
    this.tooltip = file;
    this.iconPath = new vscode.ThemeIcon(done ? "check" : pending ? "circle-outline" : "edit");
  }
}

class FileProvider {
  constructor() {
    this.files = [];
    this._onChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onChange.event;
  }
  reset() { this.files = []; this._onChange.fire(); }

  /** 开播前把整份清单列出来，没写的标「待写」 */
  setFiles(paths) {
    this.files = paths.map((file) => ({ file, done: false, pending: true }));
    this._onChange.fire();
  }
  touch(file) {
    let hit = this.files.find((f) => f.file === file);
    if (!hit) {
      hit = { file, done: false, pending: false };
      this.files.push(hit);
    }
    hit.pending = false;
    this._onChange.fire();
  }
  finish(file) {
    const hit = this.files.find((f) => f.file === file);
    if (hit) hit.done = true;
    this._onChange.fire();
  }
  getTreeItem(node) { return node; }
  getChildren(node) {
    if (node) return [];
    return this.files.map((f) => new FileNode(f.file, f.done, f.pending));
  }
}

let provider = null;
function ensureTree(context) {
  if (provider) return provider;
  provider = new FileProvider();
  const view = vscode.window.createTreeView("xiaogong.files", { treeDataProvider: provider });
  context.subscriptions.push(view);
  return provider;
}

module.exports = { ensureChannel, log, ensureStatusBar, setStatus, ensureTree };
