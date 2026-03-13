// @ts-nocheck
// Antigravity History — Conversation Manager Frontend Logic

(function () {
  const vscode = acquireVsCodeApi();

  // ── DOM refs ──
  const searchInput = document.getElementById('search-input');
  const refreshBtn = document.getElementById('btn-refresh');
  const exportAllBtn = document.getElementById('btn-export-all');
  const statsBar = document.getElementById('stats-bar');
  const listContainer = document.getElementById('list-container');
  const toastEl = document.getElementById('toast');
  const groupDateBtn = document.getElementById('group-date');
  const groupWorkspaceBtn = document.getElementById('group-workspace');
  const expandAllBtn = document.getElementById('btn-expand-all');
  const collapseAllBtn = document.getElementById('btn-collapse-all');

  // ── State ──
  let conversations = {};
  let searchQuery = '';
  let groupMode = 'date';
  let collapsedGroups = new Set();
  let convDataDir = '';

  // ── Init ──
  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'refresh' });
    showLoading();
  });

  exportAllBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'exportAll' });
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  // Segmented control
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

  // Expand / Collapse all
  expandAllBtn.addEventListener('click', () => { collapsedGroups.clear(); renderList(); });
  collapseAllBtn.addEventListener('click', () => {
    listContainer.querySelectorAll('.date-group-header').forEach((h) => {
      collapsedGroups.add(h.getAttribute('data-group'));
    });
    renderList();
  });

  // ── Receive messages from extension ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.command) {
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
        showToast(`Recovered ${msg.activated} conversations ✅`);
        break;
      case 'exportProgress':
        showToast(msg.text);
        break;
      case 'exportDone':
        showToast(msg.text || 'Export complete ✅');
        break;
      case 'error':
        showError(msg.text);
        break;
    }
  });

  // ── Render ──
  function renderList() {
    const entries = Object.entries(conversations);

    if (entries.length === 0) {
      listContainer.innerHTML = getEmptyStateHtml();
      statsBar.textContent = '';
      return;
    }

    // Filter
    const filtered = entries.filter(([_, info]) => {
      if (!searchQuery) return true;
      return (info.summary || '').toLowerCase().includes(searchQuery);
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = getNoResultsHtml(searchQuery);
      statsBar.textContent = `${entries.length} conversations`;
      return;
    }

    // Group
    const groups = groupMode === 'workspace' ? groupByWorkspace(filtered) : groupByDate(filtered);
    statsBar.textContent = `${filtered.length} of ${entries.length} conversations`;

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
    const title = info.summary || 'Untitled Conversation';
    const stepCount = info.stepCount || '?';
    const time = formatTime(info.lastModifiedTime || info.createdTime);
    const created = formatCreatedDate(info.createdTime);
    const status = info.status || '';
    const statusDot = getStatusDot(status);

    const workspaces = (info.workspaces || [])
      .map((w) => w.workspaceFolderAbsoluteUri)
      .filter(Boolean);
    const wsPath = workspaces.length > 0 ? workspaces[0] : '';
    const wsDisplay = toWinPath(stripFileUri(wsPath));
    const wsHtml = wsPath
      ? `<div class="conv-workspace" data-action="openFolder" data-path="${esc(wsPath)}" title="Open workspace in Explorer">📂 ${esc(wsDisplay)}</div>`
      : '';

    // Conversation data — show only folder name, click opens full path
    const convFileHtml = convDataDir
      ? `<div class="conv-workspace" data-action="openFolder" data-path="${esc(convDataDir)}" title="${esc(toWinPath(convDataDir))}">💾 ${esc(cascadeId)}</div>`
      : '';

    return `
      <div class="conv-card" data-cascade-id="${esc(cascadeId)}">
        <div class="conv-icon">${statusDot}</div>
        <div class="conv-info">
          <div class="conv-title" title="${esc(title)}">${esc(title)}</div>
          <div class="conv-meta">${time} · ${stepCount} steps</div>
          ${wsHtml}
          ${convFileHtml}
        </div>
        <div class="conv-actions">
          <button class="btn-export" data-action="exportMd" data-id="${esc(cascadeId)}">MD</button>
          <button class="btn-export" data-action="exportJson" data-id="${esc(cascadeId)}">JSON</button>
          <button class="btn-export" data-action="copyId" data-id="${esc(cascadeId)}" title="Copy Cascade ID">ID</button>
        </div>
      </div>
    `;
  }

  // ── Event binding ──
  function bindEvents() {
    // Card action buttons
    listContainer.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const cascadeId = btn.getAttribute('data-id');
        if (action === 'exportMd') {
          vscode.postMessage({ command: 'export', cascadeId, format: 'md' });
          showToast('Exporting Markdown...');
        } else if (action === 'exportJson') {
          vscode.postMessage({ command: 'export', cascadeId, format: 'json' });
          showToast('Exporting JSON...');
        } else if (action === 'copyId') {
          vscode.postMessage({ command: 'copyId', cascadeId });
          showToast('Copied!');
        } else if (action === 'openFolder') {
          const folderPath = btn.getAttribute('data-path');
          if (folderPath) {
            vscode.postMessage({ command: 'openInExplorer', path: folderPath });
          }
        }
      });
    });

    // Collapsible group headers
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

  // ── Status indicator ──
  function getStatusDot(status) {
    if (status === 'STATUS_ACTIVE' || status === 'active') return '<span class="status-dot active">●</span>';
    if (status === 'STATUS_COMPLETED' || status === 'completed') return '<span class="status-dot completed">●</span>';
    return '<span class="status-dot idle">●</span>';
  }

  // ── Grouping ──
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
      let label = 'Earlier';
      if (ts) {
        const d = dateKey(new Date(ts));
        if (d === todayStr) label = 'Today';
        else if (d === yesterdayStr) label = 'Yesterday';
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
      const label = ws.length > 0 ? toWinPath(stripFileUri(ws[0])) : 'No Workspace';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(entry);
    }
    return groups;
  }

  // ── Time helpers ──
  function dateKey(d) { return d.toISOString().slice(0, 10); }

  function formatTime(ts) {
    if (!ts) return '–';
    try {
      const d = new Date(ts);
      const now = new Date();
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (dateKey(d) === dateKey(now)) return time;
      // Non-today: show date + time
      const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${date} ${time}`;
    } catch { return ts.slice(11, 16) || '–'; }
  }

  function formatCreatedDate(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      // Only show if created date differs from today
      if (dateKey(d) === dateKey(now)) return '';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  // ── Recover banner ──
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
      <div class="recover-text">🔄 Syncing conversations... ${done}/${total}</div>
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

  // ── Empty states ──
  function getEmptyStateHtml() {
    return `<div class="empty-state">
      <div class="empty-state-icon">🔮</div>
      <div class="empty-state-title">No Conversations Found</div>
      <div class="empty-state-desc">Make sure Antigravity is running with an active workspace.</div>
      <button class="btn btn-primary" onclick="document.getElementById('btn-refresh').click()">🔄 Refresh</button>
    </div>`;
  }

  function getNoResultsHtml(query) {
    return `<div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <div class="empty-state-title">No matches for "${esc(query)}"</div>
      <div class="empty-state-desc">Try a different search term.</div>
    </div>`;
  }

  function showLoading() {
    listContainer.innerHTML = `<div class="loading"><div class="spinner"></div><div>Discovering Antigravity instances...</div></div>`;
  }

  function showError(text) {
    listContainer.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">Error</div>
      <div class="empty-state-desc">${esc(text)}</div>
      <button class="btn btn-primary" onclick="document.getElementById('btn-refresh').click()">🔄 Retry</button>
    </div>`;
  }

  // ── Toast ──
  let toastTimer;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  // ── Utils ──
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
    // Forward to back slashes
    let out = p.replace(/\//g, '\\');
    // Capitalize drive letter: d:\ → D:\
    if (/^[a-z]:\\/.test(out)) {
      out = out[0].toUpperCase() + out.slice(1);
    }
    return out;
  }

  // ── Auto-refresh on load ──
  showLoading();
  vscode.postMessage({ command: 'refresh' });
})();
