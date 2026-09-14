// Model Lens — 查询任意 OpenAI 兼容端点支持的大模型列表
// 零依赖：Node.js >= 18（内置 fetch）即可运行
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3777;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

// 把用户输入规范化为完整的 /models 端点：
//   https://api.xxx.com/v1/models  -> 原样使用
//   https://api.xxx.com/v1         -> 追加 /models
//   https://api.xxx.com            -> 追加 /v1/models
function normalizeModelsUrl(input) {
  let u = String(input || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('Base URL 不能为空');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (/\/models$/i.test(u)) return u;
  if (/\/v\d+[a-z0-9]*$/i.test(u)) return u + '/models';
  return u + '/v1/models';
}

function buildHeaders(apiKey, headerType) {
  const headers = { Accept: 'application/json' };
  if (apiKey) {
    if (headerType === 'x-api-key') headers['x-api-key'] = apiKey;
    else headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function handleModelsQuery(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return sendJson(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
  }

  const { baseUrl, apiKey = '', headerType = 'authorization' } = payload;

  let targetUrl;
  try {
    targetUrl = normalizeModelsUrl(baseUrl);
    // 校验 URL 合法性，只允许 http/https
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https');
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: `URL 无效：${err.message}` });
  }

  const started = Date.now();
  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: buildHeaders(apiKey, headerType),
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    const latencyMs = Date.now() - started;
    const text = await upstream.text();

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return sendJson(res, 200, {
        ok: false,
        url: targetUrl,
        status: upstream.status,
        latencyMs,
        error: '上游返回的不是 JSON',
        upstreamBody: text.slice(0, 600),
      });
    }

    if (!upstream.ok) {
      return sendJson(res, 200, {
        ok: false,
        url: targetUrl,
        status: upstream.status,
        latencyMs,
        error: `上游返回 HTTP ${upstream.status}`,
        upstreamBody: data,
      });
    }

    // 兼容 OpenAI 风格 { data: [...] } 与部分厂商的 { models: [...] }
    const rawList = Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.models) ? data.models
      : [];

    const models = rawList.map((m) => ({
      id: m.id ?? m.name ?? String(m),
      owned_by: m.owned_by ?? m.owner ?? null,
      created: m.created ?? m.created_at ?? null,
    }));

    return sendJson(res, 200, {
      ok: true,
      url: targetUrl,
      status: upstream.status,
      latencyMs,
      count: models.length,
      models,
      raw: data,
    });
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return sendJson(res, 200, {
      ok: false,
      url: targetUrl,
      latencyMs: Date.now() - started,
      error: isTimeout ? '请求超时（15s），请检查地址是否可达' : `网络错误：${err.message}`,
    });
  }
}

function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg']);

function serveStatic(req, res, pathname) {
  const filePath = path.join(
    PUBLIC_DIR,
    pathname === '/' ? 'index.html' : path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  );
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { ok: false, error: 'Not Found' });
  }

  const ext = path.extname(filePath);
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // HTML 每次校验，静态资源缓存 1 小时
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  };

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (acceptsGzip && COMPRESSIBLE.has(ext)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
  }

  headers['Content-Length'] = fs.statSync(filePath).size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && pathname === '/api/models') {
    return handleModelsQuery(req, res);
  }
  if (req.method === 'GET' && pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  sendJson(res, 404, { ok: false, error: 'Not Found' });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换端口启动：PORT=8080 node server.js`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Model Lens 已启动: http://127.0.0.1:${PORT}`);
});
