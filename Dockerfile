# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：静态前端 + 同源转发代理。AI 请求仍由浏览器发出（Key 在用户本机），
# 经 /proxy 转到本容器内的 canvas-proxy，再发往上游。
FROM nginx:1.27-alpine

RUN apk add --no-cache nodejs

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-proxy-limit.conf /etc/nginx/conf.d/00-proxy-limit.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
COPY canvas-proxy /opt/canvas-proxy
COPY docker/start-app.sh /start-app.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh /start-app.sh

EXPOSE 3000
CMD ["/start-app.sh"]
