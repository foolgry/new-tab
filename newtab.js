// 常见 WebDAV 服务商预设：固定地址的只需填账号和密钥
const WEBDAV_PRESETS = [
  {
    id: 'jianguoyun',
    name: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    hint: '账号填注册邮箱；密钥填「账户信息 → 安全选项 → 第三方应用管理」里生成的应用密码。'
  },
  {
    id: 'pcloud',
    name: 'pCloud',
    url: 'https://webdav.pcloud.com/',
    hint: '账号填 pCloud 邮箱；密钥填密码（建议使用应用专用密码）。'
  },
  {
    id: 'yandex',
    name: 'Yandex Disk',
    url: 'https://webdav.yandex.ru/',
    hint: '账号填 Yandex 邮箱；密钥填「应用密码」，不是登录密码。'
  },
  {
    id: 'infini-cloud',
    name: 'InfiniCLOUD',
    url: 'https://your-server.teracloud.jp/dav/',
    hint: '把 your-server 替换为注册时分配的服务器名。'
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    url: 'https://your-host/remote.php/dav/files/your-username/',
    hint: '替换 your-host 和 your-username，地址需以 / 结尾。'
  },
  {
    id: 'synology',
    name: '群晖 NAS',
    url: 'https://your-host:5006/',
    hint: '先在 DSM 中开启 WebDAV Server；HTTPS 默认端口 5006。'
  },
  {
    id: 'alist',
    name: 'AList',
    url: 'http://your-host:5244/dav/',
    hint: 'AList 默认端口 5244；本地 HTTP 地址也可使用。'
  },
  {
    id: 'custom',
    name: '自定义',
    url: '',
    hint: '填写已存在的 WebDAV 目录地址，需以 / 结尾；同步文件会写入该目录下。'
  }
];

// 书签管理类
class BookmarkManager {
  constructor() {
    this.bookmarks = [];
    this.groups = [];
    this.tombstones = { bookmarks: {}, groups: {} };
    this.deviceId = '';
    this.currentGroupId = 'default';
    this.sortBy = 'frequency';
    this.draggedElement = null;
    this.draggedBookmark = null;

    this.searchKeyword = '';
    this.collapsedGroups = new Set();
    this.reloadTimer = null;
    this.syncStatus = null;

    this.init();
  }

  async init() {
    this.deviceId = await this.loadDeviceId();
    await this.loadData();
    this.bindGlobalEvents();
    this.bindStorageSync();
    this.render();
    this.loadSyncStatus();
    this.autoSync();
  }

  // ==================== 数据加载 / 保存 ====================

  async loadDeviceId() {
    try {
      const result = await chrome.storage.local.get('deviceId');
      if (result.deviceId) return result.deviceId;
      const deviceId = SyncCore.randomId();
      await chrome.storage.local.set({ deviceId });
      return deviceId;
    } catch (error) {
      console.error('加载设备标识失败:', error);
      return SyncCore.randomId();
    }
  }

  async loadData() {
    try {
      const result = await chrome.storage.local.get(['bookmarks', 'groups', 'currentGroupId', 'tombstones']);
      const normalized = SyncCore.normalizeLocalState(result, this.deviceId);

      this.bookmarks = normalized.bookmarks;
      this.groups = normalized.groups;
      this.tombstones = normalized.tombstones;
      this.currentGroupId = result.currentGroupId || 'default';
      if (!this.groups.some(group => group.id === this.currentGroupId)) {
        this.currentGroupId = 'default';
      }

      const migratedCount = this.migrateBookmarkFavicons();
      if (normalized.changed || migratedCount > 0) {
        await this.saveAll();
      }
    } catch (error) {
      console.error('加载书签失败:', error);
      this.bookmarks = [];
      this.groups = [{ id: 'default', name: '默认分组', order: 0, updatedAt: 0 }];
      this.tombstones = { bookmarks: {}, groups: {} };
    }
  }

  async saveAll() {
    try {
      await chrome.storage.local.set({
        bookmarks: this.bookmarks,
        groups: this.groups,
        tombstones: this.tombstones
      });
    } catch (error) {
      console.error('保存数据失败:', error);
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
    document.getElementById('sync-modal').addEventListener('click', (e) => {
      if (e.target.id === 'sync-modal') this.hideSyncModal();
    });

    // 云同步表单
    document.getElementById('sync-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSyncConfig();
    });
    document.getElementById('sync-test').addEventListener('click', () => this.testSyncConnection());
    document.getElementById('sync-disable').addEventListener('click', () => this.disableSync());
    document.getElementById('sync-provider').addEventListener('change', (e) => this.applySyncPreset(e.target.value));

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
        <button id="sync-btn" class="icon-btn sync-btn" title="云同步">☁</button>
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

    document.getElementById('sync-btn').addEventListener('click', () => this.showSyncModal());
    document.getElementById('add-bookmark').addEventListener('click', () => this.showAddModal());
    document.getElementById('add-group').addEventListener('click', () => this.showAddGroupModal());
    document.getElementById('export-btn').addEventListener('click', () => this.exportData());
    document.getElementById('import-btn').addEventListener('click', () => {
      const f = document.getElementById('import-file');
      if (f) f.click();
    });
    document.getElementById('sort-custom').addEventListener('click', () => this.setSortMode('custom'));
    document.getElementById('sort-frequency').addEventListener('click', () => this.setSortMode('frequency'));
    this.applySyncButtonState();
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
          <img alt="${this.escapeHtml(bookmark.title)}" loading="lazy" decoding="async">
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

      const before = new Map(this.bookmarks.map(b => [b.id, { order: b.order, groupId: b.groupId }]));

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
      const now = Date.now();
      this.bookmarks.forEach((b, i) => {
        b.order = i;
        const previous = before.get(b.id);
        if (!previous || previous.order !== i || previous.groupId !== b.groupId) {
          b.updatedAt = now;
        }
      });
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
      order: this.groups.length,
      updatedAt: Date.now()
    };
    this.groups.push(group);
    await this.saveGroups();
    this.renderColumns();
  }

  async deleteGroup(groupId) {
    if (groupId === 'default') return;
    const confirmed = confirm('删除分组后，该分组下的书签将移至默认分组。确定删除吗？');
    if (!confirmed) return;

    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      this.tombstones.groups[SyncCore.normalizeGroupName(group.name)] = Date.now();
    }

    const now = Date.now();
    this.bookmarks.forEach(b => {
      if (b.groupId === groupId) {
        b.groupId = 'default';
        b.updatedAt = now;
      }
    });
    const index = this.groups.findIndex(g => g.id === groupId);
    if (index !== -1) this.groups.splice(index, 1);
    this.groups.forEach((g, i) => { g.order = i; });

    await this.saveAll();

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
      groupId,
      updatedAt: Date.now(),
      visits: {}
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
      const [removed] = this.bookmarks.splice(index, 1);
      this.tombstones.bookmarks[SyncCore.normalizeUrl(removed.url)] = Date.now();
      await this.saveAll();
      this.render();
    }
  }

  async openBookmark(bookmark) {
    bookmark.visits = bookmark.visits || {};
    bookmark.visits[this.deviceId] = (bookmark.visits[this.deviceId] || 0) + 1;
    bookmark.visitCount = SyncCore.sumVisits(bookmark.visits);
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
      version: 2,
      schema: 2,
      app: 'custom-newtab',
      exportedAt: new Date().toISOString(),
      deviceId: this.deviceId,
      groups: this.groups,
      bookmarks: this.bookmarks,
      tombstones: this.tombstones
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
          order: this.groups.length,
          updatedAt: Number(g.updatedAt) || Date.now()
        };
        this.groups.push(newGroup);
        groupMap[g.id] = newGroup.id;
        newGroups += 1;
      }
    });

    const existingUrls = new Set(this.bookmarks.map(b => SyncCore.normalizeUrl(b.url)));
    let added = 0;
    let skipped = 0;

    importBookmarks.forEach(b => {
      if (!b || !b.url) return;
      const url = this.ensureHttps(b.url.trim());
      const normalizedUrl = SyncCore.normalizeUrl(url);
      if (existingUrls.has(normalizedUrl)) {
        skipped += 1;
        return;
      }

      let visits = SyncCore.normalizeVisits(b.visits);
      if (Object.keys(visits).length === 0 && typeof b.visitCount === 'number' && b.visitCount > 0) {
        visits = { [this.deviceId]: Math.floor(b.visitCount) };
      }

      const bookmark = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${added}`,
        title: (b.title || url).trim(),
        url,
        favicon: this.getFaviconUrl(url),
        visitCount: SyncCore.sumVisits(visits),
        lastVisit: typeof b.lastVisit === 'number' ? b.lastVisit : 0,
        order: this.bookmarks.length,
        groupId: (b.groupId && groupMap[b.groupId]) ? groupMap[b.groupId] : 'default',
        updatedAt: Number(b.updatedAt) || Date.now(),
        visits
      };
      this.bookmarks.push(bookmark);
      existingUrls.add(normalizedUrl);
      added += 1;
    });

    if (data.tombstones) {
      this.tombstones = SyncCore.mergeTombstones(this.tombstones, data.tombstones);
    }

    await this.saveAll();
    this.render();

    if (added === 0 && skipped === 0) {
      alert('导入完成：文件中没有可导入的书签');
    } else {
      alert(`导入完成：新增 ${added} 个书签，跳过 ${skipped} 个重复，新建 ${newGroups} 个分组`);
    }
  }

  // ==================== 云同步 ====================

  bindStorageSync() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!('bookmarks' in changes) && !('groups' in changes) && !('tombstones' in changes)) return;
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.reloadFromStorage(), 250);
    });
  }

  async reloadFromStorage() {
    try {
      const result = await chrome.storage.local.get(['bookmarks', 'groups', 'tombstones']);
      const normalized = SyncCore.normalizeLocalState(result, this.deviceId);
      const currentSignature = SyncCore.signature({
        bookmarks: this.bookmarks,
        groups: this.groups,
        tombstones: this.tombstones
      });
      if (currentSignature === SyncCore.signature(normalized)) return;

      this.bookmarks = normalized.bookmarks;
      this.groups = normalized.groups;
      this.tombstones = normalized.tombstones;
      if (!this.groups.some(group => group.id === this.currentGroupId)) {
        this.currentGroupId = 'default';
      }
      this.render();
    } catch (error) {
      console.error('刷新同步数据失败:', error);
    }
  }

  sendSyncMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: '后台没有响应' });
      });
    });
  }

  async loadSyncStatus() {
    const status = await this.sendSyncMessage({ action: 'sync:getStatus' });
    if (status && status.ok !== false) this.updateSyncButton(status);
  }

  async autoSync() {
    const result = await chrome.storage.local.get('syncConfig');
    if (!result.syncConfig || !result.syncConfig.enabled) return;
    const status = await this.sendSyncMessage({ action: 'sync:now', reason: 'page-open', force: false });
    if (status) this.updateSyncButton(status);
  }

  updateSyncButton(status) {
    if (!status) return;
    this.syncStatus = status;
    this.applySyncButtonState();
  }

  applySyncButtonState() {
    const button = document.getElementById('sync-btn');
    if (!button) return;
    const status = this.syncStatus;
    if (!status) {
      button.title = '云同步';
      return;
    }
    button.classList.toggle('sync-on', !!status.enabled && !!status.lastSyncOk);
    button.classList.toggle('sync-error', !!status.enabled && !status.lastSyncOk);
    if (!status.enabled) {
      button.title = '云同步（未开启）';
      return;
    }
    button.title = status.lastSyncOk
      ? `云同步已开启 · ${this.formatSyncTime(status.lastSyncAt)}`
      : `云同步异常：${status.lastSyncError || '尚未同步'}`;
  }

  renderSyncProviders() {
    const select = document.getElementById('sync-provider');
    if (!select || select.options.length > 0) return;
    WEBDAV_PRESETS.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      select.appendChild(option);
    });
  }

  applySyncPreset(providerId, overwriteUrl = true) {
    const preset = WEBDAV_PRESETS.find(item => item.id === providerId);
    if (!preset) return;
    const hint = document.getElementById('sync-url-hint');
    if (hint) hint.textContent = preset.hint || '';
    if (!overwriteUrl) return;
    const urlInput = document.getElementById('sync-url');
    if (urlInput) urlInput.value = preset.url || '';
  }

  async showSyncModal() {
    this.renderSyncProviders();
    const status = await this.sendSyncMessage({ action: 'sync:getStatus' });
    const config = status && status.ok !== false ? status : {};

    document.getElementById('sync-provider').value = config.providerId || 'custom';
    document.getElementById('sync-url').value = config.url || '';
    document.getElementById('sync-username').value = config.username || '';
    document.getElementById('sync-filename').value = config.filename || 'newtab-bookmarks.json';

    const passwordInput = document.getElementById('sync-password');
    passwordInput.value = '';
    passwordInput.placeholder = config.hasPassword ? '已保存密码，留空则不修改' : '填写应用密码或密钥';

    this.applySyncPreset(config.providerId || 'custom', false);

    if (config.enabled) {
      const message = config.lastSyncOk
        ? `同步已开启，最近同步：${this.formatSyncTime(config.lastSyncAt)}`
        : `同步异常：${config.lastSyncError || '尚未成功同步'}`;
      this.setSyncStatus(message, config.lastSyncOk ? 'ok' : 'error');
    } else {
      this.setSyncStatus('');
    }

    document.getElementById('sync-modal').style.display = 'flex';
  }

  hideSyncModal() {
    document.getElementById('sync-modal').style.display = 'none';
  }

  collectSyncForm() {
    return {
      providerId: document.getElementById('sync-provider').value,
      url: document.getElementById('sync-url').value.trim(),
      username: document.getElementById('sync-username').value.trim(),
      password: document.getElementById('sync-password').value,
      filename: document.getElementById('sync-filename').value.trim() || 'newtab-bookmarks.json'
    };
  }

  async requestSyncOriginPermission(url) {
    let origin;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('协议不支持');
      origin = `${parsed.protocol}//${parsed.host}/*`;
    } catch {
      return { ok: false, error: 'WebDAV 地址格式不正确，需要以 http:// 或 https:// 开头' };
    }

    try {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) return { ok: false, error: '未授权访问该域名，无法同步' };
      return { ok: true, origin };
    } catch (error) {
      return { ok: false, error: `授权失败：${error.message}` };
    }
  }

  async saveSyncConfig() {
    const form = this.collectSyncForm();
    if (!form.url) {
      this.setSyncStatus('请填写 WebDAV 地址', 'error');
      return;
    }

    this.setSyncStatus('正在请求访问该域名的权限...');
    const permission = await this.requestSyncOriginPermission(form.url);
    if (!permission.ok) {
      this.setSyncStatus(permission.error, 'error');
      return;
    }

    this.setSyncStatus('正在保存并同步...');
    const response = await this.sendSyncMessage({ action: 'sync:saveConfig', config: form });
    if (!response || !response.ok) {
      this.setSyncStatus((response && response.error) || '保存失败', 'error');
      return;
    }

    this.updateSyncButton(response);
    if (response.sync && response.sync.ok === false) {
      this.setSyncStatus(`配置已保存，但首次同步失败：${response.sync.error}`, 'error');
      return;
    }

    this.setSyncStatus(`同步完成 · ${this.formatSyncTime(response.lastSyncAt)}`, 'ok');
    this.renderSyncProviders();
    await this.reloadFromStorage();
  }

  async testSyncConnection() {
    const form = this.collectSyncForm();
    if (!form.url) {
      this.setSyncStatus('请先填写 WebDAV 地址', 'error');
      return;
    }
    const permission = await this.requestSyncOriginPermission(form.url);
    if (!permission.ok) {
      this.setSyncStatus(permission.error, 'error');
      return;
    }
    this.setSyncStatus('正在测试连接...');
    const response = await this.sendSyncMessage({ action: 'sync:testConnection', config: form });
    this.setSyncStatus(
      (response && response.message) || (response && response.ok ? '连接成功' : '连接失败'),
      response && response.ok ? 'ok' : 'error'
    );
  }

  async disableSync() {
    if (!confirm('确定关闭云同步吗？本地书签不会被删除。')) return;
    const response = await this.sendSyncMessage({ action: 'sync:disable' });
    if (response && response.ok) {
      this.updateSyncButton(response);
      this.setSyncStatus('云同步已关闭，本地数据保持不变', 'ok');
    } else {
      this.setSyncStatus((response && response.error) || '关闭失败', 'error');
    }
  }

  setSyncStatus(text, type) {
    const element = document.getElementById('sync-status');
    if (!element) return;
    element.textContent = text || '';
    element.className = `sync-status${type ? ` ${type}` : ''}`;
  }

  formatSyncTime(timestamp) {
    if (!timestamp) return '尚未同步';
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const today = new Date();
    const isToday = date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    if (isToday) return time;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
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
