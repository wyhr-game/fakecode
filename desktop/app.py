"""
魈公引擎 · 桌面版宿主。

职责：
  1. 开一个自己的窗口（pywebview + Edge WebView2），里面是 VS Code 皮肤的界面
  2. 提供三件 Python 才能干的事：选目录、扫目录、读写存档
  3. 除此之外什么都不做——节奏、动画、界面全在 ui/ 里

安全边界（写在这里，防止以后被改坏）：
  · 扫描只读：只用 os.walk / open(..., 'r')，没有任何写入源目录的代码
  · 不联网：不 import requests / urllib / socket
  · 存档只写自己的目录：%APPDATA%\\xiaogong\\
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

try:
    import webview
except Exception:  # pragma: no cover
    print("需要 pywebview：pip install pywebview")
    raise

APP_NAME = "魈公引擎"
APP_VERSION = "0.1.0"
AUTHOR = "魈公"

# ---------- 路径 ----------

def base_dir() -> str:
    """打包成 exe 后，资源在 sys._MEIPASS 下。"""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def ui_dir() -> str:
    return os.path.join(base_dir(), "ui")


def data_dir() -> str:
    """存档目录，永远不放在源码里。"""
    root = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(root, "xiaogong")
    os.makedirs(d, exist_ok=True)
    return d


def sessions_dir() -> str:
    d = os.path.join(data_dir(), "sessions")
    os.makedirs(d, exist_ok=True)
    return d


# ---------- 扫描（严格只读） ----------

SKIP_DIRS = {
    ".git", ".hg", ".svn", ".venv", "venv", "env",
    "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", ".tox", "build", "dist", "site-packages",
    ".idea", ".vscode", ".eggs", "htmlcov",
}

MAX_FILE_BYTES = 1_048_576
MAX_FILE_LINES = 20_000
MAX_TOTAL_BYTES = 52_428_800
# 一次最多回传多少行给前端：再多浏览器也扛不住，播放也用不着
MAX_LINES_TO_UI = 60_000


def _weight(rel: str) -> int:
    p = rel.lower().replace("\\", "/")
    if "/models/" in p or "/entities/" in p or "/domain/" in p:
        return 0
    if "/services/" in p or "/core/" in p or "/lib/" in p:
        return 1
    if "/routes/" in p or "/api/" in p or "/views/" in p:
        return 2
    if "/utils/" in p or "/helpers/" in p or "/common/" in p:
        return 3
    if "/tests/" in p or "/test/" in p:
        return 8
    if "/examples/" in p or "/docs/" in p:
        return 9
    return 5


def scan_source(root: str) -> dict[str, Any]:
    """
    扫描目录。只读。

    返回 {root, files:[{path, lines:[...]}], skipped:[{path,reason}], stats:{...}}
    为了前端能承受，行数总量有上限，超出的文件只记入 skipped。
    """
    started = time.time()
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise ValueError("不是目录：" + root)

    cands: list[tuple[str, str, int]] = []
    skipped: list[dict[str, str]] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith(".") or not name.endswith(".py"):
                continue
            abs_path = os.path.join(dirpath, name)
            rel = os.path.relpath(abs_path, root).replace("\\", "/")
            try:
                size = os.path.getsize(abs_path)
            except OSError as err:
                skipped.append({"path": rel, "reason": "unreadable", "detail": str(err)})
                continue
            cands.append((_weight(rel), rel, abs_path, size))  # type: ignore[arg-type]

    cands.sort(key=lambda c: (c[0], c[1]))

    files: list[dict[str, Any]] = []
    total_bytes = 0
    total_lines = 0
    sent_lines = 0

    for _w, rel, abs_path, size in cands:
        if size > MAX_FILE_BYTES:
            skipped.append({"path": rel, "reason": "too-large", "detail": f"{size} > {MAX_FILE_BYTES}"})
            continue
        if total_bytes + size > MAX_TOTAL_BYTES:
            skipped.append({"path": rel, "reason": "total-budget-exceeded", "detail": ""})
            continue
        try:
            # 显式只读
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as fh:
                text = fh.read()
        except OSError as err:
            skipped.append({"path": rel, "reason": "unreadable", "detail": str(err)})
            continue

        lines = text.replace("\r\n", "\n").split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        if len(lines) > MAX_FILE_LINES:
            skipped.append({"path": rel, "reason": "too-many-lines", "detail": str(len(lines))})
            continue
        if sent_lines + len(lines) > MAX_LINES_TO_UI:
            skipped.append({"path": rel, "reason": "ui-budget-exceeded", "detail": ""})
            continue

        files.append({"path": rel, "lines": lines})
        total_bytes += size
        total_lines += len(lines)
        sent_lines += len(lines)

    return {
        "root": root,
        "name": os.path.basename(root) or root,
        "files": files,
        "skipped": skipped[:400],
        "stats": {
            "files": len(files),
            "lines": total_lines,
            "bytes": total_bytes,
            "skipped": len(skipped),
            "elapsedMs": int((time.time() - started) * 1000),
        },
    }


# ---------- 存档 ----------

MAX_SLOTS = 10


def _slot_path(slot_id: str) -> str:
    safe = "".join(ch for ch in slot_id if ch.isalnum() or ch in "-_")
    return os.path.join(sessions_dir(), f"{safe}.json")


def list_sessions() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        names = [n for n in os.listdir(sessions_dir()) if n.endswith(".json")]
    except OSError:
        return out
    for name in names:
        try:
            with open(os.path.join(sessions_dir(), name), "r", encoding="utf-8") as fh:
                d = json.load(fh)
            out.append(d)
        except Exception:
            continue
    out.sort(key=lambda d: d.get("savedAt", 0), reverse=True)
    return out


def save_session(payload: dict[str, Any]) -> dict[str, Any]:
    """最多保留 10 个，超了删最旧的。"""
    payload = dict(payload)
    payload["savedAt"] = int(time.time() * 1000)
    payload.setdefault("id", f"s{payload['savedAt']}")

    existing = list_sessions()
    while len(existing) >= MAX_SLOTS:
        oldest = min(existing, key=lambda d: d.get("savedAt", 0))
        try:
            os.remove(_slot_path(str(oldest.get("id"))))
        except OSError:
            pass
        existing = [e for e in existing if e.get("id") != oldest.get("id")]

    with open(_slot_path(str(payload["id"])), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    return payload


def delete_session(slot_id: str) -> bool:
    try:
        os.remove(_slot_path(slot_id))
        return True
    except OSError:
        return False


# ---------- 暴露给前端的 API ----------

class Api:
    def info(self) -> dict[str, Any]:
        return {
            "name": APP_NAME,
            "version": APP_VERSION,
            "author": AUTHOR,
            "sessions": list_sessions(),
            "maxSlots": MAX_SLOTS,
            "dataDir": data_dir(),
        }

    def pick_folder(self) -> dict[str, Any]:
        """原生选目录对话框。"""
        win = webview.windows[0] if webview.windows else None
        if win is None:
            return {"ok": False, "error": "没有窗口"}
        try:
            picked = win.create_file_dialog(webview.FOLDER_DIALOG)
        except Exception as err:
            return {"ok": False, "error": str(err)}
        if not picked:
            return {"ok": False, "cancelled": True}
        return {"ok": True, "path": picked[0]}

    def scan(self, path: str) -> dict[str, Any]:
        try:
            return {"ok": True, "data": scan_source(path)}
        except Exception as err:
            return {"ok": False, "error": str(err)}

    def save_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return {"ok": True, "data": save_session(payload)}
        except Exception as err:
            return {"ok": False, "error": str(err)}

    def delete_session(self, slot_id: str) -> dict[str, Any]:
        return {"ok": delete_session(slot_id)}

    def quit(self) -> None:
        for w in list(webview.windows):
            w.destroy()


def main() -> None:
    api = Api()
    index = os.path.join(ui_dir(), "index.html")
    if not os.path.exists(index):
        print("缺少界面文件：" + index)
        sys.exit(1)

    webview.create_window(
        f"{APP_NAME}  {APP_VERSION}",
        url=index,
        js_api=api,
        width=1440,
        height=900,
        min_size=(980, 620),
        background_color="#0b0f14",
        text_select=False,
    )
    webview.start()


if __name__ == "__main__":
    main()
