// 书签数据迁移脚本
// 在浏览器控制台执行此脚本，将现有书签迁移到新的分组数据结构

(async function migrateBookmarks() {
  try {
    console.log('🔄 开始迁移书签数据...');

    // 读取现有数据
    const result = await chrome.storage.local.get(['bookmarks', 'groups']);
    const bookmarks = result.bookmarks || [];

    console.log(`📚 找到 ${bookmarks.length} 个书签`);

    // 为所有书签添加 groupId 字段
    let migratedCount = 0;
    bookmarks.forEach(bookmark => {
      if (!bookmark.groupId) {
        bookmark.groupId = 'default';
        migratedCount++;
      }
    });

    // 初始化默认分组（如果不存在）
    let groups = result.groups || [];
    if (groups.length === 0) {
      groups = [{
        id: 'default',
        name: '默认分组',
        order: 0
      }];
      console.log('✅ 创建默认分组');
    }

    // 保存数据
    await chrome.storage.local.set({
      bookmarks: bookmarks,
      groups: groups,
      currentGroupId: 'default'
    });

    console.log(`✅ 迁移完成！`);
    console.log(`   - 更新了 ${migratedCount} 个书签`);
    console.log(`   - 分组数量: ${groups.length}`);
    console.log(`   - 当前选中: 默认分组`);

    // 显示迁移后的数据预览
    console.log('📋 书签预览:', bookmarks.slice(0, 3).map(b => ({
      title: b.title,
      groupId: b.groupId
    })));

  } catch (error) {
    console.error('❌ 迁移失败:', error);
  }
})();
