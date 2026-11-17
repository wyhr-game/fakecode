/**
 * render.js —— 唯一的输出通道：只读虚拟文档 + 节流刷新。
 *
 * 为什么不用 editor.edit：
 *   它是跨进程编辑事务，高频调用会被拒（返回 false）。拒一次就少一个字，
 *   屏幕上就出现"少引号""只剩一行分隔注释"这种残缺。我在真实窗口里踩过两次。
 *
 * 这里的做法：
 *   我们持有完整文本，改完 fire 一次内容变更事件，
 *   VS Code 重新读这个虚拟文档 —— 不经过编辑事务，不会被拒。
 */

const vscode = require("vscode");

const SCHEME = "xiaogong";
const buffers = new Map();
const emitter = new vscode.EventEmitter();
let registered = false;

function ensureDocProvider(context) {
  if (registered) return;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      onDidChange: emitter.event,
      provideTextDocumentContent: (uri) => buffers.get(uri.toString()) || "",
    }),
  );
  registered = true;
}

class Renderer {
  constructor(uri) {
    this.uri = uri;
    this.text = "";
    this.last = 0;
    this.timer = null;
  }

  static async open(name) {
    const uri = vscode.Uri.parse(SCHEME + ":/" + (name || "xiaogong") + ".py");
    buffers.set(uri.toString(), "");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
    return new Renderer(uri);
  }

  _flush() {
    this.last = Date.now();
    buffers.set(this.uri.toString(), this.text);
    emitter.fire(this.uri);
  }

  _schedule() {
    if (Date.now() - this.last >= 60) {
      this._flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._flush();
    }, 60);
  }

  chunk(t) {
    this.text += t;
    this._schedule();
  }

  backspace(n) {
    this.text = this.text.slice(0, Math.max(0, this.text.length - n));
    this._schedule();
  }

  flushNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this._flush();
  }

  reveal() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const doc = ed.document;
    const end = new vscode.Position(Math.max(0, doc.lineCount - 1), 0);
    ed.revealRange(new vscode.Range(end, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

module.exports = { ensureDocProvider, Renderer, SCHEME };
