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
    const labels = { empty: 'ENDPOINT PROBE', loading: 'CONNECTING', error: 'CONNECTION FAILED', result: 'ENDPOINT CONNECTED' };
    $('connection-label').textContent = labels[name] || 'ENDPOINT PROBE';
  }

  function switchTab(name) {
    ['models', 'billing'].forEach((n) => {
      $(`${n}-view`).classList.toggle('active', n === name);
      $(`${n}-tab`).classList.toggle('active', n === name);
      $(`${n}-tab`).setAttribute('aria-selected', n === name ? 'true' : 'false');
    });
  }
  $('models-tab').addEventListener('click', () => switchTab('models'));
  $('billing-tab').addEventListener('click', () => switchTab('billing'));
  $('key-billing-link').addEventListener('click', () => switchTab('billing'));

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

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `$${Number(n.toFixed(4)).toLocaleString()}` : '—';
  }

  function collectResetCandidates(okProbes) {
    const candidates = [];
    okProbes.forEach((p) => {
      const flat = [];
      flattenScalars(p.data, '', flat);
      flat.forEach((f) => {
        if (!RESET_RE.test(f.key) || NOISE_RE.test(f.key)) return;
        const d = parseMaybeDate(f.value);
        if (d && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
          candidates.push({ date: d, label: f.key, kind: p.kind });
        }
      });
    });
    return candidates.sort((a, b) => a.date - b.date);
  }

  function renderKeySummary(okProbes, candidates, chosen, v1Probe) {
    const card = $('key-summary');
    const quotaSection = $('key-quota-section');
    const resetSection = $('key-reset-section');
    let hasQuota = false;

    const rate = v1Probe?.data?.rate_limits?.[0];
    const newApi = okProbes.find((p) => p.kind === 'newapi_self' && p.data?.data);
    if (rate && Number.isFinite(Number(rate.remaining))) {
      const remaining = Number(rate.remaining), used = Number(rate.used) || 0, limit = Number(rate.limit) || 0;
      const percent = limit > 0 ? Math.max(0, Math.min(100, remaining / limit * 100)) : 0;
      $('key-window-label').textContent = `${rate.window || '当前'} 窗口剩余`;
      $('key-window-remaining').textContent = money(remaining);
      $('key-quota-used').textContent = `已用 ${money(used)} / ${money(limit)}`;
      $('key-quota-percent').textContent = `剩余 ${percent.toFixed(1)}%`;
      $('key-quota-progress').style.width = `${percent}%`;
      hasQuota = true;
    } else if (newApi && Number.isFinite(Number(newApi.data.data.quota))) {
      const data = newApi.data.data;
      const remaining = Number(data.quota) / 500000;
      const used = (Number(data.used_quota) || 0) / 500000;
      const total = remaining + used;
      const percent = total > 0 ? Math.max(0, Math.min(100, remaining / total * 100)) : 0;
      $('key-window-label').textContent = '剩余额度';
      $('key-window-remaining').textContent = money(remaining);
      $('key-quota-used').textContent = `已用 ${money(used)} / ${money(total)}`;
      $('key-quota-percent').textContent = total > 0 ? `剩余 ${percent.toFixed(1)}%` : '';
      $('key-quota-progress').style.width = `${percent}%`;
      hasQuota = true;
    }
    quotaSection.classList.toggle('hidden', !hasQuota);

    if (chosen) {
      resetSection.classList.remove('hidden');
      document.querySelector('#key-reset-section .key-reset-label').textContent =
        /reset|renew|refresh/i.test(chosen.label) ? '下次重置' : '到期时间';
      $('key-reset-time').textContent = formatDateTime(chosen.date).slice(0, 16);
      $('key-reset-countdown').textContent = formatCountdown(chosen.date);
      const expiry = candidates.find((c) => c !== chosen && /expire|access_until|valid_until/i.test(c.label));
      $('key-expiry').textContent = expiry
        ? `密钥 ${formatDateTime(expiry.date).slice(0, 10)} 到期 · ${formatCountdown(expiry.date)}`
        : '';
    } else {
      resetSection.classList.add('hidden');
    }

    const status = v1Probe?.data?.status;
    $('key-status').textContent = status ? String(status).toUpperCase() : 'AVAILABLE';
    card.classList.toggle('hidden', !hasQuota && !chosen);
  }

  function renderV1Overview(probe) {
    const data = probe.data;
    const rate = data.rate_limits?.[0];
    const today = data.usage?.today;
    const total = data.usage?.total;
    $('usage-metrics').classList.remove('hidden');

    if (rate) {
      const remaining = Number(rate.remaining) || 0, used = Number(rate.used) || 0, limit = Number(rate.limit) || 0;
      const usedPercent = limit > 0 ? Math.max(0, Math.min(100, used / limit * 100)) : 0;
      $('metric-remaining-label').textContent = `${rate.window || '当前'} 窗口剩余`;
      $('metric-remaining').textContent = money(remaining);
      $('metric-remaining-note').textContent = `${rate.window || '当前窗口'} · 可继续使用`;
      $('metric-used').textContent = money(used);
      $('metric-used-note').textContent = `限额 ${money(limit)} · ${usedPercent.toFixed(1)}%`;
      $('metric-used-progress').style.width = `${usedPercent}%`;
    } else {
      $('metric-remaining').textContent = '—';
      $('metric-used').textContent = '—';
      $('metric-remaining-note').textContent = '未返回窗口额度';
      $('metric-used-note').textContent = '';
      $('metric-used-progress').style.width = '0';
    }

    $('metric-today').textContent = money(today?.actual_cost ?? today?.cost);
    $('metric-today-note').textContent = `${Number(today?.requests || 0).toLocaleString()} 次请求`;
    $('metric-total').textContent = money(total?.actual_cost ?? total?.cost);
    $('metric-total-note').textContent = `${Number(total?.requests || 0).toLocaleString()} 次请求`;

    const daily = Array.isArray(data.daily_usage) ? data.daily_usage.slice(-14) : [];
    const stats = Array.isArray(data.model_stats)
      ? [...data.model_stats].sort((a, b) => (b.actual_cost ?? b.cost ?? 0) - (a.actual_cost ?? a.cost ?? 0)).slice(0, 3)
      : [];
    $('usage-analytics').classList.toggle('hidden', daily.length === 0 && stats.length === 0);
    $('cost-chart').closest('.panel').classList.toggle('hidden', daily.length === 0);
    $('model-cost-rank').closest('.panel').classList.toggle('hidden', stats.length === 0);

    const maxCost = Math.max(...daily.map((d) => Number(d.actual_cost ?? d.cost) || 0), 0.01);
    $('cost-chart').innerHTML = daily.map((d, i) => {
      const cost = Number(d.actual_cost ?? d.cost) || 0;
      const height = Math.max(5, cost / maxCost * 88);
      const label = String(d.date || '').slice(5);
      return `<div class="bar-wrap"><div class="bar${i === daily.length - 1 ? ' today' : ''}" style="height:${height}%" title="${money(cost)}"></div><span class="bar-label">${escapeHtml(label)}</span></div>`;
    }).join('');

    $('model-cost-rank').innerHTML = stats.map((m) => `
      <div class="rank"><div><div class="rank-name">${escapeHtml(m.model || '未知模型')}</div><div class="rank-sub">${Number(m.requests || 0).toLocaleString()} 次请求</div></div><div class="rank-cost">${money(m.actual_cost ?? m.cost)}</div></div>`).join('');
  }

  function renderGenericUsageFields(okProbes) {
    const dl = $('usage-fields');
    dl.innerHTML = '';
    const seen = new Set();
    const labelCount = {};
    okProbes.forEach((p) => {
      const flat = [];
      flattenScalars(p.data, '', flat);
      flat.forEach((f) => {
        if (!AMOUNT_RE.test(f.key) || NOISE_RE.test(f.key)) return;
        if (RESET_RE.test(f.key) && parseMaybeDate(f.value)) return;
        if (typeof f.value === 'string' && parseMaybeDate(f.value)) return;
        const dedup = `${p.kind}:${f.path}`;
        if (seen.has(dedup)) return;
        seen.add(dedup);
        let label = FIELD_LABELS[f.key] || f.key;
        labelCount[label] = (labelCount[label] || 0) + 1;
        if (labelCount[label] > 1) label = f.path.replace(/^data\./, '');
        const div = document.createElement('div');
        div.innerHTML = `
          <dt class="font-mono text-[10px] text-zinc-600 truncate" title="${escapeHtml(p.kind)} · ${escapeHtml(f.path)}">${escapeHtml(label)}</dt>
          <dd class="mt-1 font-mono text-[13px] text-zinc-200 tabular-nums break-all">${escapeHtml(formatFieldValue(p, f))}</dd>`;
        dl.appendChild(div);
      });
    });
    dl.classList.toggle('hidden', dl.children.length === 0);
  }

  function renderUsage(usage) {
    const probes = Array.isArray(usage?.probes) ? usage.probes : [];
    const okProbes = probes.filter((p) => p.ok && p.data && typeof p.data === 'object');
    const v1Probe = okProbes.find((p) => p.kind === 'v1_usage');
    $('usage-probe-summary').textContent = `已探测 ${probes.length} 个接口 · ${okProbes.length} 个返回数据`;
    $('usage-empty').classList.toggle('hidden', okProbes.length > 0);

    const candidates = collectResetCandidates(okProbes);
    const future = candidates.find((c) => c.date > Date.now());
    const chosen = future || candidates[candidates.length - 1];
    const resetBlock = $('usage-reset-block');
    if (chosen) {
      resetBlock.classList.remove('hidden');
      const window = v1Probe?.data?.rate_limits?.[0]?.window;
      $('usage-reset-label').textContent = window && /reset/i.test(chosen.label)
        ? `${window} 窗口将在以下时间重置`
        : `${future ? '下次重置时间' : '重置/到期时间'} · ${chosen.label}`;
      $('usage-reset-time').textContent = formatDateTime(chosen.date);
      $('usage-reset-countdown').textContent = formatCountdown(chosen.date);
      const othersBox = $('usage-reset-others');
      othersBox.innerHTML = '';
      candidates.filter((c) => c !== chosen).slice(0, 3).forEach((c) => {
        const row = document.createElement('div');
        row.innerHTML = `<span>${escapeHtml(c.label)}</span><span class="tabular-nums">${formatDateTime(c.date)} · ${formatCountdown(c.date)}</span>`;
        othersBox.appendChild(row);
      });
    } else {
      resetBlock.classList.add('hidden');
    }

    renderKeySummary(okProbes, candidates, chosen, v1Probe);
    if (v1Probe) {
      $('usage-fields').classList.add('hidden');
      renderV1Overview(v1Probe);
    } else {
      $('usage-metrics').classList.add('hidden');
      $('usage-analytics').classList.add('hidden');
      renderGenericUsageFields(okProbes);
    }

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
          <summary class="flex items-center justify-between gap-3 cursor-pointer px-3.5 py-2.5 list-none hover:bg-white/[0.02] rounded-lg">${head}</summary>
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
    $('key-summary').classList.add('hidden');
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
      switchTab('models');
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
      $('btn-label').textContent = states.result.classList.contains('hidden') ? '查询模型列表' : '重新查询';
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

    $('raw-json').classList.add('hidden');
    $('model-scroll').classList.remove('hidden');
    $('model-table-head').classList.remove('hidden');
    $('raw-toggle').textContent = '查看原始 JSON';

    const ul = $('model-list');
    ul.innerHTML = '';
    list.forEach((m, i) => {
      const created = formatCreated(m.created);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'model-row';
      btn.title = '点击复制模型 ID';
      btn.innerHTML = `
        <span class="model-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="model-name">${escapeHtml(m.id)}</span>
        ${m.owned_by ? `<span class="provider">${escapeHtml(m.owned_by)}</span>` : '<span></span>'}
        ${created ? `<span class="date">${created}</span>` : '<span class="date"></span>'}
        <svg class="copy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      btn.addEventListener('click', () => copyText(m.id, `已复制：${m.id}`));
      li.appendChild(btn);
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
    const showRaw = raw.classList.contains('hidden');
    raw.classList.toggle('hidden', !showRaw);
    $('model-scroll').classList.toggle('hidden', showRaw);
    $('model-table-head').classList.toggle('hidden', showRaw);
    $('raw-toggle').textContent = showRaw ? '返回模型列表' : '查看原始 JSON';
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
      switchTab('models');
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
