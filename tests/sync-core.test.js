/* eslint-disable no-console */
// 运行：node tests/sync-core.test.js
const assert = require('assert');

globalThis.self = globalThis;
require('../sync-core.js');

const S = globalThis.SyncCore;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('URL 规范化：不同写法视为同一个书签', () => {
  assert.strictEqual(S.normalizeUrl('example.com'), 'https://example.com/');
  assert.strictEqual(S.normalizeUrl('https://example.com'), 'https://example.com/');
  assert.strictEqual(S.normalizeUrl('HTTPS://Example.COM/'), 'https://example.com/');
  assert.strictEqual(S.normalizeUrl('not a url'), '');
});

test('本地旧数据补全 visits / updatedAt', () => {
  const state = S.normalizeLocalState({
    bookmarks: [{ id: '1', title: 'A', url: 'https://a.com', visitCount: 7, groupId: 'g1' }],
    groups: [{ id: 'g1', name: '工作', order: 0 }],
  }, 'device-1', 1000);

  assert.strictEqual(state.bookmarks[0].visits['device-1'], 7);
  assert.strictEqual(state.bookmarks[0].visitCount, 7);
  assert.strictEqual(state.bookmarks[0].updatedAt, 1000);
  assert.strictEqual(state.groups[0].updatedAt, 0);
  assert.strictEqual(state.changed, true);
});

test('合并：两端书签取并集', () => {
  const local = S.buildSnapshot({
    groups: [{ id: 'default', name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [{ id: '1', title: 'A', url: 'https://a.com', groupId: 'default', visits: {}, updatedAt: 100 }],
    tombstones: {},
  }, 'device-1', 100);

  const remote = {
    schema: 2,
    groups: [{ name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [{ url: 'https://b.com', title: 'B', groupName: '默认分组', visits: {}, updatedAt: 100 }],
    tombstones: { bookmarks: {}, groups: {} },
  };

  const merged = S.mergeSnapshots(local, remote, 200);
  assert.deepStrictEqual(merged.bookmarks.map(item => item.url).sort(), ['https://a.com/', 'https://b.com/']);
});

test('合并：较新的标题和分组胜出', () => {
  const local = S.buildSnapshot({
    groups: [
      { id: 'default', name: '默认分组', order: 0, updatedAt: 0 },
      { id: 'g1', name: '工作', order: 1, updatedAt: 0 },
    ],
    bookmarks: [{ id: '1', title: '旧标题', url: 'https://a.com', groupId: 'default', visits: {}, updatedAt: 100 }],
    tombstones: {},
  }, 'device-1', 100);

  const remote = {
    schema: 2,
    groups: [
      { name: '默认分组', order: 0, updatedAt: 0 },
      { name: '工作', order: 1, updatedAt: 0 },
    ],
    bookmarks: [{ url: 'https://a.com', title: '新标题', groupName: '工作', visits: {}, updatedAt: 300 }],
    tombstones: { bookmarks: {}, groups: {} },
  };

  const merged = S.mergeSnapshots(local, remote, 400);
  const bookmark = merged.bookmarks.find(item => item.url === 'https://a.com/');
  assert.strictEqual(bookmark.title, '新标题');
  assert.strictEqual(bookmark.groupName, '工作');
});

test('合并：删除标记优先，且重新添加后可复活', () => {
  const local = S.buildSnapshot({
    groups: [{ id: 'default', name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [{ id: '1', title: 'A', url: 'https://a.com', groupId: 'default', visits: {}, updatedAt: 1000 }],
    tombstones: {},
  }, 'device-1', 1000);

  const remoteDeleted = {
    schema: 2,
    groups: [{ name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [],
    tombstones: { bookmarks: { 'https://a.com/': 2000 }, groups: {} },
  };

  const deleted = S.mergeSnapshots(local, remoteDeleted, 3000);
  assert.strictEqual(deleted.bookmarks.length, 0);

  const readded = S.buildSnapshot({
    groups: [{ id: 'default', name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [{ id: '1', title: 'A', url: 'https://a.com', groupId: 'default', visits: {}, updatedAt: 3000 }],
    tombstones: {},
  }, 'device-1', 3000);
  const revived = S.mergeSnapshots(readded, remoteDeleted, 4000);
  assert.strictEqual(revived.bookmarks.length, 1);
});

test('合并：访问次数按设备求和', () => {
  const local = S.buildSnapshot({
    groups: [{ id: 'default', name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [{ id: '1', title: 'A', url: 'https://a.com', groupId: 'default', visits: { d1: 3 }, updatedAt: 100 }],
    tombstones: {},
  }, 'd1', 100);

  const remote = {
    schema: 2,
    groups: [{ name: '默认分组', order: 0, updatedAt: 0 }],
    bookmarks: [{ url: 'https://a.com', title: 'A', groupName: '默认分组', visits: { d2: 5 }, updatedAt: 100 }],
    tombstones: { bookmarks: {}, groups: {} },
  };

  const merged = S.mergeSnapshots(local, remote, 200);
  assert.strictEqual(S.sumVisits(merged.bookmarks[0].visits), 8);
});

test('写回本地：按名称匹配分组，保留本机 id', () => {
  const local = {
    bookmarks: [{ id: 'local-1', title: 'A', url: 'https://a.com/', groupId: 'g-local', visits: { d1: 1 }, updatedAt: 100 }],
    groups: [{ id: 'g-local', name: '工作', order: 0, updatedAt: 0 }],
    tombstones: {},
  };
  const snapshot = {
    groups: [
      { name: '默认分组', order: 0, updatedAt: 0 },
      { name: '工作', order: 1, updatedAt: 0 },
    ],
    bookmarks: [{ url: 'https://a.com', title: 'A', groupName: '工作', visits: { d1: 1 }, updatedAt: 100 }],
    tombstones: {},
  };

  const applied = S.applySnapshot(snapshot, local);
  const bookmark = applied.bookmarks[0];
  assert.strictEqual(bookmark.id, 'local-1');
  assert.strictEqual(bookmark.groupId, 'g-local');
});

test('兼容旧版导出文件', () => {
  const legacy = {
    version: 1,
    app: 'custom-newtab',
    exportedAt: '2025-01-01T00:00:00.000Z',
    groups: [{ id: 'g1', name: '工作', order: 0 }],
    bookmarks: [{ title: 'A', url: 'https://a.com', groupId: 'g1', visitCount: 4, lastVisit: 123 }],
  };

  const snapshot = S.coerceSnapshot(legacy);
  assert.strictEqual(snapshot.schema, 2);
  assert.strictEqual(snapshot.bookmarks[0].groupName, '工作');
  assert.strictEqual(S.sumVisits(snapshot.bookmarks[0].visits), 4);
});

test('signature 能识别状态是否变化', () => {
  const state = {
    bookmarks: [{ id: '1', title: 'A', url: 'https://a.com', groupId: 'default', visits: { d1: 1 }, updatedAt: 100 }],
    groups: [{ id: 'default', name: '默认分组', order: 0, updatedAt: 0 }],
    tombstones: { bookmarks: {}, groups: {} },
  };
  const clone = JSON.parse(JSON.stringify(state));
  assert.strictEqual(S.signature(state), S.signature(clone));

  clone.bookmarks[0].visits.d1 = 2;
  assert.notStrictEqual(S.signature(state), S.signature(clone));
});

test('同步文件不是 JSON 对象时抛出带错误码的异常', () => {
  assert.throws(
    () => S.coerceSnapshot('not an object'),
    (error) => {
      assert.strictEqual(error.code, 'SYNC_FILE_NOT_OBJECT');
      assert.strictEqual(error.message, '同步文件内容不是合法 JSON 对象');
      return true;
    }
  );
});

test('同步文件缺少 bookmarks 数据时抛出带错误码的异常', () => {
  assert.throws(
    () => S.coerceSnapshot({ schema: 2, groups: [] }),
    (error) => {
      assert.strictEqual(error.code, 'SYNC_FILE_UNKNOWN_FORMAT');
      assert.strictEqual(error.message, '无法识别的同步文件格式（缺少 bookmarks 数据）');
      return true;
    }
  );
});

console.log(`\n${passed} tests passed`);
