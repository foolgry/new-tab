// Popup管理类
class PopupManager {
  constructor() {
    this.currentPage = null;
    this.init();
  }

  async init() {
    await Promise.all([this.getCurrentPage(), this.renderGroupSelect()]);
    this.bindEvents();
  }

  async getCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.title) {
        const url = new URL(tab.url);

        // 排除Chrome内部页面
        if (url.protocol.startsWith('chrome://') || url.protocol === 'chrome-extension://') {
          document.getElementById('current-page').style.display = 'none';
          return;
        }

        this.currentPage = {
          title: tab.title,
          url: tab.url,
          favicon: tab.favIconUrl || this.getFaviconUrl(tab.url)
        };

        // 更新UI
        const faviconImg = document.getElementById('page-favicon');
        this.applyFaviconWithFallback(faviconImg, tab.url, this.currentPage.favicon);
        document.getElementById('page-title').textContent = this.currentPage.title;
        document.getElementById('page-url').textContent = this.formatUrl(this.currentPage.url);
        document.getElementById('bookmark-title').value = this.currentPage.title;
        document.getElementById('bookmark-url').value = this.currentPage.url;
      } else {
        document.getElementById('current-page').style.display = 'none';
      }
    } catch (error) {
      console.error('获取当前页面信息失败:', error);
      document.getElementById('current-page').style.display = 'none';
    }
  }

  bindEvents() {
    // 表单提交
    document.getElementById('add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addToBookmarks();
    });

    // 查看所有书签
    document.getElementById('view-bookmarks').addEventListener('click', () => {
      this.openBookmarksPage();
    });
  }

  async addToBookmarks() {
    const title = document.getElementById('bookmark-title').value.trim();
    const url = document.getElementById('bookmark-url').value.trim();
    const groupId = document.getElementById('bookmark-group').value;
    const submitBtn = document.getElementById('submit-btn');

    if (!title || !url) return;

    const ensuredUrl = this.ensureHttps(url);

    submitBtn.disabled = true;
    submitBtn.textContent = '添加中...';

    try {
      const bookmarks = await this.loadBookmarks();

      // 检查是否已存在相同URL的书签
      const existingBookmark = bookmarks.find(b => b.url === ensuredUrl);
      if (existingBookmark) {
        this.showMessage('该书签已存在！', 'error');
        return;
      }

      const bookmark = {
        id: Date.now().toString(),
        title,
        url: ensuredUrl,
        favicon: (this.currentPage && this.currentPage.favicon) ? this.currentPage.favicon : this.getFaviconUrl(ensuredUrl),
        visitCount: 0,
        lastVisit: 0,
        order: bookmarks.length,
        groupId: groupId,
        updatedAt: Date.now(),
        visits: {}
      };

      bookmarks.push(bookmark);
      await this.saveBookmarks(bookmarks);

      this.showMessage('书签添加成功！', 'success');

      // 2秒后关闭弹窗
      setTimeout(() => {
        window.close();
      }, 2000);

    } catch (error) {
      console.error('添加书签失败:', error);
      this.showMessage('添加失败，请重试！', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '添加到书签';
    }
  }

  async loadBookmarks() {
    try {
      const result = await chrome.storage.local.get(['bookmarks']);
      return result.bookmarks || [];
    } catch (error) {
      console.error('加载书签失败:', error);
      return [];
    }
  }

  async saveBookmarks(bookmarks) {
    try {
      await chrome.storage.local.set({ bookmarks });
    } catch (error) {
      console.error('保存书签失败:', error);
      throw error;
    }
  }

  showMessage(text, type = 'success') {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';

    // 3秒后自动隐藏
    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 3000);
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

  formatUrl(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  openBookmarksPage() {
    chrome.tabs.create({ url: 'chrome://newtab' });
    window.close();
  }

  // 加载分组
  async loadGroups() {
    try {
      const result = await chrome.storage.local.get(['groups', 'currentGroupId']);
      let groups = result.groups || [];

      // 确保默认分组存在
      if (groups.length === 0) {
        groups = [{ id: 'default', name: '默认分组', order: 0 }];
      }

      return groups;
    } catch (error) {
      console.error('加载分组失败:', error);
      return [{ id: 'default', name: '默认分组', order: 0 }];
    }
  }

  // 渲染分组选择下拉框
  async renderGroupSelect() {
    const groups = await this.loadGroups();
    const result = await chrome.storage.local.get(['currentGroupId']);
    const currentGroupId = result.currentGroupId || 'default';

    const select = document.getElementById('bookmark-group');
    select.innerHTML = '';

    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;

      // 默认选中当前分组
      if (group.id === currentGroupId) {
        option.selected = true;
      }

      select.appendChild(option);
    });
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
