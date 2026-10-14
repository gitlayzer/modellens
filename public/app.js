(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('query-form'), baseUrlEl = $('base-url'), apiKeyEl = $('api-key');
  const states = { empty: $('state-empty'), loading: $('state-loading'), error: $('state-error'), result: $('state-result') };

  let headerType = 'authorization';
  let allModels = [];
  let lastRaw = null;
  let querying = false;
  let toastTimer = null;
  let loadingTimer = null;

  const HISTORY_KEY = 'model-lens-history';
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }

  /* ---------- 与服务端一致的 URL 规范化（用于实时预览） ---------- */
  function normalizeUrl(input) {
    let u = String(input || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (/\/models$/i.test(u)) return u;
    if (/\/v\d+[a-z0-9]*$/i.test(u)) return u + '/models';
    return u + '/v1/models';
  }

  function renderUrlPreview() {
    const preview = $('url-preview');
    const normalized = normalizeUrl(baseUrlEl.value);
    preview.textContent = normalized || '等待输入…';
    preview.classList.toggle('text-emerald-300/70', !!normalized);
    preview.classList.toggle('text-zinc-600', !normalized);
  }
  baseUrlEl.addEventListener('input', renderUrlPreview);
  renderUrlPreview();

  /* ---------- 通用 ---------- */
  function showState(name) {
    Object.entries(states).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }

  function toast(msg) {
    const t = $('toast');
    t.firstElementChild.textContent = msg;
    t.classList.remove('translate-y-4', 'opacity-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('translate-y-4', 'opacity-0'), 1800);
  }

  function copyText(text, label) {
    const done = () => toast(label || '已复制到剪贴板');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { /* 忽略 */ }
    ta.remove();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatCreated(ts) {
    if (!ts) return null;
    const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  /* ---------- 鉴权方式分段控件（滑动指示器） ---------- */
  const tabs = document.querySelectorAll('.header-tab');
  const segPill = $('seg-pill');

  function renderTabs() {
    tabs.forEach((btn) => {
      const active = btn.dataset.header === headerType;
      btn.classList.toggle('text-ink-950', active);
      btn.classList.toggle('font-semibold', active);
      btn.classList.toggle('text-zinc-500', !active);
    });
    segPill.style.transform = headerType === 'authorization' ? 'translateX(0)' : 'translateX(100%)';
    $('header-preview').textContent = headerType === 'authorization'
      ? 'Authorization: Bearer sk-••••••'
      : 'x-api-key: sk-••••••';
  }
  tabs.forEach((btn) => btn.addEventListener('click', () => { headerType = btn.dataset.header; renderTabs(); }));
  renderTabs();

  /* ---------- 密钥可见性 ---------- */
  $('toggle-key').addEventListener('click', () => {
    const isPw = apiKeyEl.type === 'password';
    apiKeyEl.type = isPw ? 'text' : 'password';
    $('eye-open').classList.toggle('hidden', isPw);
    $('eye-closed').classList.toggle('hidden', !isPw);
  });

  /* ---------- 预设端点 ---------- */
  document.querySelectorAll('.preset-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      baseUrlEl.value = btn.dataset.url;
      renderUrlPreview();
      apiKeyEl.focus();
    }));

  /* ---------- 历史记录 ---------- */
  function saveHistory(url) {
    history = [url, ...history.filter((h) => h !== url)].slice(0, 5);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* 隐私模式 */ }
    renderHistory();
  }

  function renderHistory() {
    const block = $('history-block'), list = $('history-list');
    block.classList.toggle('hidden', history.length === 0);
    list.innerHTML = '';
    history.forEach((url) => {
      const li = document.createElement('li');
      li.innerHTML = `<button class="group flex w-full items-center gap-2 py-2.5 text-left" title="填入此地址">
        <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-500 group-hover:text-emerald-300 transition-colors">${escapeHtml(url)}</span>
        <svg class="shrink-0 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
      </button>`;
      li.firstElementChild.addEventListener('click', () => { baseUrlEl.value = url; renderUrlPreview(); });
      list.appendChild(li);
    });
  }
  renderHistory();

  /* ---------- 加载态轮换文案 ---------- */
  const LOADING_PHRASES = ['正在规范化请求地址', '正在连接目标端点', '等待上游响应', '正在解析模型列表', '正在探测用量接口'];
  function startLoadingPhrases() {
    let i = 0;
    const el = $('loading-text');
    el.textContent = LOADING_PHRASES[0];
    loadingTimer = setInterval(() => {
      i = (i + 1) % LOADING_PHRASES.length;
      el.style.opacity = '0';
      setTimeout(() => { el.textContent = LOADING_PHRASES[i]; el.style.opacity = '1'; }, 200);
    }, 1100);
  }
  function stopLoadingPhrases() {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  /* ---------- 用量 / 额度渲染 ---------- */
  const USAGE_KIND_LABEL = {
    subscription: 'billing/subscription',
    billing_usage: 'billing/usage',
    v1_usage: 'v1/usage',
    newapi_self: 'new-api user/self',
  };
  // 重置/到期类字段：值若能解析成时间则进入高亮块
  const RESET_RE = /(reset|renew|refresh|expire|access_until|valid_until|deadline|until|end_time|endtime)/i;
  // 额度/用量类字段：进入字段网格
  const AMOUNT_RE = /(balance|remain|quota|credit|limit|grant|usage|used|spend|cost|amount|total|request|token|days_until|status|mode|isvalid|window)/i;
  const NOISE_RE = /(password|secret|token_|session|email|avatar|group|setting|aff_)/i;
  const FIELD_LABELS = {
    hard_limit_usd: '硬限额', soft_limit_usd: '软限额', total_usage: '本月用量',
    total_granted: '总额度', total_used: '已用额度', quota: '剩余额度',
    used_quota: '已用额度', request_count: '请求次数', balance: '余额',
    remain_quota: '剩余额度', access_until: '有效至', expired_time: '过期时间',
    expires_at: '到期时间', days_until_expiry: '剩余天数', reset_at: '重置时间',
    cost: '费用', actual_cost: '实际费用', requests: '请求数', total_tokens: '总 Tokens',
    input_tokens: '输入 Tokens', output_tokens: '输出 Tokens', limit: '窗口限额',
    remaining: '窗口剩余', used: '窗口已用', window: '窗口周期', status: '状态',
    mode: '计费模式', isValid: '密钥有效', rpm: '当前 RPM', tpm: '当前 TPM',
  };

  // 展开 JSON 里的标量字段；超长数组（如 daily_usage 时间序列）整体跳过，避免刷屏
  function flattenScalars(obj, path, out) {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      if (obj.length > 5) return;
      obj.forEach((v, i) => flattenScalars(v, `${path}[${i}]`, out));
    } else if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) flattenScalars(obj[k], path ? `${path}.${k}` : k, out);
    } else if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') {
      out.push({ path, key: path.split(/[.\[\]]/).filter(Boolean).pop() || path, value: obj });
    }
  }

  function parseMaybeDate(value) {
    if (typeof value === 'number' && isFinite(value)) {
      if (value > 1e9 && value < 1e12) return new Date(value * 1000); // unix 秒
      if (value >= 1e12 && value < 1e14) return new Date(value);      // unix 毫秒
      return null;
    }
    if (typeof value === 'string') {
      if (/^\d{10,13}$/.test(value)) return parseMaybeDate(Number(value));
      const d = new Date(value);
      if (!isNaN(d) && /[-T:]/.test(value)) return d;
    }
    return null;
  }

  function formatDateTime(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function formatCountdown(target) {
    const ms = target - Date.now();
    if (ms <= 0) return '已到期';
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d > 0) return `${d} 天 ${h} 小时后`;
    if (h > 0) return `${h} 小时 ${m} 分后`;
    return `${m} 分钟后`;
  }

  function formatFieldValue(probe, f) {
    const v = f.value;
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'number') {
      // new-api 系：quota 以 1/500000 美元为单位
      if (probe.kind === 'newapi_self' && /quota/i.test(f.key)) {
        return `${v.toLocaleString()}（≈ $${(v / 500000).toFixed(2)}）`;
      }
      // OpenAI billing usage：total_usage 单位是美分
      if (probe.kind === 'billing_usage' && f.key === 'total_usage') {
        return `$${(v / 100).toFixed(2)}`;
      }
      // cost/balance/limit 类金额字段按美元展示
      if (/(cost|balance|amount)/i.test(f.key) || (probe.kind === 'v1_usage' && /^(limit|remaining|used)$/.test(f.key))) {
        return `$${Number(v.toFixed(4)).toLocaleString()}`;
      }
      if (/_usd$/i.test(f.key)) return `$${v.toLocaleString()}`;
      return v.toLocaleString();
    }
    return String(v);
  }

  function renderUsage(usage) {
    const card = $('usage-card');
    if (!usage || !Array.isArray(usage.probes)) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    const probes = usage.probes;
    const okProbes = probes.filter((p) => p.ok && p.data && typeof p.data === 'object');
    $('usage-probe-summary').textContent = `已探测 ${probes.length} 个接口 · ${okProbes.length} 个返回数据`;

    // 1) 重置/到期时间：所有成功探测里找候选，优先展示未来最近的
    const resetCandidates = [];
    okProbes.forEach((p) => {
      const flat = [];
      flattenScalars(p.data, '', flat);
      flat.forEach((f) => {
        if (!RESET_RE.test(f.key) || NOISE_RE.test(f.key)) return;
        const d = parseMaybeDate(f.value);
        if (d && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
          resetCandidates.push({ date: d, label: f.key, kind: p.kind });
        }
      });
    });
    resetCandidates.sort((a, b) => a.date - b.date);
    const future = resetCandidates.find((c) => c.date > Date.now());
    const chosen = future || resetCandidates[resetCandidates.length - 1];

    const resetBlock = $('usage-reset-block');
    if (chosen) {
      resetBlock.classList.remove('hidden');
      $('usage-reset-label').textContent =
        (future ? '下次重置时间' : '重置/到期时间') + (chosen.label ? ` · ${chosen.label}` : '');
      $('usage-reset-time').textContent = formatDateTime(chosen.date);
      $('usage-reset-countdown').textContent = formatCountdown(chosen.date);
      // 其余时间候选（如密钥到期时间）以小字行列出
      const othersBox = $('usage-reset-others');
      const others = resetCandidates.filter((c) => c !== chosen).slice(0, 3);
      othersBox.innerHTML = '';
      others.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'flex items-baseline justify-between gap-4 font-mono text-[11px] text-zinc-500';
        row.innerHTML = `<span>${escapeHtml(c.label)}</span><span class="tabular-nums">${formatDateTime(c.date)} · ${formatCountdown(c.date)}</span>`;
        othersBox.appendChild(row);
      });
    } else {
      resetBlock.classList.add('hidden');
    }

    // 2) 额度/用量字段网格
    const dl = $('usage-fields');
    dl.innerHTML = '';
    const seen = new Set();
    const labelCount = {};
    okProbes.forEach((p) => {
      const flat = [];
      flattenScalars(p.data, '', flat);
      flat.forEach((f) => {
        if (!AMOUNT_RE.test(f.key) || NOISE_RE.test(f.key)) return;
        if (RESET_RE.test(f.key) && parseMaybeDate(f.value)) return; // 时间类已进高亮块
        if (typeof f.value === 'string' && parseMaybeDate(f.value)) return; // 网格里不放日期字符串
        const dedup = `${p.kind}:${f.path}`;
        if (seen.has(dedup)) return;
        seen.add(dedup);
        let label = FIELD_LABELS[f.key] || f.key;
        labelCount[label] = (labelCount[label] || 0) + 1;
        // 同名字段（如 usage.today.cost 与 usage.total.cost）用路径区分
        if (labelCount[label] > 1) label = f.path.replace(/^data\./, '');
        const div = document.createElement('div');
        div.className = 'min-w-0';
        div.innerHTML = `
          <dt class="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600 truncate" title="${escapeHtml(p.kind)} · ${escapeHtml(f.path)}">${escapeHtml(label)}</dt>
          <dd class="mt-1 font-mono text-[13px] text-zinc-200 tabular-nums break-all">${escapeHtml(formatFieldValue(p, f))}</dd>`;
        dl.appendChild(div);
      });
    });

    $('usage-empty').classList.toggle('hidden', okProbes.length > 0);

    // 3) 每个探测源的状态 + 可折叠原始响应
    const box = $('usage-probes');
    box.innerHTML = '';
    probes.forEach((p) => {
      const row = document.createElement(p.ok ? 'details' : 'div');
      row.className = 'rounded-lg border border-white/[0.05] bg-ink-850/60';
      const head = `
        <span class="inline-flex items-center gap-2 min-w-0">
          <span class="h-1.5 w-1.5 rounded-full ${p.ok ? 'bg-emerald-400' : 'bg-zinc-600'}"></span>
          <span class="font-mono text-[11px] text-zinc-400 truncate">${escapeHtml(USAGE_KIND_LABEL[p.kind] || p.kind)}</span>
          ${p.ok ? `<span class="font-mono text-[10px] text-emerald-300/80">HTTP ${p.status}</span>` : `<span class="font-mono text-[10px] text-zinc-600">${escapeHtml(p.error || `HTTP ${p.status}`)}</span>`}
        </span>
        <span class="font-mono text-[10px] text-zinc-700 tabular-nums">${p.latencyMs} ms</span>`;
      if (p.ok) {
        row.innerHTML = `
          <summary class="flex items-center justify-between gap-3 cursor-pointer px-3.5 py-2.5 list-none hover:bg-white/[0.02] rounded-lg transition-colors">${head}</summary>
          <pre class="max-h-56 overflow-auto scroll-slim border-t border-white/[0.05] px-3.5 py-3 font-mono text-[11px] leading-relaxed text-zinc-500"></pre>`;
        row.querySelector('pre').textContent = JSON.stringify(p.data, null, 2);
      } else {
        row.innerHTML = `<div class="flex items-center justify-between gap-3 px-3.5 py-2.5">${head}</div>`;
      }
      box.appendChild(row);
    });
  }

  /* ---------- 提交查询 ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (querying) return;

    const baseUrl = baseUrlEl.value.trim();
    const urlErr = $('url-error');
    if (!baseUrl) {
      urlErr.textContent = '请输入 Base URL';
      urlErr.classList.remove('hidden');
      baseUrlEl.focus();
      return;
    }
    urlErr.classList.add('hidden');

    querying = true;
    $('submit-btn').disabled = true;
    $('btn-label').textContent = '正在请求端点';
    startLoadingPhrases();
    showState('loading');

    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKeyEl.value.trim(), headerType }),
      });
      const data = await res.json();

      if (!data.ok) {
        $('error-message').textContent = data.error || '未知错误';
        $('error-url').textContent = data.url ? `请求地址：${data.url}` : '';
        const body = data.upstreamBody;
        const bodyText = typeof body === 'string' ? body : body ? JSON.stringify(body, null, 2) : '';
        $('error-body').classList.toggle('hidden', !bodyText);
        $('error-body').textContent = bodyText;
        showState('error');
        return;
      }

      allModels = data.models || [];
      lastRaw = data.raw;
      const owners = new Set(allModels.map((m) => m.owned_by).filter(Boolean)).size;
      $('meta-count').textContent = data.count;
      $('meta-owners').textContent = owners > 0 ? ` · ${owners} 个提供方` : '';
      $('meta-status').textContent = `HTTP ${data.status}`;
      $('meta-latency').textContent = `${data.latencyMs} ms`;
      $('meta-url-text').textContent = data.url;
      $('raw-json').textContent = JSON.stringify(data.raw, null, 2);
      $('raw-json').classList.add('hidden');
      $('raw-toggle').textContent = '查看原始 JSON';
      $('filter-input').value = '';
      renderModels();
      renderUsage(data.usage);
      showState('result');
      saveHistory(baseUrl);
    } catch (err) {
      $('error-message').textContent = `本地服务异常：${err.message}`;
      $('error-url').textContent = '';
      $('error-body').classList.add('hidden');
      showState('error');
    } finally {
      querying = false;
      stopLoadingPhrases();
      $('submit-btn').disabled = false;
      $('btn-label').textContent = '查询模型列表';
    }
  });

  /* ---------- 模型列表渲染 ---------- */
  function renderModels() {
    const keyword = $('filter-input').value.trim().toLowerCase();
    const sort = $('sort-select').value;

    let list = allModels.filter((m) => !keyword || m.id.toLowerCase().includes(keyword));
    if (sort === 'name') list = [...list].sort((a, b) => a.id.localeCompare(b.id));
    if (sort === 'created-desc') list = [...list].sort((a, b) => (b.created || 0) - (a.created || 0));
    if (sort === 'created-asc') list = [...list].sort((a, b) => (a.created || 0) - (b.created || 0));

    const ul = $('model-list');
    ul.innerHTML = '';
    list.forEach((m, i) => {
      const created = formatCreated(m.created);
      const li = document.createElement('li');
      li.className = 'row-in';
      li.style.setProperty('--i', Math.min(i, 30));
      li.innerHTML = `
        <button title="点击复制模型 ID" class="group flex w-full items-center gap-4 px-2 py-3.5 text-left transition-colors duration-200 hover:bg-white/[0.03] active:scale-[0.995]">
          <span class="shrink-0 w-8 text-right font-mono text-[11px] text-zinc-700 tabular-nums">${String(i + 1).padStart(2, '0')}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-200 group-hover:text-emerald-300 transition-colors">${escapeHtml(m.id)}</span>
          ${m.owned_by ? `<span class="hidden sm:inline shrink-0 rounded-full border border-white/[0.08] px-2.5 py-0.5 font-mono text-[10px] text-zinc-500">${escapeHtml(m.owned_by)}</span>` : ''}
          ${created ? `<span class="hidden md:inline shrink-0 font-mono text-[11px] text-zinc-600 tabular-nums">${created}</span>` : ''}
          <svg class="shrink-0 text-zinc-700 group-hover:text-emerald-400 transition-colors" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>`;
      li.firstElementChild.addEventListener('click', () => copyText(m.id, `已复制：${m.id}`));
      ul.appendChild(li);
    });

    $('filter-empty').classList.toggle('hidden', list.length !== 0);
    $('visible-count').textContent = list.length;
    $('total-count').textContent = allModels.length;
  }

  $('filter-input').addEventListener('input', renderModels);
  $('sort-select').addEventListener('change', renderModels);
  $('meta-url').addEventListener('click', () => copyText($('meta-url-text').textContent, '已复制请求地址'));

  $('copy-all').addEventListener('click', () => {
    if (!allModels.length) return;
    copyText(allModels.map((m) => m.id).join('\n'), `已复制 ${allModels.length} 个模型 ID`);
  });

  $('export-json').addEventListener('click', () => {
    if (!lastRaw) return;
    let host = 'endpoint';
    try { host = new URL($('meta-url-text').textContent).hostname; } catch { /* 保留默认 */ }
    const blob = new Blob([JSON.stringify(lastRaw, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `models-${host}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出原始 JSON');
  });

  $('raw-toggle').addEventListener('click', () => {
    const raw = $('raw-json');
    const hidden = raw.classList.toggle('hidden');
    $('raw-toggle').textContent = hidden ? '查看原始 JSON' : '收起原始 JSON';
  });

  /* ---------- 键盘快捷键 ---------- */
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
      return;
    }
    if (e.key === '/' && !typing && !states.result.classList.contains('hidden')) {
      e.preventDefault();
      $('filter-input').focus();
      return;
    }
    if (e.key === 'Escape' && document.activeElement === $('filter-input')) {
      $('filter-input').value = '';
      renderModels();
      $('filter-input').blur();
    }
  });

  baseUrlEl.focus();
})();
