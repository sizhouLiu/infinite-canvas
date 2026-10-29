# 壁纸预览节点插件

Infinite Canvas 画布节点插件:用 iframe 预览网页壁纸(默认 `http://localhost:4173/`,即壁纸项目 `npm run preview` 的地址),页面内可直接点击交互。

- 顶部控制条:地址(回车生效)、机位(写入 `?camera=`)、刷新;控制条空白处拖动可移动节点。
- 连入含 `http(s)://` 地址的上游文本节点时,优先使用该地址。
- 预览页无法访问时提示在壁纸项目运行 `npm run preview`。

## 构建

```bash
npm install
npm run build      # 产物 dist/wallpaper-preview.js,并同步到 web/public/plugins/wallpaper-preview.js
npm run dev        # watch
```

本地开发时画布会自动发现该插件,在「节点插件」管理器打开开关即可。插件契约见 `plugins/canvas/README.md`。
