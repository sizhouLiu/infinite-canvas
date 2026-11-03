# 壁纸预览节点插件

Infinite Canvas 画布节点插件:在画布里预览网页壁纸,页面内可直接点击交互。

- 壁纸项目运行 `npm run preview` 后,预览服务(默认 `http://localhost:4173/`)用 `wallpapers.json` 列出所有已构建的壁纸。
- 顶部控制条:**壁纸**下拉框(选择已构建的壁纸)、**机位**下拉框(列出当前壁纸自己的机位,写入 `?camera=`)、刷新(重新读取壁纸列表并重载);控制条空白处拖动可移动节点。
- 放大:点「⤢ 放大」,或双击控制条空白处 / 壁纸里的空白处(点到物体时照常触发物体交互)。放大后按 Esc、点 ✕、点遮罩空白或再双击壁纸空白处返回。
- 换壁纸时清掉旧机位;存着的机位不属于当前壁纸时按默认机位处理。
- 连入上游文本节点时:文本是壁纸 id(如 `cafe-mellow-beans`)就选中该壁纸;文本是 `http(s)://` 地址则直接预览该页。作为上游时输出当前壁纸 id。
- 预览服务没开、或还没有构建好的壁纸时,节点里会提示该运行的命令。

## 构建

```bash
npm install
npm run build      # 产物 dist/wallpaper-preview.js,并同步到 web/public/plugins/wallpaper-preview.js
npm run dev        # watch
```

本地开发时画布会自动发现该插件,在「节点插件」管理器打开开关即可。插件契约见 `plugins/canvas/README.md`。
