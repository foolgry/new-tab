/* eslint-disable no-console */
// WebDAV 同步集成测试：mock chrome API + 本地 HTTP 服务器
// 运行：node tests/webdav-sync.test.js
const assert = require('assert');
const http = require('http');

globalThis.self = globalThis;
require('../sync-core.js');

// ==================== chrome API mock ====================

const storage = {};
const storageListeners = [];
let messageListener = null;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function storageGet(keys) {
  if (keys == null) return clone(storage);
  if (typeof keys === 'string') return { [keys]: clone(storage[keys]) };
  if (Array.isArray(keys)) {
    const result = {};
    keys.forEach((key) => { result[key] = clone(storage[key]); });
    return result;
  }
  const result = {};
  Object.entries(keys).forEach(([key, fallback]) => {
    result[key] = storage[key] === undefined ? fallback : clone(storage[key]);
  });
  return result;
}

async function storageSet(items) {
  const changes = {};
  Object.entries(items).forEach(([key, value]) => {
    changes[key] = { oldValue: clone(storage[key]), newValue: clone(value) };
    storage[key] = clone(value);
  });
  storageListeners.forEach((listener) => listener(changes, 'local'));
}

globalThis.chrome = {
  storage: {
    local: { get: storageGet, set: storageSet },
    onChanged: { addListener: (listener) => storageListeners.push(listener) },
  },
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener: (listener) => { messageListener = listener; } },
    lastError: null,
  },
  alarms: {
    create() {},
    clear: async () => {},
    onAlarm: { addListener() {} },
  },
  permissions: {
    contains: async () => true,
  },
};

globalThis.importScripts = () => {};
require('../background.js');

function send(request) {
  return new Promise((resolve) => {
    messageListener(request, {}, resolve);
  });
}

// ==================== 本地 WebDAV 服务器 ====================

function createDavServer() {
  const state = { body: null, version: 0 };
  const expectedAuth = `Basic ${Buffer.from('user:pass').toString('base64')}`;
  const server = http.createServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path !== '/dav/newtab-bookmarks.json') {
      response.statusCode = 404;
      response.end();
      return;
    }

    if (request.headers.authorization !== expectedAuth) {
      response.statusCode = 401;
      response.end();
      return;
    }

    if (request.method === 'GET') {
      if (!state.body) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('ETag', `"v${state.version}"`);
      response.end(state.body);
      return;
    }

    if (request.method === 'PUT') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const ifMatch = request.headers['if-match'];
        if (ifMatch && ifMatch !== `"v${state.version}"`) {
          response.statusCode = 412;
          response.end();
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          JSON.parse(body);
        } catch {
          response.statusCode = 400;
          response.end();
          return;
        }
        state.body = body;
        state.version += 1;
        response.statusCode = 200;
        response.setHeader('ETag', `"v${state.version}"`);
        response.end();
      });
      return;
    }

    response.statusCode = 405;
    response.end();
  });

  return {
    state,
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
    rewrite: (mutate) => {
      const data = JSON.parse(state.body);
      mutate(data);
      state.body = JSON.stringify(data);
      state.version += 1;
    },
  };
}

// ==================== 测试 ====================

(async function run() {
  const dav = createDavServer();
  const port = await dav.listen();
  const baseUrl = `http://127.0.0.1:${port}/dav/`;

  // 设备 1 的本地数据
  storage.deviceId = 'device-1';
  storage.groups = [
    { id: 'default', name: '默认分组', order: 0, updatedAt: 0 },
    { id: 'g-work', name: '工作', order: 1, updatedAt: 0 },
  ];
  storage.bookmarks = [
    { id: '1', title: 'A', url: 'https://a.com', groupId: 'default', favicon: '', visitCount: 1, lastVisit: 1, order: 0, updatedAt: 100, visits: { 'device-1': 1 } },
    { id: '2', title: 'B', url: 'https://b.com', groupId: 'g-work', favicon: '', visitCount: 0, lastVisit: 0, order: 1, updatedAt: 100, visits: {} },
  ];
  storage.tombstones = { bookmarks: {}, groups: {} };

  const saved = await send({
    action: 'sync:saveConfig',
    config: {
      providerId: 'custom',
      url: baseUrl,
      username: 'user',
      password: 'pass',
      filename: 'newtab-bookmarks.json',
    },
  });
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.sync.ok, true, saved.sync.error);

  let remote = JSON.parse(dav.state.body);
  assert.strictEqual(remote.schema, 2);
  assert.deepStrictEqual(remote.bookmarks.map((item) => item.url).sort(), ['https://a.com/', 'https://b.com/']);

  // 远端新增书签，本地拉取后应出现
  dav.rewrite((data) => {
    data.bookmarks.push({
      url: 'https://c.com',
      title: 'C 来自远端',
      groupName: '工作',
      order: 2,
      visits: { 'device-2': 2 },
      lastVisit: 5,
      updatedAt: 500,
    });
  });

  const pulled = await send({ action: 'sync:now', force: true });
  assert.strictEqual(pulled.ok, true, pulled.error);
  assert.ok(storage.bookmarks.some((bookmark) => bookmark.url === 'https://c.com/'));
  const c = storage.bookmarks.find((bookmark) => bookmark.url === 'https://c.com/');
  assert.strictEqual(c.visitCount, 2);
  assert.strictEqual(storage.groups.find((group) => group.id === c.groupId).name, '工作');

  // 访问次数按设备求和
  c.visits['device-1'] = 3;
  c.visitCount = 5;
  await storageSet({ bookmarks: storage.bookmarks });
  const visitSync = await send({ action: 'sync:now', force: true });
  assert.strictEqual(visitSync.ok, true, visitSync.error);
  remote = JSON.parse(dav.state.body);
  const remoteC = remote.bookmarks.find((bookmark) => bookmark.url === 'https://c.com/');
  assert.strictEqual(remoteC.visits['device-1'], 3);
  assert.strictEqual(remoteC.visits['device-2'], 2);

  // 本地删除 A，删除标记同步到远端
  storage.bookmarks = storage.bookmarks.filter((bookmark) => bookmark.url !== 'https://a.com/');
  storage.tombstones.bookmarks['https://a.com/'] = Date.now();
  await storageSet({ bookmarks: storage.bookmarks, tombstones: storage.tombstones });
  const deleted = await send({ action: 'sync:now', force: true });
  assert.strictEqual(deleted.ok, true, deleted.error);
  remote = JSON.parse(dav.state.body);
  assert.ok(!remote.bookmarks.some((bookmark) => bookmark.url === 'https://a.com/'));

  // 另一个设备的删除标记不会把本地已知书签复活
  const afterDelete = await send({ action: 'sync:now', force: true });
  assert.strictEqual(afterDelete.ok, true, afterDelete.error);
  assert.ok(!storage.bookmarks.some((bookmark) => bookmark.url === 'https://a.com/'));
  assert.ok(!storage.bookmarks.some((bookmark) => bookmark.url === 'https://a.com'));

  // 无变化时不应重复写入远端
  const versionBeforeIdle = dav.state.version;
  const idle = await send({ action: 'sync:now', force: true });
  assert.strictEqual(idle.ok, true, idle.error);
  assert.strictEqual(dav.state.version, versionBeforeIdle, '无变化时不应重复写入远端');

  // 测试连接：正确密码与错误密码
  const testResult = await send({
    action: 'sync:testConnection',
    config: { url: baseUrl, username: 'user', password: 'pass', filename: 'newtab-bookmarks.json' },
  });
  assert.strictEqual(testResult.ok, true, testResult.message);

  const badAuth = await send({
    action: 'sync:testConnection',
    config: { url: baseUrl, username: 'user', password: 'wrong', filename: 'newtab-bookmarks.json' },
  });
  assert.strictEqual(badAuth.ok, false);
  assert.ok(badAuth.message.includes('认证'), badAuth.message);

  await dav.close();
  console.log('ok - WebDAV 同步集成测试通过');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
