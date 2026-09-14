# Model Lens

输入任意 OpenAI 兼容端点的 Base URL 与密钥，即刻列出该端点支持的全部模型。

## 运行

```bash
node server.js          # 默认 http://127.0.0.1:3777
PORT=8080 node server.js  # 自定义端口
```

要求 Node.js >= 18（使用内置 fetch），零 npm 依赖。

## 地址兼容

| 输入 | 实际请求 |
| --- | --- |
| `https://api.xxx.com/v1/models` | 原样 |
| `https://api.xxx.com/v1` | 自动补 `/models` |
| `api.xxx.com` | 自动补 `https://` 与 `/v1/models` |

鉴权支持 `Authorization: Bearer` 与 `x-api-key` 两种请求头。密钥仅经本地服务转发，不会被存储。

## 开发

样式使用 Tailwind CSS v3 本地预构建，修改 `src/styles.css` 或页面 class 后重新构建：

```bash
npx tailwindcss@3 -c tailwind.config.js -i src/styles.css -o public/assets/app.css --minify
```

## 结构

```
server.js            # 本地代理 + 静态服务（gzip、安全头、/healthz）
public/index.html    # 页面
public/app.js        # 前端逻辑
public/assets/app.css# 构建产物（勿手改）
src/styles.css       # Tailwind 源样式
tailwind.config.js
```
