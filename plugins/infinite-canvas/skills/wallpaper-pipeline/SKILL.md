---
name: wallpaper-pipeline
description: 构建、重建或预览 girl_desk_wallpaper 网页壁纸（Blender 场景 → three.js → Wallpaper Engine），读取构建报告并把结果、截图路径和预览地址放到画布。用户要求构建/重新构建/打包/预览壁纸时使用。
---

# 壁纸构建与预览

壁纸项目把 Blender 场景导出为 three.js 网页壁纸，供 Wallpaper Engine 导入。本技能负责运行一键构建、汇报结果，并把结果放到当前画布。

## 前置条件

- 壁纸项目根目录：`C:\Users\asus\Documents\girl_desk_wallpaper`（用户给出其他路径时以用户为准）。所有命令都在该目录下执行，不要修改该项目的源码或配置来“修好”构建。
- 画布已连接 Canvas Agent；没有连接时先用 `open-canvas`。
- 画布要显示预览节点，需要在「节点插件」里启用「壁纸预览节点」（`plugins/canvas/wallpaper-preview`）。未启用时只写文本节点，并提醒用户启用。

## 1. 运行构建

```bash
npm run pipeline -- --skip-export --check
```

- 默认带 `--skip-export`（复用上次的 Blender 导出，最慢的一步）。只有用户说改过 Blender 场景、换了 `.blend`、或报告里没有可复用的导出时，才去掉 `--skip-export`。
- 始终带 `--check`：按机位截图并检查页面报错。
- 用户指定时透传 `--config <path>`、`--blend <path>`、`--blender <exe>`；不要自行猜测 Blender 路径。
- 完整导出可能耗时较长，命令运行期间告诉用户正在构建，不要重复启动第二次构建。

## 2. 读取报告

命令结束后（无论退出码），读取 `work/pipeline/report.json`：

```json
{ "ok": true, "error": "仅失败时出现", "steps": [{ "name": "export", "ok": true, "ms": 0, "skipped": true, "log": "..." }], "outputs": { "wallpaper": "<绝对路径>", "zip": "<绝对路径>", "screenshots": ["<png 绝对路径>"] } }
```

- 报告不存在或无法解析：说明构建在写报告前就失败了，附上命令输出的最后几十行，不要声称已构建。
- `ok: false`：先给出顶层 `error`（有时），再逐个列出 `ok: false` 的步骤名、耗时和 `log` 的关键错误行（只摘要，不整段粘贴）；有截图时一并列出。不要在画布上写“构建成功”。
- 带 `skipped: true` 的步骤（如 `--skip-export` 时的 `export`，`ms` 为 0）是跳过，不是失败也不是 0 ms 完成；汇报和摘要里写「已跳过（复用上次导出）」。
- 报告的时间早于本次运行（例如文件修改时间没变）时，提示报告可能是旧的。

## 3. 写到画布

先用 `canvas_get_state` 读取画布，新节点放在已有节点右侧并留出间距。

1. 用 `canvas_create_text_node` 写一个结果摘要节点，标题「壁纸构建结果」，内容包含：成功/失败（失败时附 `error`）、各步骤名与耗时（跳过的步骤标「已跳过」）、`wallpaper` 目录、`zip` 路径、截图路径列表。
2. 截图：当前画布工具没有“从本机路径创建图片节点”的操作（`canvas_create_attachment_nodes` 只接受对话附件，`add_node` 的 `metadata.content` 写本机路径浏览器无法读取）。因此不要创建空图片节点或写本机路径当图片地址；只在摘要里列出截图路径，并告诉用户可以把这些 PNG 拖进画布。
3. 预览：
   - 先检查 `http://localhost:4173/` 是否可访问；不可访问时在项目根目录后台启动 `npm run preview`（会一直运行，不要等待它退出），再确认可以访问。
   - 用 `canvas_create_text_node` 创建一个内容为 `http://localhost:4173/` 的文本节点，标题「壁纸预览地址」，并用 `canvas_connect_nodes` 连到已有的「壁纸预览」节点（`type` 为 `wallpaper-preview:viewer`）；预览节点会优先使用上游文本里的地址。
   - 画布上没有「壁纸预览」节点时，请用户从创建菜单添加一个并连上该文本节点。当前 `canvas_apply_ops` 的 `add_node` 只支持内置节点类型，Agent 不能直接创建插件节点。
   - 预览节点里可以切换机位（正面 / 书桌 / 卧室 / 书架），也可直接在地址后加参数，例如 `?camera=CAM_Front&anime=0&parallax=0&fps=30`。

## 4. 告诉用户如何导入 Wallpaper Engine

构建成功后，在回复末尾给出手动步骤（Agent 无法替用户操作 Wallpaper Engine）：

1. 打开 Wallpaper Engine，点左下角「打开壁纸」→「从文件打开」。
2. 选择 `<outputs.wallpaper>\index.html`（即壁纸项目下的 `wallpaper\index.html`）。
3. 需要分发时使用 `<outputs.zip>`。

## 注意

- 只汇报报告里真实存在的结果，不要编造步骤或路径。
- 不要关闭或重启用户已经打开的浏览器窗口和预览进程；`npm run preview` 已在运行就直接复用。
