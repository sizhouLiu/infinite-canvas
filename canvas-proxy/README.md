# @basketikun/canvas-proxy

Infinite Canvas 的转发代理。浏览器直连第三方 AI 接口时经常被 CORS 拦截，启动它之后，网页会把请求先发到代理，再由代理转发到目标地址。

代理只做转发：不改写请求体，不校验 API Key，不落盘任何日志。Docker 镜像里它和前端跑在同一个容器，经 nginx 的 `/proxy/` 对外。

## 使用

本机开发：

```bash
npx @basketikun/canvas-proxy@latest
```

默认监听 `http://127.0.0.1:23210`。把这个地址填进 Infinite Canvas 的「配置 → 本地代理」，并打开开关即可。

带上 `@latest` 是因为 npx 会缓存已下载的版本，不加就可能一直运行旧版本。

可选参数：

```bash
npx @basketikun/canvas-proxy@latest --port 23210 --host 127.0.0.1
```

也支持 `PORT` / `HOST` 环境变量。

Docker 部署时容器会自动启动这份代理，前端被预填为同源 `/proxy`，使用者不用再跑 npx。

## 转发规则

把完整目标地址接在代理地址后面：

```
http://127.0.0.1:23210/https://api.openai.com/v1/models
        └─── 代理地址 ──┘└──────── 目标地址 ────────┘
```

请求方法、请求头（除 `host` 等逐跳头外）、请求体原样转发；响应状态码、响应头和响应体原样返回，并补上宽松的 CORS 头。SSE 流式响应按块透传，不做缓冲。

访问根路径 `/` 会返回代理版本信息，可用于连通性检测，不会记入转发日志。

## 白名单与内网保护

无论是否设置白名单，下列目标一律拒绝（防 SSRF）：

- `localhost`、`.localhost`、`.local`
- 回环、链路本地、私有网段（`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`fc00::/7` 等）
- 解析结果落在上述网段的公网域名

`PROXY_ALLOW_HOSTS` 是逗号分隔的后缀名单。未设置时（本机 npx 默认）转发任意公网地址；Docker 镜像启动脚本会写入内置名单（`openai.com`、`googleapis.com`、`tripo3d.com`、`tripo3d.ai`），再用环境变量追加自定义渠道域名。

## 转发日志

每转发一条请求就在终端打印一行，包含时间、方法、完整目标地址、上游状态码和耗时：

```
4:05:42 PM GET https://api.openai.com/v1/models -> 200 0.9s
4:05:43 PM POST https://api.openai.com/v1/images/generations -> 200 26.4s
4:05:45 PM GET https://api.example.com/v1/models -> blocked (host is not allowed) 0.0s
```

日志在收到上游响应头时打印，所以流式请求会立刻出现一行，而不是等整段响应结束。日志只输出到终端，不落盘，也不包含请求头和请求体，因此不会泄露 API Key。

## 安全提示

本机使用时代理默认只监听 `127.0.0.1`。挂到公网时必须配白名单（镜像已默认配上），否则它会变成开放中继。API Key 依然由浏览器持有并随请求转发，代理本身不存储。

## 环境要求

Node.js >= 18。
