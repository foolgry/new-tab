// Background Service Worker for Chrome Extension

// 监听扩展安装事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('书签扩展已安装');
  initializeDefaultBookmarks();
});

// 初始化默认书签和分组
async function initializeDefaultBookmarks() {
  try {
    const result = await chrome.storage.local.get(['bookmarks', 'groups']);

    // 初始化默认分组
    if (!result.groups || result.groups.length === 0) {
      const defaultGroups = [{
        id: 'default',
        name: '默认分组',
        order: 0
      }];
      await chrome.storage.local.set({ groups: defaultGroups });
      console.log('默认分组已初始化');
    }

    // 初始化默认书签
    if (!result.bookmarks || result.bookmarks.length === 0) {
      const defaultBookmarks = [
        {
          id: '1',
          title: 'Google',
          url: 'https://www.google.com',
          favicon: 'https://www.google.com/favicon.ico',
          visitCount: 0,
          lastVisit: 0,
          order: 0,
          groupId: 'default'
        },
        {
          id: '2',
          title: 'GitHub',
          url: 'https://github.com',
          favicon: 'https://github.com/favicon.ico',
          visitCount: 0,
          lastVisit: 0,
          order: 1,
          groupId: 'default'
        },
        {
          id: '3',
          title: 'Stack Overflow',
          url: 'https://stackoverflow.com',
          favicon: 'https://stackoverflow.com/favicon.ico',
          visitCount: 0,
          lastVisit: 0,
          order: 2,
          groupId: 'default'
        }
      ];

      await chrome.storage.local.set({ bookmarks: defaultBookmarks });
      console.log('默认书签已初始化');
    }
  } catch (error) {
    console.error('初始化默认数据失败:', error);
  }
}

// 监听标签页更新事件（用于访问统计）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      // 排除Chrome内部页面
      const url = new URL(tab.url);
      if (url.protocol.startsWith('chrome://') || url.protocol === 'chrome-extension://') {
        return;
      }

      // 检查是否是书签网站
      const result = await chrome.storage.local.get(['bookmarks']);
      const bookmarks = result.bookmarks || [];

      const bookmark = bookmarks.find(b =>
        new URL(b.url).hostname === url.hostname
      );

      if (bookmark) {
        // 更新访问统计
        bookmark.visitCount++;
        bookmark.lastVisit = Date.now();

        await chrome.storage.local.set({ bookmarks });
        console.log(`更新了 ${bookmark.title} 的访问统计`);
      }
    } catch (error) {
      console.error('更新访问统计失败:', error);
    }
  }
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addBookmark') {
    addBookmarkFromMessage(request.bookmark)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开放
  }
});

async function addBookmarkFromMessage(bookmarkData) {
  try {
    const result = await chrome.storage.local.get(['bookmarks']);
    const bookmarks = result.bookmarks || [];

    // 检查是否已存在
    const exists = bookmarks.find(b => b.url === bookmarkData.url);
    if (exists) {
      throw new Error('该书签已存在');
    }

    const newBookmark = {
      id: Date.now().toString(),
      ...bookmarkData,
      visitCount: 0,
      lastVisit: 0,
      order: bookmarks.length
    };

    bookmarks.push(newBookmark);
    await chrome.storage.local.set({ bookmarks });

    return newBookmark;
  } catch (error) {
    throw error;
  }
}