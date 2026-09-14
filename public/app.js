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
  const LOADING_PHRASES = ['正在规范化请求地址', '正在连接目标端点', '等待上游响应', '正在解析模型列表'];
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
