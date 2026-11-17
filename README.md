# 魈公引擎 · fakecode

> 把真实的代码按人类的节奏"打"出来。
> 两个版本：VS Code 扩展 + Windows 桌面版。

**作者：魈公**　**仓库：fakecode**　**协议：MIT（允许商用，保留署名）**

---

## 它是什么

一个"假装在写代码"的工具：读取你指定的目录里真实的 Python 文件，按模拟的打字节奏逐字写进一个虚拟文档里——带停顿、带思考、偶尔打错再删掉重打。

**不联网、不写源目录、不在磁盘留任何东西。**

---

## 两个版本

| | VS Code 扩展 | 桌面版 |
|---|---|---|
| 位置 | `vscode/` | `desktop/` |
| 运行 | VS Code 内，伪装成工作区文件 | 独立 exe，自带界面 |
| 适合 | 你本来就在用 VS Code | 打开就能演，不装编辑器 |
| 打包 | `python package.py` | `pyinstaller xiaogong-engine.spec` |

---

## VS Code 扩展

### 安装

```
下载 fakecode-*.vsix
VS Code → 扩展 → 右上角 … → 从 VSIX 安装
```

### 命令

```
魈公引擎：开始（选目录）      Ctrl+Alt+Shift+X
魈公引擎：快速开始           Ctrl+Alt+N
魈公引擎：暂停 / 继续
魈公引擎：停止
魈公引擎：老板键             Ctrl+Shift+H
```

### 参数

```
速度       0.1 ~ 1000 倍
错误率     默认 0.012
随机种子   同一种子 = 同样的节奏
分文件     每个文件一个虚拟文档，还是全塞一个
```

### 打包

```
python package.py     → 生成 .vsix
```

---

## 桌面版

### 运行

```
python app.py
```

### 打包

```
pyinstaller xiaogong-engine.spec
```

### 功能

```
启动画面 + 参数面板（速度 / 错误率 / 种子 / 分文件）
暂停 / 停止 / 老板键（X 叠层）
10 个存档位（存在 %APPDATA%\xiaogong\sessions）
```

---

## 三条红线

```
1  对源目录只读        不写、不删、不移动
2  不在磁盘留东西      目标内容只存在于虚拟文档里
3  不联网              没有 fetch / http / 任何网络调用
```

---

## 许可证

**MIT。允许商用。**

```
✓  可以：使用、修改、分发、商用、打包出售、集成进商业产品
✓  必须：保留版权声明和 LICENSE 全文（署 魈公 / @wyhr-game）
✗  不可：把改版直接叫「魈公引擎」并声称自己原创
          （这是商标和不正当竞争的事，不在许可证范围内）
```

详见 [LICENSE.md](LICENSE.md)。

## 目录

```
vscode/          VS Code 扩展
  extension.js   命令注册与播放
  src/engine.js  扫描、节奏、错误注入、回放
  src/render.js  虚拟文档写入（TextDocumentContentProvider）
  src/ui.js      状态栏、输出通道、资源管理器视图
  src/panel.js   参数面板（Webview）
  sample/        自写示例代码（可合法公开）
  package.py     打包脚本
desktop/         Windows 桌面版
  app.py         pywebview 壳 + 扫描 + 存档
  ui/            前端（splash / 树 / 面板）
  xiaogong-engine.spec  PyInstaller 配置
```

---

## 开发说明

**扩展必须是 CommonJS。** `package.json` 里不要写 `"type": "module"`，代码里不要用 `import.meta.url`——否则 VS Code 会把整个文件当成 ESM，`require()` 静默失败，表现为"装了没反应"。

**写入不用 `editor.edit()`。** 高频编辑会被拒绝，导致丢字符。这里用 `TextDocumentContentProvider`（scheme `xiaogong`）+ 限流触发 `onDidChange`，不会被拒。

**节奏由种子决定。** 用 mulberry32，不用 `Math.random`，保证同一份代码、同一个种子 = 同一段表演。

---

## 更新记录

见 [vscode/CHANGELOG.md](vscode/CHANGELOG.md)。

---

## 联系

**GitHub：@wyhr-game**　**Issue 优先。**
