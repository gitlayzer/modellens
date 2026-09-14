# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3777

WORKDIR /app

# 零依赖项目：仅拷贝运行所需文件
COPY server.js ./
COPY public ./public

# 以非 root 用户运行
USER node

EXPOSE 3777

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
