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

// 访问统计：仅在用户从新标签页点击书签时计数（见 newtab.js 的 openBookmark）

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