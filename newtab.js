// 书签管理类
class BookmarkManager {
  constructor() {
    this.bookmarks = [];
    this.groups = [];
    this.currentGroupId = 'default';
    this.sortBy = 'frequency'; // 'custom' 或 'frequency'
    this.draggedElement = null;
    this.init();
  }

  async init() {
    await Promise.all([this.loadBookmarks(), this.loadGroups()]);
    this.bindEvents();
    this.renderGroups();
    this.render();
  }

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

      // 初始化默认分组
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

      // 恢复上次选中的分组
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

  bindEvents() {
    // 添加书签按钮
    document.getElementById('add-bookmark-btn').addEventListener('click', () => {
      this.showAddModal();
    });

    // 排序按钮
    document.getElementById('sort-custom').addEventListener('click', () => {
      this.setSortMode('custom');
    });

    document.getElementById('sort-frequency').addEventListener('click', () => {
      this.setSortMode('frequency');
    });

    // 弹窗事件
    document.getElementById('cancel-add').addEventListener('click', () => {
      this.hideAddModal();
    });

    document.getElementById('add-bookmark-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addBookmark();
    });

    // 点击弹窗外部关闭
    document.getElementById('add-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-modal') {
        this.hideAddModal();
      }
    });

    // 添加分组按钮
    document.getElementById('add-group-btn').addEventListener('click', () => {
      this.showAddGroupModal();
    });

    // 添加分组弹窗事件
    document.getElementById('cancel-add-group').addEventListener('click', () => {
      this.hideAddGroupModal();
    });

    document.getElementById('add-group-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const groupName = document.getElementById('group-name').value.trim();
      if (groupName) {
        this.addGroup(groupName);
        this.hideAddGroupModal();
      }
    });

    // 点击添加分组弹窗外部关闭
    document.getElementById('add-group-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-group-modal') {
        this.hideAddGroupModal();
      }
    });

    // 点击其他地方关闭右键菜单
    document.addEventListener('click', () => {
      const menu = document.querySelector('.context-menu');
      if (menu) menu.remove();
    });
  }

  showAddModal() {
    this.renderGroupSelect();
    document.getElementById('add-modal').style.display = 'flex';
    document.getElementById('bookmark-title').focus();
  }

  hideAddModal() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('add-bookmark-form').reset();
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
      groupId: groupId
    };

    this.bookmarks.push(bookmark);
    await this.saveBookmarks();
    this.render();
    this.hideAddModal();
  }

  async deleteBookmark(id) {
    if (confirm('确定要删除这个书签吗？')) {
      const index = this.bookmarks.findIndex(b => b.id === id);
      if (index !== -1) {
        this.bookmarks.splice(index, 1);
        await this.saveBookmarks();
        this.render();
      }
    }
  }

  async openBookmark(bookmark) {
    // 更新访问统计
    bookmark.visitCount++;
    bookmark.lastVisit = Date.now();
    await this.saveBookmarks();

    // 打开链接
    window.open(bookmark.url, '_self');
  }

  setSortMode(mode) {
    this.sortBy = mode;

    // 更新按钮状态
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById(`sort-${mode}`).classList.add('active');

    this.render();
  }

  getSortedBookmarks() {
    // 只获取当前分组的书签
    const filtered = this.bookmarks.filter(b => b.groupId === this.currentGroupId);
    const sorted = [...filtered];

    if (this.sortBy === 'frequency') {
      return sorted.sort((a, b) => b.visitCount - a.visitCount);
    } else {
      return sorted.sort((a, b) => a.order - b.order);
    }
  }

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

      if (!this.isBlockedChromeFaviconUrl(preferredUrl)) {
        push(preferredUrl);
      }

      push(this.buildExtensionFaviconUrl(ensuredUrl));
      push(this.buildOriginFaviconIcoUrl(ensuredUrl));
      push(this.buildGoogleFaviconUrl(ensuredUrl));
    } catch {
      if (!this.isBlockedChromeFaviconUrl(preferredUrl)) {
        push(preferredUrl);
      }
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
      if (!bookmark) return;
      if (!bookmark.url) return;

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

  formatUrl(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // 拖拽功能
  initDragAndDrop(element, bookmark) {
    element.draggable = this.sortBy === 'custom';

    element.addEventListener('dragstart', (e) => {
      if (this.sortBy !== 'custom') {
        e.preventDefault();
        return;
      }
      this.draggedElement = element;
      element.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', element.innerHTML);
      e.dataTransfer.setData('bookmarkId', bookmark.id);
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    element.addEventListener('drop', async (e) => {
      e.preventDefault();

      if (!this.draggedElement || this.draggedElement === element) return;

      const draggedId = this.draggedElement.dataset.id;
      const targetId = element.dataset.id;

      const draggedIndex = this.bookmarks.findIndex(b => b.id === draggedId);
      const targetIndex = this.bookmarks.findIndex(b => b.id === targetId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [draggedBookmark] = this.bookmarks.splice(draggedIndex, 1);
        this.bookmarks.splice(targetIndex, 0, draggedBookmark);

        // 更新order值
        this.bookmarks.forEach((bookmark, index) => {
          bookmark.order = index;
        });

        await this.saveBookmarks();
        this.render();
      }
    });

    element.addEventListener('dragend', () => {
      element.classList.remove('dragging');
      this.draggedElement = null;
    });
  }

  render() {
    const container = document.getElementById('bookmarks-grid');
    const sortedBookmarks = this.getSortedBookmarks();

    container.innerHTML = '';

    if (sortedBookmarks.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #666;">
          <p style="font-size: 1.2rem; margin-bottom: 1rem;">还没有书签</p>
          <p style="color: #999;">点击"添加书签"按钮开始添加你喜欢的网站</p>
        </div>
      `;
      return;
    }

    sortedBookmarks.forEach(bookmark => {
      const card = document.createElement('div');
      card.className = 'bookmark-card';
      card.dataset.id = bookmark.id;

      card.innerHTML = `
        <div class="bookmark-favicon">
          <img alt="${bookmark.title}">
        </div>
        <div class="bookmark-info">
          <h3 class="bookmark-title">${bookmark.title}</h3>
          <p class="bookmark-url">${this.formatUrl(bookmark.url)}</p>
        </div>
        <div class="bookmark-actions">
          <button class="delete-btn">×</button>
        </div>
      `;

      this.applyFaviconWithFallback(
        card.querySelector('.bookmark-favicon img'),
        bookmark.url,
        bookmark.favicon
      );

      // 绑定事件
      card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('delete-btn')) {
          this.openBookmark(bookmark);
        }
      });

      card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteBookmark(bookmark.id);
      });

      // 初始化拖拽
      this.initDragAndDrop(card, bookmark);

      container.appendChild(card);
    });
  }

  // 渲染分组列表
  renderGroups() {
    const container = document.getElementById('groups-list');
    container.innerHTML = '';

    // 按 order 排序
    const sortedGroups = [...this.groups].sort((a, b) => a.order - b.order);

    sortedGroups.forEach(group => {
      const item = document.createElement('div');
      item.className = `group-item ${group.id === this.currentGroupId ? 'active' : ''}`;
      item.dataset.id = group.id;
      item.textContent = group.name;

      // 点击切换分组
      item.addEventListener('click', () => {
        this.switchGroup(group.id);
      });

      // 右键菜单（默认分组不显示）
      if (group.id !== 'default') {
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showContextMenu(e, group.id);
        });
      }

      // 拖放接收
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');

        const bookmarkId = e.dataTransfer.getData('bookmarkId');
        if (bookmarkId) {
          await this.moveBookmarkToGroup(bookmarkId, group.id);
        }
      });

      container.appendChild(item);
    });
  }

  // 切换分组
  async switchGroup(groupId) {
    this.currentGroupId = groupId;
    await this.saveCurrentGroupId();
    this.renderGroups();
    this.render();
  }

  // 添加分组
  async addGroup(name) {
    const group = {
      id: Date.now().toString(),
      name: name.trim(),
      order: this.groups.length
    };

    this.groups.push(group);
    await this.saveGroups();

    // 自动切换到新分组
    await this.switchGroup(group.id);
  }

  // 删除分组
  async deleteGroup(groupId) {
    if (groupId === 'default') return;

    const confirmed = confirm('删除分组后，该分组下的书签将移至默认分组。确定删除吗？');
    if (!confirmed) return;

    // 将该分组下的书签移到默认分组
    this.bookmarks.forEach(bookmark => {
      if (bookmark.groupId === groupId) {
        bookmark.groupId = 'default';
      }
    });

    // 删除分组
    const index = this.groups.findIndex(g => g.id === groupId);
    if (index !== -1) {
      this.groups.splice(index, 1);
    }

    // 更新分组 order
    this.groups.forEach((group, index) => {
      group.order = index;
    });

    await this.saveBookmarks();
    await this.saveGroups();

    // 如果删除的是当前分组，切换到默认分组
    if (this.currentGroupId === groupId) {
      await this.switchGroup('default');
    } else {
      this.renderGroups();
      this.render();
    }
  }

  // 移动书签到分组
  async moveBookmarkToGroup(bookmarkId, groupId) {
    const bookmark = this.bookmarks.find(b => b.id === bookmarkId);
    if (bookmark && bookmark.groupId !== groupId) {
      bookmark.groupId = groupId;
      await this.saveBookmarks();

      // 如果移动后当前分组不包含该书签，重新渲染
      this.render();
    }
  }

  // 显示右键菜单
  showContextMenu(event, groupId) {
    // 移除旧菜单
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

  // 渲染分组选择下拉框
  renderGroupSelect() {
    const select = document.getElementById('bookmark-group');
    select.innerHTML = '';

    this.groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;

      // 默认选中当前分组
      if (group.id === this.currentGroupId) {
        option.selected = true;
      }

      select.appendChild(option);
    });
  }

  // 显示添加分组弹窗
  showAddGroupModal() {
    document.getElementById('add-group-modal').style.display = 'flex';
    document.getElementById('group-name').focus();
  }

  // 隐藏添加分组弹窗
  hideAddGroupModal() {
    document.getElementById('add-group-modal').style.display = 'none';
    document.getElementById('add-group-form').reset();
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new BookmarkManager();
});
