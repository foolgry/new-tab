// 书签管理类
class BookmarkManager {
  constructor() {
    this.bookmarks = [];
    this.groups = [];
    this.currentGroupId = 'default';
    this.sortBy = 'frequency';
    this.draggedElement = null;
    this.draggedBookmark = null;

    this.searchKeyword = '';
    this.collapsedGroups = new Set();

    this.init();
  }

  async init() {
    await Promise.all([
      this.loadBookmarks(),
      this.loadGroups()
    ]);
    this.bindGlobalEvents();
    this.render();
  }

  // ==================== 数据加载 / 保存 ====================

  async loadBookmarks() {
    try {
      const result = await chrome.storage.local.get(['bookmarks']);
      this.bookmarks = result.bookmarks || [];

      const migratedCount = this.migrateBookmarkFavicons();
      if (migratedCount > 0) {
        await this.saveBookmarks();
      }
    } catch (error) {
      console.error('加载书签失败:', error);
      this.bookmarks = [];
    }
  }

  async loadGroups() {
    try {
      const result = await chrome.storage.local.get(['groups', 'currentGroupId']);

      if (!result.groups || result.groups.length === 0) {
        this.groups = [{
          id: 'default',
          name: '默认分组',
          order: 0
        }];
        await this.saveGroups();
      } else {
        this.groups = result.groups;
      }

      this.currentGroupId = result.currentGroupId || 'default';
    } catch (error) {
      console.error('加载分组失败:', error);
      this.groups = [{ id: 'default', name: '默认分组', order: 0 }];
      this.currentGroupId = 'default';
    }
  }

  async saveBookmarks() {
    try {
      await chrome.storage.local.set({ bookmarks: this.bookmarks });
    } catch (error) {
      console.error('保存书签失败:', error);
    }
  }

  async saveGroups() {
    try {
      await chrome.storage.local.set({ groups: this.groups });
    } catch (error) {
      console.error('保存分组失败:', error);
    }
  }

  async saveCurrentGroupId() {
    try {
      await chrome.storage.local.set({ currentGroupId: this.currentGroupId });
    } catch (error) {
      console.error('保存当前分组失败:', error);
    }
  }

  // ==================== 全局事件绑定 ====================

  bindGlobalEvents() {
    // 弹窗：点击外部关闭
    document.getElementById('add-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-modal') this.hideAddModal();
    });
    document.getElementById('add-group-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-group-modal') this.hideAddGroupModal();
    });

    // 弹窗：取消按钮
    document.getElementById('cancel-add').addEventListener('click', () => this.hideAddModal());
    document.getElementById('cancel-add-group').addEventListener('click', () => this.hideAddGroupModal());

    // 弹窗：表单提交
    document.getElementById('add-bookmark-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addBookmark();
    });
    document.getElementById('add-group-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const groupName = document.getElementById('group-name').value.trim();
      if (groupName) {
        this.addGroup(groupName);
        this.hideAddGroupModal();
      }
    });

    // 全局点击：关闭右键菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        const menu = document.querySelector('.context-menu');
        if (menu) menu.remove();
      }
    });

    // 导入文件（持久在 newtab.html）
    const importFile = document.getElementById('import-file');
    if (importFile && !importFile.dataset.bound) {
      importFile.dataset.bound = '1';
      importFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this.importData(file);
        e.target.value = '';
      });
    }
  }

  // ==================== 渲染入口 ====================

  render() {
    this.renderHeader();
    this.renderBody();
  }

  renderHeader() {
    const container = document.getElementById('header-dynamic');
    if (!container) return;
    container.innerHTML = `
      <div class="search">
        <span class="search-icon">⌕</span>
        <input id="search-input" type="text" placeholder="搜索书签..." value="${this.escapeHtml(this.searchKeyword)}">
      </div>
      <div class="icon-btns">
        <button id="add-bookmark" class="icon-btn" title="添加书签">+</button>
        <button id="add-group" class="icon-btn" title="添加分组">▤</button>
        <button id="import-btn" class="icon-btn" title="导入">↓</button>
        <button id="export-btn" class="icon-btn" title="导出">↑</button>
      </div>
      <div class="sort">
        <span class="sort-label">排序</span>
        <button id="sort-custom" class="sort-btn ${this.sortBy === 'custom' ? 'active' : ''}">自定义</button>
        <button id="sort-frequency" class="sort-btn ${this.sortBy === 'frequency' ? 'active' : ''}">按访问频次</button>
      </div>
    `;

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchKeyword = e.target.value;
        this.renderColumns();
      });
    }

    document.getElementById('add-bookmark').addEventListener('click', () => this.showAddModal());
    document.getElementById('add-group').addEventListener('click', () => this.showAddGroupModal());
    document.getElementById('export-btn').addEventListener('click', () => this.exportData());
    document.getElementById('import-btn').addEventListener('click', () => {
      const f = document.getElementById('import-file');
      if (f) f.click();
    });
    document.getElementById('sort-custom').addEventListener('click', () => this.setSortMode('custom'));
    document.getElementById('sort-frequency').addEventListener('click', () => this.setSortMode('frequency'));
  }

  renderBody() {
    const main = document.getElementById('main-content');
    if (!main) return;
    main.innerHTML = `<div class="columns-grid" id="columns-grid"></div>`;
    this.renderColumns();
  }

  renderColumns() {
    const container = document.getElementById('columns-grid');
    if (!container) return;
    container.innerHTML = '';

    const sortedGroups = [...this.groups].sort((a, b) => a.order - b.order);
    const keyword = this.searchKeyword.trim().toLowerCase();

    if (this.bookmarks.length === 0 && sortedGroups.length <= 1) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `
        <h2>还没有书签</h2>
        <p>点击右上角 + 按钮开始添加你喜欢的网站</p>
      `;
      container.appendChild(empty);
      return;
    }

    sortedGroups.forEach((group, index) => {
      const groupBookmarks = this.bookmarks
        .filter(b => b.groupId === group.id)
        .filter(b => !keyword || b.title.toLowerCase().includes(keyword) || b.url.toLowerCase().includes(keyword))
        .sort((a, b) => {
          if (this.sortBy === 'frequency') return b.visitCount - a.visitCount;
          return a.order - b.order;
        });

      // 搜索时如果该列没有匹配项就隐藏
      if (keyword && groupBookmarks.length === 0) return;

      const col = document.createElement('div');
      col.className = 'group-column';
      col.dataset.groupId = group.id;
      col.style.animationDelay = `${index * 0.04}s`;
      if (this.collapsedGroups.has(group.id)) col.classList.add('collapsed');

      col.innerHTML = `
        <div class="group-header" data-action="toggle">
          <span class="group-toggle">▾</span>
          <span class="group-name">${this.escapeHtml(group.name)}</span>
          <span class="group-count">${groupBookmarks.length}</span>
          <div class="group-header-actions">
            <button class="icon-btn" data-action="add-bookmark" title="在此分组添加书签">+</button>
          </div>
        </div>
        <div class="group-body">
          ${groupBookmarks.length === 0
            ? `<div class="column-empty">暂无书签</div>`
            : groupBookmarks.map(b => this.renderRowHtml(b)).join('')
          }
        </div>
      `;

      this.bindColumnEvents(col, group);
      container.appendChild(col);
    });
  }

  renderRowHtml(bookmark) {
    return `
      <div class="bookmark-row" data-id="${bookmark.id}" draggable="${this.sortBy === 'custom'}">
        <div class="row-favicon">
          <img alt="${this.escapeHtml(bookmark.title)}">
        </div>
        <span class="row-title">${this.escapeHtml(bookmark.title)}</span>
        <button class="row-delete" title="删除">×</button>
      </div>
    `;
  }

  bindColumnEvents(col, group) {
    const header = col.querySelector('.group-header');
    header.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (action && action.dataset.action === 'add-bookmark') {
        e.stopPropagation();
        this.currentGroupId = group.id;
        this.saveCurrentGroupId();
        this.showAddModal();
        return;
      }
      this.toggleGroupCollapse(group.id);
    });

    if (group.id !== 'default') {
      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, group.id);
      });
    }

    // 行项事件
    col.querySelectorAll('.bookmark-row').forEach(row => {
      const id = row.dataset.id;
      const bookmark = this.bookmarks.find(b => b.id === id);
      if (!bookmark) return;

      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('row-delete')) {
          e.stopPropagation();
          this.deleteBookmark(bookmark.id);
          return;
        }
        this.openBookmark(bookmark);
      });

      this.applyFaviconWithFallback(row.querySelector('.row-favicon img'), bookmark.url, bookmark.favicon);
      this.initRowDrag(row, bookmark);
    });
  }

  toggleGroupCollapse(groupId) {
    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId);
    } else {
      this.collapsedGroups.add(groupId);
    }
    this.renderColumns();
  }

  initRowDrag(row, bookmark) {
    row.draggable = this.sortBy === 'custom';

    row.addEventListener('dragstart', (e) => {
      if (this.sortBy !== 'custom') { e.preventDefault(); return; }
      this.draggedElement = row;
      this.draggedBookmark = bookmark;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', bookmark.id);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      this.clearDropMarkers();
      this.draggedElement = null;
      this.draggedBookmark = null;
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this.clearDropMarkers();
      const rect = row.getBoundingClientRect();
      const isUpperHalf = (e.clientY - rect.top) < rect.height / 2;
      row.classList.add(isUpperHalf ? 'drop-before' : 'drop-after');
    });

    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drop-before', 'drop-after');
      }
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.draggedBookmark) return;
      const rect = row.getBoundingClientRect();
      const isUpperHalf = (e.clientY - rect.top) < rect.height / 2;

      const targetBookmark = this.bookmarks.find(b => b.id === row.dataset.id);
      if (!targetBookmark) return;

      // 跨列改分组
      if (this.draggedBookmark.groupId !== targetBookmark.groupId) {
        this.draggedBookmark.groupId = targetBookmark.groupId;
      }

      // 同列内重排
      const draggedIndex = this.bookmarks.findIndex(b => b.id === this.draggedBookmark.id);
      if (draggedIndex !== -1) {
        this.bookmarks.splice(draggedIndex, 1);
        let targetIndex = this.bookmarks.findIndex(b => b.id === targetBookmark.id);
        if (!isUpperHalf) targetIndex += 1;
        this.bookmarks.splice(targetIndex, 0, this.draggedBookmark);
      }
      this.bookmarks.forEach((b, i) => { b.order = i; });
      await this.saveBookmarks();
      this.clearDropMarkers();
      this.renderColumns();
    });
  }

  clearDropMarkers() {
    document.querySelectorAll('.bookmark-row.drop-before, .bookmark-row.drop-after')
      .forEach(el => el.classList.remove('drop-before', 'drop-after'));
    document.querySelectorAll('.group-column.drag-target')
      .forEach(el => el.classList.remove('drag-target'));
  }

  // ==================== 排序 / 切换 ====================

  setSortMode(mode) {
    this.sortBy = mode;
    this.render();
  }

  // ==================== 书签操作 ====================

  async addGroup(name) {
    const group = {
      id: Date.now().toString(),
      name: name.trim(),
      order: this.groups.length
    };
    this.groups.push(group);
    await this.saveGroups();
    this.renderColumns();
  }

  async deleteGroup(groupId) {
    if (groupId === 'default') return;
    const confirmed = confirm('删除分组后，该分组下的书签将移至默认分组。确定删除吗？');
    if (!confirmed) return;

    this.bookmarks.forEach(b => {
      if (b.groupId === groupId) b.groupId = 'default';
    });
    const index = this.groups.findIndex(g => g.id === groupId);
    if (index !== -1) this.groups.splice(index, 1);
    this.groups.forEach((g, i) => { g.order = i; });

    await this.saveBookmarks();
    await this.saveGroups();

    if (this.currentGroupId === groupId) {
      this.currentGroupId = 'default';
      await this.saveCurrentGroupId();
    }
    this.render();
  }

  async addBookmark() {
    const title = document.getElementById('bookmark-title').value.trim();
    const url = document.getElementById('bookmark-url').value.trim();
    const groupId = document.getElementById('bookmark-group').value;
    if (!title || !url) return;

    const ensuredUrl = this.ensureHttps(url);
    const bookmark = {
      id: Date.now().toString(),
      title,
      url: ensuredUrl,
      favicon: this.getFaviconUrl(ensuredUrl),
      visitCount: 0,
      lastVisit: 0,
      order: this.bookmarks.length,
      groupId
    };
    this.bookmarks.push(bookmark);
    await this.saveBookmarks();
    this.render();
    this.hideAddModal();
  }

  async deleteBookmark(id) {
    if (!confirm('确定要删除这个书签吗？')) return;
    const index = this.bookmarks.findIndex(b => b.id === id);
    if (index !== -1) {
      this.bookmarks.splice(index, 1);
      await this.saveBookmarks();
      this.render();
    }
  }

  async openBookmark(bookmark) {
    bookmark.visitCount++;
    bookmark.lastVisit = Date.now();
    await this.saveBookmarks();
    window.open(bookmark.url, '_self');
  }

  // ==================== 弹窗 ====================

  showAddModal() {
    this.renderGroupSelect();
    document.getElementById('add-modal').style.display = 'flex';
    document.getElementById('bookmark-title').focus();
  }

  hideAddModal() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('add-bookmark-form').reset();
  }

  showAddGroupModal() {
    document.getElementById('add-group-modal').style.display = 'flex';
    document.getElementById('group-name').focus();
  }

  hideAddGroupModal() {
    document.getElementById('add-group-modal').style.display = 'none';
    document.getElementById('add-group-form').reset();
  }

  renderGroupSelect() {
    const select = document.getElementById('bookmark-group');
    if (!select) return;
    select.innerHTML = '';
    this.groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      if (group.id === this.currentGroupId) option.selected = true;
      select.appendChild(option);
    });
  }

  showContextMenu(event, groupId) {
    const oldMenu = document.querySelector('.context-menu');
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item';
    deleteItem.textContent = '删除分组';
    deleteItem.addEventListener('click', () => {
      this.deleteGroup(groupId);
      menu.remove();
    });
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
  }

  // ==================== 导入 / 导出 ====================

  exportData() {
    const data = {
      version: 1,
      app: 'custom-newtab',
      exportedAt: new Date().toISOString(),
      groups: this.groups,
      bookmarks: this.bookmarks.map(b => ({
        title: b.title,
        url: b.url,
        groupId: b.groupId,
        visitCount: b.visitCount,
        lastVisit: b.lastVisit
      }))
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `书签备份-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async importData(file) {
    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (error) {
      alert('导入失败：文件格式不正确或无法解析');
      return;
    }

    if (!data || typeof data !== 'object' || !Array.isArray(data.bookmarks)) {
      alert('导入失败：文件格式不正确（缺少 bookmarks 数据）');
      return;
    }

    const importGroups = Array.isArray(data.groups) ? data.groups : [];
    const importBookmarks = data.bookmarks;
    const groupMap = {};
    let newGroups = 0;

    importGroups.forEach(g => {
      if (!g || !g.id) return;
      const name = (g.name || '').trim();
      const matched = this.groups.find(x => x.name.trim() === name);
      if (matched) {
        groupMap[g.id] = matched.id;
      } else if (name) {
        const newGroup = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          order: this.groups.length
        };
        this.groups.push(newGroup);
        groupMap[g.id] = newGroup.id;
        newGroups += 1;
      }
    });

    const existingUrls = new Set(this.bookmarks.map(b => b.url));
    let added = 0;
    let skipped = 0;

    importBookmarks.forEach(b => {
      if (!b || !b.url) return;
      const url = this.ensureHttps(b.url.trim());
      if (existingUrls.has(url)) {
        skipped += 1;
        return;
      }
      const bookmark = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${added}`,
        title: (b.title || url).trim(),
        url,
        favicon: this.getFaviconUrl(url),
        visitCount: typeof b.visitCount === 'number' ? b.visitCount : 0,
        lastVisit: typeof b.lastVisit === 'number' ? b.lastVisit : 0,
        order: this.bookmarks.length,
        groupId: (b.groupId && groupMap[b.groupId]) ? groupMap[b.groupId] : 'default'
      };
      this.bookmarks.push(bookmark);
      existingUrls.add(url);
      added += 1;
    });

    await this.saveGroups();
    await this.saveBookmarks();
    this.render();

    if (added === 0 && skipped === 0) {
      alert('导入完成：文件中没有可导入的书签');
    } else {
      alert(`导入完成：新增 ${added} 个书签，跳过 ${skipped} 个重复，新建 ${newGroups} 个分组`);
    }
  }

  // ==================== 工具方法 ====================

  ensureHttps(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`;
    }
    return url;
  }

  getFaviconUrl(url) {
    const candidates = this.getFaviconCandidates(url);
    return candidates[0] || this.getFallbackFaviconDataUrl();
  }

  getFallbackFaviconDataUrl() {
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
  }

  buildExtensionFaviconUrl(url, size = 64) {
    const base = chrome.runtime.getURL('_favicon/');
    const pageUrl = encodeURIComponent(url);
    return `${base}?pageUrl=${pageUrl}&size=${size}`;
  }

  buildGoogleFaviconUrl(url, size = 64) {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  }

  buildOriginFaviconIcoUrl(url) {
    const u = new URL(url);
    return `${u.origin}/favicon.ico`;
  }

  isBlockedChromeFaviconUrl(url) {
    return typeof url === 'string' && url.startsWith('chrome://favicon/');
  }

  isGoogleS2FaviconUrl(url) {
    return typeof url === 'string' && url.includes('https://www.google.com/s2/favicons');
  }

  getFaviconCandidates(url, preferredUrl) {
    const candidates = [];
    const push = (value) => {
      if (!value || typeof value !== 'string') return;
      if (!candidates.includes(value)) candidates.push(value);
    };

    try {
      const ensuredUrl = this.ensureHttps(url);
      if (!this.isBlockedChromeFaviconUrl(preferredUrl)) push(preferredUrl);
      push(this.buildExtensionFaviconUrl(ensuredUrl));
      push(this.buildOriginFaviconIcoUrl(ensuredUrl));
      push(this.buildGoogleFaviconUrl(ensuredUrl));
    } catch {
      if (!this.isBlockedChromeFaviconUrl(preferredUrl)) push(preferredUrl);
    }

    push(this.getFallbackFaviconDataUrl());
    return candidates;
  }

  applyFaviconWithFallback(imgEl, url, preferredUrl) {
    if (!imgEl) return;
    const candidates = this.getFaviconCandidates(url, preferredUrl);
    let idx = 0;
    const advance = () => {
      idx += 1;
      if (idx >= candidates.length) {
        imgEl.onerror = null;
        return;
      }
      imgEl.src = candidates[idx];
    };
    imgEl.onerror = advance;
    imgEl.src = candidates[0];
  }

  migrateBookmarkFavicons() {
    let migratedCount = 0;
    this.bookmarks.forEach((bookmark) => {
      if (!bookmark || !bookmark.url) return;
      const shouldMigrate =
        !bookmark.favicon ||
        this.isGoogleS2FaviconUrl(bookmark.favicon) ||
        this.isBlockedChromeFaviconUrl(bookmark.favicon);
      if (!shouldMigrate) return;
      bookmark.favicon = this.getFaviconUrl(bookmark.url);
      migratedCount += 1;
    });
    return migratedCount;
  }

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new BookmarkManager();
});
