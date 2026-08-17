// @ts-nocheck
/**
 * Antigravity History — Webview 前端交互与多语言渲染引擎
 *
 * 核心功能：
 * - 会话列表检索、日期与工作区双模式分组聚合、展开与折叠控制
 * - 单条 Markdown / JSON 导出与批量归类导出控制
 * - 路径修改与系统资源管理器一键定位
 * - 内置轻量中英文多语言国际化词典，支持界面动态语言无刷新即时切换与持久化
 *
 * 作者/更新时间: fengyun / 2026-08-17
 */

(function () {
  const vscode = acquireVsCodeApi();

  // ── 多语言国际化词典 ──
  const i18n = {
    'zh-CN': {
      searchPlaceholder: '搜索会话...',
      groupDate: '日期',
      groupWorkspace: '工作区',
      expandAll: '展开',
      collapseAll: '折叠',
      expandAllTitle: '全部展开',
      collapseAllTitle: '全部折叠',
      refresh: '刷新',
      refreshTitle: '刷新会话列表',
      strategyWorkspace: '按所属项目归类',
      strategyUnified: '统一导出目录',
      strategyTitle: '导出归属模式',
      fieldDefault: '基础对话',
      fieldThinking: '+ 思考过程',
      fieldFull: '完整数据 (含Diff与终端)',
      fieldLevelTitle: '导出详情级别',
      langTitle: '界面语言 / Language',
      exportAll: '全部导出',
      exportTo: '导出至:',
      changePath: '修改',
      openPath: '打开',
      clickToChange: '点击修改导出目录',
      totalConversations: '共 {0} / {1} 个会话',
      totalCountOnly: '{0} 个会话',
      unnamedConv: '未命名会话',
      stepsUnit: '步',
      timeToday: '今天',
      timeYesterday: '昨天',
      timeEarlier: '更早',
      noWorkspace: '未关联工作区',
      openFolderTooltip: '在文件资源管理器中打开项目目录: {0}',
      openConvDataTooltip: '在文件资源管理器中打开会话存储目录: {0}',
      exportMdTooltip: '选择保存为 Markdown',
      exportJsonTooltip: '选择保存为 JSON',
      copyIdTooltip: '复制会话 ID',
      preparingExportMd: '准备导出 Markdown...',
      preparingExportJson: '准备导出 JSON...',
      idCopied: '会话 ID 已复制',
      syncingRecover: '正在同步恢复会话数据... {0}/{1}',
      recoverDone: '成功恢复 {0} 个会话',
      emptyTitle: '未找到会话记录',
      emptyDesc: '请确认 Antigravity 正在运行且已激活工作区。',
      noResultsTitle: '未找到匹配 "{0}" 的会话',
      noResultsDesc: '请尝试其他搜索关键词。',
      loadingText: '正在发现 Antigravity 服务实例...',
      errorTitle: '发生错误',
      retryBtn: '重试',
    },
    'en': {
      searchPlaceholder: 'Search conversations...',
      groupDate: 'Date',
      groupWorkspace: 'Workspace',
      expandAll: 'Expand',
      collapseAll: 'Collapse',
      expandAllTitle: 'Expand all groups',
      collapseAllTitle: 'Collapse all groups',
      refresh: 'Refresh',
      refreshTitle: 'Refresh conversation list',
      strategyWorkspace: 'Categorized by Project',
      strategyUnified: 'Unified Directory',
      strategyTitle: 'Export Strategy',
      fieldDefault: 'Basic Messages',
      fieldThinking: '+ Thinking Process',
      fieldFull: 'Full Data (Diffs & Outputs)',
      fieldLevelTitle: 'Export Detail Level',
      langTitle: 'Language / 语言',
      exportAll: 'Export All',
      exportTo: 'Export to:',
      changePath: 'Change',
      openPath: 'Open',
      clickToChange: 'Click to change export path',
      totalConversations: 'Total {0} / {1} conversations',
      totalCountOnly: '{0} conversations',
      unnamedConv: 'Untitled Conversation',
      stepsUnit: 'steps',
      timeToday: 'Today',
      timeYesterday: 'Yesterday',
      timeEarlier: 'Earlier',
      noWorkspace: 'Unassociated Workspace',
      openFolderTooltip: 'Open project folder in File Explorer: {0}',
      openConvDataTooltip: 'Open conversation data folder in File Explorer: {0}',
      exportMdTooltip: 'Save as Markdown',
      exportJsonTooltip: 'Save as JSON',
      copyIdTooltip: 'Copy Conversation ID',
      preparingExportMd: 'Preparing Markdown export...',
      preparingExportJson: 'Preparing JSON export...',
      idCopied: 'Conversation ID copied to clipboard',
      syncingRecover: 'Syncing & recovering conversations... {0}/{1}',
      recoverDone: 'Successfully recovered {0} conversations',
      emptyTitle: 'No conversations found',
      emptyDesc: 'Please make sure Antigravity is running and has active workspaces.',
      noResultsTitle: 'No conversations matching "{0}"',
      noResultsDesc: 'Try searching with different keywords.',
      loadingText: 'Discovering Antigravity service instances...',
      errorTitle: 'Error Occurred',
      retryBtn: 'Retry',
    },
  };

  let currentLang = 'zh-CN';

  /**
   * 获取多语言文本
   *
   * @param {string} key 键名
   * @param  {...(string|number)} params 格式化参数
   * @returns {string} 翻译后文本
   */
  function t(key, ...params) {
    const dict = i18n[currentLang] || i18n['zh-CN'];
    let text = dict[key] || i18n['zh-CN'][key] || key;
    if (params && params.length > 0) {
      params.forEach((param, index) => {
        text = text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(param));
      });
    }
    return text;
  }

  // ── DOM 元素引用 ──
  const searchInput = document.getElementById('search-input');
  const refreshBtn = document.getElementById('btn-refresh');
  const exportAllBtn = document.getElementById('btn-export-all');
  const statsBar = document.getElementById('stats-bar');
  const listContainer = document.getElementById('list-container');
  const toastEl = document.getElementById('toast');
  const exportPathBar = document.getElementById('export-path-bar');
  const groupDateBtn = document.getElementById('group-date');
  const groupWorkspaceBtn = document.getElementById('group-workspace');
  const expandAllBtn = document.getElementById('btn-expand-all');
  const collapseAllBtn = document.getElementById('btn-collapse-all');
  const fieldLevelSelect = document.getElementById('field-level-select');
  const exportStrategySelect = document.getElementById('export-strategy-select');
  const langSelect = document.getElementById('lang-select');

  // ── 内部状态 ──
  let conversations = {};
  let searchQuery = '';
  let groupMode = 'date';
  let collapsedGroups = new Set();
  let convDataDir = '';
  let currentExportPath = '';

  /**
   * 刷新界面静态文本
   */
  function updateStaticTexts() {
    // 顶部控制栏
    if (searchInput) searchInput.placeholder = t('searchPlaceholder');
    if (groupDateBtn) groupDateBtn.textContent = t('groupDate');
    if (groupWorkspaceBtn) groupWorkspaceBtn.textContent = t('groupWorkspace');
    if (expandAllBtn) {
      expandAllBtn.textContent = t('expandAll');
      expandAllBtn.title = t('expandAllTitle');
    }
    if (collapseAllBtn) {
      collapseAllBtn.textContent = t('collapseAll');
      collapseAllBtn.title = t('collapseAllTitle');
    }
    if (refreshBtn) {
      refreshBtn.textContent = t('refresh');
      refreshBtn.title = t('refreshTitle');
    }
    if (exportAllBtn) exportAllBtn.textContent = t('exportAll');

    // 下拉选项
    if (exportStrategySelect) {
      exportStrategySelect.title = t('strategyTitle');
      const optWs = exportStrategySelect.querySelector('option[value="workspace"]');
      const optUni = exportStrategySelect.querySelector('option[value="unified"]');
      if (optWs) optWs.textContent = t('strategyWorkspace');
      if (optUni) optUni.textContent = t('strategyUnified');
    }

    if (fieldLevelSelect) {
      fieldLevelSelect.title = t('fieldLevelTitle');
      const optDef = fieldLevelSelect.querySelector('option[value="default"]');
      const optThk = fieldLevelSelect.querySelector('option[value="thinking"]');
      const optFul = fieldLevelSelect.querySelector('option[value="full"]');
      if (optDef) optDef.textContent = t('fieldDefault');
      if (optThk) optThk.textContent = t('fieldThinking');
      if (optFul) optFul.textContent = t('fieldFull');
    }

    if (langSelect) {
      langSelect.title = t('langTitle');
      langSelect.value = currentLang;
    }

    // 路径栏
    renderExportPathBar();

    // 重新渲染列表与统计
    renderList();
  }

  /**
   * 渲染导出路径条
   */
  function renderExportPathBar() {
    if (!exportPathBar || !currentExportPath) return;
    exportPathBar.innerHTML = `${t('exportTo')} <span class="export-path-link" id="export-path-text" title="${esc(t('clickToChange'))}">${esc(currentExportPath)}</span> <button class="export-path-btn" id="btn-change-path">${esc(t('changePath'))}</button> <button class="export-path-btn" id="btn-open-path">${esc(t('openPath'))}</button>`;

    const changeBtn = document.getElementById('btn-change-path');
    const openBtn = document.getElementById('btn-open-path');
    const pathText = document.getElementById('export-path-text');

    if (changeBtn) changeBtn.addEventListener('click', () => vscode.postMessage({ command: 'changeExportPath' }));
    if (openBtn) openBtn.addEventListener('click', () => vscode.postMessage({ command: 'openExportFolder' }));
    if (pathText) pathText.addEventListener('click', () => vscode.postMessage({ command: 'changeExportPath' }));
  }

  // ── 事件监听绑定 ──
  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'refresh' });
    showLoading();
  });

  exportAllBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'exportAll' });
  });

  fieldLevelSelect.addEventListener('change', () => {
    vscode.postMessage({ command: 'setFieldLevel', value: fieldLevelSelect.value });
  });

  if (exportStrategySelect) {
    exportStrategySelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'setExportStrategy', value: exportStrategySelect.value });
    });
  }

  if (langSelect) {
    langSelect.addEventListener('change', () => {
      const selected = langSelect.value;
      if (selected === 'zh-CN' || selected === 'en') {
        currentLang = selected;
        vscode.postMessage({ command: 'setLanguage', value: currentLang });
        updateStaticTexts();
      }
    });
  }

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  // 分组切换
  groupDateBtn.addEventListener('click', () => {
    groupMode = 'date';
    groupDateBtn.classList.add('active');
    groupWorkspaceBtn.classList.remove('active');
    collapsedGroups.clear();
    renderList();
  });

  groupWorkspaceBtn.addEventListener('click', () => {
    groupMode = 'workspace';
    groupWorkspaceBtn.classList.add('active');
    groupDateBtn.classList.remove('active');
    collapsedGroups.clear();
    renderList();
  });

  // 全部展开 / 折叠
  expandAllBtn.addEventListener('click', () => {
    collapsedGroups.clear();
    renderList();
  });

  collapseAllBtn.addEventListener('click', () => {
    listContainer.querySelectorAll('.date-group-header').forEach((h) => {
      collapsedGroups.add(h.getAttribute('data-group'));
    });
    renderList();
  });

  // ── 接收来自扩展端的消息 ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.command) {
      case 'setLanguage':
        if (msg.language && (msg.language === 'zh-CN' || msg.language === 'en')) {
          currentLang = msg.language;
          updateStaticTexts();
        }
        break;
      case 'setConversations':
        conversations = msg.data || {};
        if (msg.convDir) { convDataDir = msg.convDir; }
        renderList();
        break;
      case 'recoverProgress':
        showRecoverBanner(msg.done, msg.total);
        break;
      case 'recoverDone':
        hideRecoverBanner();
        showToast(t('recoverDone', msg.activated));
        break;
      case 'exportProgress':
        showToast(msg.text || t('preparingExportMd'));
        break;
      case 'exportDone':
        showToast(msg.text || t('recoverDone', 1));
        break;
      case 'exportCanceled':
        showToast(msg.text || '已取消导出');
        break;
      case 'exportError':
        showToast(msg.text || '导出失败');
        break;
      case 'setExportPath':
        if (msg.path) {
          currentExportPath = msg.path;
          renderExportPathBar();
        }
        break;
      case 'setExportStrategy':
        if (msg.strategy && exportStrategySelect) {
          exportStrategySelect.value = msg.strategy;
        }
        break;
    }
  });

  // ── 渲染逻辑 ──
  function renderList() {
    const entries = Object.entries(conversations);

    if (entries.length === 0) {
      listContainer.innerHTML = getEmptyStateHtml();
      statsBar.textContent = '';
      return;
    }

    // 过滤
    const filtered = entries.filter(([_, info]) => {
      if (!searchQuery) return true;
      return (info.summary || '').toLowerCase().includes(searchQuery);
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = getNoResultsHtml(searchQuery);
      statsBar.textContent = t('totalCountOnly', entries.length);
      return;
    }

    // 分组
    const groups = groupMode === 'workspace' ? groupByWorkspace(filtered) : groupByDate(filtered);
    statsBar.textContent = t('totalConversations', filtered.length, entries.length);

    let html = '';
    for (const [label, items] of groups) {
      const isCollapsed = collapsedGroups.has(label);
      const arrow = isCollapsed ? '▸' : '▾';
      html += `<div class="date-group">`;
      html += `<div class="date-group-header" data-group="${esc(label)}">
        <span class="group-arrow">${arrow}</span> ${esc(label)}
        <span class="date-group-count">(${items.length})</span>
      </div>`;
      html += `<div class="group-items${isCollapsed ? ' collapsed' : ''}">`;
      for (const [cid, info] of items) {
        html += renderCard(cid, info);
      }
      html += `</div></div>`;
    }
    listContainer.innerHTML = html;
    bindEvents();
  }

  function renderCard(cascadeId, info) {
    const title = info.summary || t('unnamedConv');
    const stepCount = info.stepCount || '?';
    const time = formatTime(info.lastModifiedTime || info.createdTime);
    const status = info.status || '';
    const statusDot = getStatusDot(status);

    const workspaces = (info.workspaces || [])
      .map((w) => w.workspaceFolderAbsoluteUri)
      .filter(Boolean);
    const wsPath = workspaces.length > 0 ? workspaces[0] : '';
    const wsDisplay = toWinPath(stripFileUri(wsPath));
    const wsHtml = wsPath
      ? `<div class="conv-workspace" data-action="openFolder" data-path="${esc(wsPath)}" title="${esc(t('openFolderTooltip', wsDisplay))}">📂 ${esc(wsDisplay)}</div>`
      : '';

    // 会话数据目录
    const convFileHtml = convDataDir
      ? `<div class="conv-workspace" data-action="openFolder" data-path="${esc(convDataDir)}" title="${esc(t('openConvDataTooltip', toWinPath(convDataDir)))}">💾 ${esc(cascadeId)}</div>`
      : '';

    return `
      <div class="conv-card" data-cascade-id="${esc(cascadeId)}">
        <div class="conv-icon">${statusDot}</div>
        <div class="conv-info">
          <div class="conv-title" title="${esc(title)}">${esc(title)}</div>
          <div class="conv-meta">${time} · ${stepCount} ${t('stepsUnit')}</div>
          ${wsHtml}
          ${convFileHtml}
        </div>
        <div class="conv-actions">
          <button class="btn-export" data-action="exportMd" data-id="${esc(cascadeId)}" title="${esc(t('exportMdTooltip'))}">MD</button>
          <button class="btn-export" data-action="exportJson" data-id="${esc(cascadeId)}" title="${esc(t('exportJsonTooltip'))}">JSON</button>
          <button class="btn-export" data-action="copyId" data-id="${esc(cascadeId)}" title="${esc(t('copyIdTooltip'))}">ID</button>
        </div>
      </div>
    `;
  }

  // ── 交互事件绑定 ──
  function bindEvents() {
    listContainer.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const cascadeId = btn.getAttribute('data-id');
        if (action === 'exportMd') {
          vscode.postMessage({ command: 'export', cascadeId, format: 'md' });
          showToast(t('preparingExportMd'));
        } else if (action === 'exportJson') {
          vscode.postMessage({ command: 'export', cascadeId, format: 'json' });
          showToast(t('preparingExportJson'));
        } else if (action === 'copyId') {
          vscode.postMessage({ command: 'copyId', cascadeId });
          showToast(t('idCopied'));
        } else if (action === 'openFolder') {
          const folderPath = btn.getAttribute('data-path');
          if (folderPath) {
            vscode.postMessage({ command: 'openInExplorer', path: folderPath });
          }
        }
      });
    });

    listContainer.querySelectorAll('.date-group-header').forEach((header) => {
      header.addEventListener('click', () => {
        const group = header.getAttribute('data-group');
        if (collapsedGroups.has(group)) {
          collapsedGroups.delete(group);
        } else {
          collapsedGroups.add(group);
        }
        renderList();
      });
    });
  }

  // ── 状态指示器 ──
  function getStatusDot(status) {
    if (status === 'STATUS_ACTIVE' || status === 'active') return '<span class="status-dot active">●</span>';
    if (status === 'STATUS_COMPLETED' || status === 'completed') return '<span class="status-dot completed">●</span>';
    return '<span class="status-dot idle">●</span>';
  }

  // ── 分组聚合计算 ──
  function groupByDate(entries) {
    const now = new Date();
    const todayStr = dateKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = dateKey(yesterday);
    const groups = new Map();

    entries.sort((a, b) => {
      const ta = a[1].lastModifiedTime || a[1].createdTime || '';
      const tb = b[1].lastModifiedTime || b[1].createdTime || '';
      return tb.localeCompare(ta);
    });

    for (const entry of entries) {
      const ts = entry[1].lastModifiedTime || entry[1].createdTime || '';
      let label = t('timeEarlier');
      if (ts) {
        const d = dateKey(new Date(ts));
        if (d === todayStr) label = t('timeToday');
        else if (d === yesterdayStr) label = t('timeYesterday');
        else label = d;
      }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(entry);
    }
    return groups;
  }

  function groupByWorkspace(entries) {
    const groups = new Map();

    entries.sort((a, b) => {
      const ta = a[1].lastModifiedTime || a[1].createdTime || '';
      const tb = b[1].lastModifiedTime || b[1].createdTime || '';
      return tb.localeCompare(ta);
    });

    for (const entry of entries) {
      const ws = (entry[1].workspaces || [])
        .map((w) => w.workspaceFolderAbsoluteUri)
        .filter(Boolean);
      const label = ws.length > 0 ? toWinPath(stripFileUri(ws[0])) : t('noWorkspace');
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(entry);
    }
    return groups;
  }

  // ── 时间格式化 ──
  function dateKey(d) { return d.toISOString().slice(0, 10); }

  function formatTime(ts) {
    if (!ts) return '–';
    try {
      const d = new Date(ts);
      const now = new Date();
      const locale = currentLang === 'en' ? 'en-US' : 'zh-CN';
      const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      if (dateKey(d) === dateKey(now)) return time;
      const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
      return `${date} ${time}`;
    } catch { return ts.slice(11, 16) || '–'; }
  }

  // ── 恢复进度条 ──
  function showRecoverBanner(done, total) {
    let banner = document.getElementById('recover-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'recover-banner';
      banner.className = 'recover-banner';
      listContainer.parentNode.insertBefore(banner, listContainer);
    }
    const pct = Math.round((done / total) * 100);
    banner.innerHTML = `
      <div class="recover-text">${esc(t('syncingRecover', done, total))}</div>
      <div class="recover-bar-bg"><div class="recover-bar-fill" style="width:${pct}%"></div></div>
    `;
  }

  function hideRecoverBanner() {
    const banner = document.getElementById('recover-banner');
    if (banner) {
      banner.classList.add('fade-out');
      setTimeout(() => banner.remove(), 500);
    }
  }

  // ── 空状态与提示 ──
  function getEmptyStateHtml() {
    return `<div class="empty-state">
      <div class="empty-state-title">${esc(t('emptyTitle'))}</div>
      <div class="empty-state-desc">${esc(t('emptyDesc'))}</div>
      <button class="btn btn-primary" onclick="document.getElementById('btn-refresh').click()">${esc(t('refresh'))}</button>
    </div>`;
  }

  function getNoResultsHtml(query) {
    return `<div class="empty-state">
      <div class="empty-state-title">${esc(t('noResultsTitle', query))}</div>
      <div class="empty-state-desc">${esc(t('noResultsDesc'))}</div>
    </div>`;
  }

  function showLoading() {
    listContainer.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('loadingText'))}</div></div>`;
  }

  function showError(text) {
    listContainer.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">${esc(t('errorTitle'))}</div>
      <div class="empty-state-desc">${esc(text)}</div>
      <button class="btn btn-primary" onclick="document.getElementById('btn-refresh').click()">${esc(t('retryBtn'))}</button>
    </div>`;
  }

  // ── Toast 提示 ──
  let toastTimer;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  // ── 路径与编码工具 ──
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function stripFileUri(uri) {
    if (!uri) return '';
    return decodeURIComponent(uri.replace(/^file:\/\/\//i, ''));
  }

  function toWinPath(p) {
    if (!p) return '';
    let out = p.replace(/\//g, '\\');
    if (/^[a-z]:\\/.test(out)) {
      out = out[0].toUpperCase() + out.slice(1);
    }
    return out;
  }

  // ── 初始化 ──
  updateStaticTexts();
  showLoading();
  vscode.postMessage({ command: 'refresh' });
})();
