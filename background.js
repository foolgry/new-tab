// Background Service Worker for Chrome Extension
// 负责默认数据初始化 + WebDAV 云同步引擎

importScripts('sync-core.js', 'i18n.js');

const DEFAULT_SYNC_FILENAME = 'newtab-bookmarks.json';
const SYNC_PERIOD_ALARM = 'sync-periodic';
const SYNC_DEBOUNCE_ALARM = 'sync-pending';
const SYNC_PERIOD_MINUTES = 15;
const SYNC_DEBOUNCE_MINUTES = 1;

const DEFAULT_SYNC_CONFIG = {
  enabled: false,
  providerId: 'custom',
  url: '',
  username: '',
  password: '',
  filename: DEFAULT_SYNC_FILENAME,
  lastSyncAt: 0,
  lastSyncOk: false,
  lastSyncError: '',
  lastSignature: '',
  remoteEtag: '',
};

let syncInFlight = null;

// sync-core 抛出的可识别错误码 → 界面语言的消息 key
const SYNC_ERROR_MESSAGE_KEYS = {
  SYNC_FILE_NOT_OBJECT: 'bgSyncFileNotObject',
  SYNC_FILE_UNKNOWN_FORMAT: 'bgSyncFileUnknownFormat',
};

// 把错误转换成当前界面语言的文案：有已知错误码就用消息目录，否则沿用原始 message
function localizeSyncError(error) {
  if (error && error.code && SYNC_ERROR_MESSAGE_KEYS[error.code]) {
    return I18n.t(SYNC_ERROR_MESSAGE_KEYS[error.code]);
  }
  return (error && error.message) ? error.message : '';
}

// ==================== 安装 / 启动 ====================

chrome.runtime.onInstalled.addListener(() => {
  console.log('书签扩展已安装');
  initializeDefaultBookmarks();
  ensureDeviceId();
  applySyncAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  ensureDeviceId();
  applySyncAlarms();
  performSync({ reason: 'startup' }).catch(() => {});
});

// ==================== 默认数据 ====================

async function initializeDefaultBookmarks() {
  try {
    const result = await chrome.storage.local.get(['bookmarks', 'groups']);

    if (!result.groups || result.groups.length === 0) {
      const defaultGroups = [{
        id: SyncCore.DEFAULT_GROUP_ID,
        name: SyncCore.DEFAULT_GROUP_NAME,
        order: 0,
        updatedAt: 0,
      }];
      await chrome.storage.local.set({ groups: defaultGroups });
      console.log('默认分组已初始化');
    }

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
          groupId: 'default',
          updatedAt: 0,
          visits: {},
        },
        {
          id: '2',
          title: 'GitHub',
          url: 'https://github.com',
          favicon: 'https://github.com/favicon.ico',
          visitCount: 0,
          lastVisit: 0,
          order: 1,
          groupId: 'default',
          updatedAt: 0,
          visits: {},
        },
        {
          id: '3',
          title: 'Stack Overflow',
          url: 'https://stackoverflow.com',
          favicon: 'https://stackoverflow.com/favicon.ico',
          visitCount: 0,
          lastVisit: 0,
          order: 2,
          groupId: 'default',
          updatedAt: 0,
          visits: {},
        },
      ];

      await chrome.storage.local.set({ bookmarks: defaultBookmarks });
      console.log('默认书签已初始化');
    }
  } catch (error) {
    console.error('初始化默认数据失败:', error);
  }
}

// ==================== 设备标识 ====================

async function ensureDeviceId() {
  const result = await chrome.storage.local.get('deviceId');
  if (result.deviceId) return result.deviceId;
  const deviceId = SyncCore.randomId();
  await chrome.storage.local.set({ deviceId });
  return deviceId;
}

// ==================== 同步配置 ====================

async function getSyncConfig() {
  const result = await chrome.storage.local.get('syncConfig');
  return { ...DEFAULT_SYNC_CONFIG, ...(result.syncConfig || {}) };
}

async function setSyncConfig(patch) {
  const current = await getSyncConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ syncConfig: next });
  return next;
}

function publicStatus(config, extra) {
  return {
    enabled: !!config.enabled,
    providerId: config.providerId || 'custom',
    url: config.url || '',
    username: config.username || '',
    hasPassword: !!config.password,
    filename: config.filename || DEFAULT_SYNC_FILENAME,
    lastSyncAt: config.lastSyncAt || 0,
    lastSyncOk: !!config.lastSyncOk,
    lastSyncError: config.lastSyncError || '',
    inFlight: !!syncInFlight,
    ...(extra || {}),
  };
}

async function applySyncAlarms() {
  const config = await getSyncConfig();
  await chrome.alarms.clear(SYNC_PERIOD_ALARM);
  if (config.enabled) {
    chrome.alarms.create(SYNC_PERIOD_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  } else {
    await chrome.alarms.clear(SYNC_DEBOUNCE_ALARM);
  }
}

// ==================== WebDAV 客户端 ====================

function normalizeDavBase(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(I18n.t('bgUrlInvalid'));
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function buildFileUrl(config) {
  const base = normalizeDavBase(config.url);
  const filename = String(config.filename || DEFAULT_SYNC_FILENAME).replace(/^\/+/, '');
  return `${base}${encodeURIComponent(filename)}`;
}

function originPattern(rawUrl) {
  const url = new URL(normalizeDavBase(rawUrl));
  return `${url.protocol}//${url.host}/*`;
}

async function assertOriginPermission(rawUrl) {
  const granted = await chrome.permissions.contains({ origins: [originPattern(rawUrl)] });
  if (!granted) {
    throw new Error(I18n.t('bgOriginNotGranted'));
  }
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function authHeaders(config) {
  const headers = {};
  if (config.username || config.password) {
    const token = utf8ToBase64(`${config.username || ''}:${config.password || ''}`);
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function withCacheBuster(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_=${Date.now()}`;
}

// actionKey 是 i18n 消息 key（bgActionRead / bgActionWrite / bgActionTest）
function davError(response, actionKey) {
  const status = response.status;
  if (status === 401) return new Error(I18n.t('bgAuth401'));
  if (status === 403) return new Error(I18n.t('bgForbidden403'));
  if (status === 404) return new Error(I18n.t('bgNotFound404'));
  if (status === 405) return new Error(I18n.t('bgMethodNotAllowed405'));
  if (status === 409) return new Error(I18n.t('bgConflict409'));
  if (status === 507) return new Error(I18n.t('bgInsufficientStorage507'));
  const message = I18n.t('bgDavRequestFailed', [
    I18n.t(actionKey),
    String(status),
    String(response.statusText || '')
  ]);
  return new Error(message.trim());
}

async function davFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(I18n.t('bgNetworkError'));
  }
}

async function davGet(config) {
  const fileUrl = buildFileUrl(config);
  const response = await davFetch(withCacheBuster(fileUrl), {
    method: 'GET',
    headers: {
      ...authHeaders(config),
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    cache: 'no-store',
    credentials: 'omit',
  });

  if (response.status === 404) {
    return { snapshot: null, etag: null };
  }
  if (!response.ok) {
    throw davError(response, 'bgActionRead');
  }

  const text = await response.text();
  if (!text.trim()) {
    return { snapshot: null, etag: response.headers.get('ETag') };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(I18n.t('bgRemoteInvalidJson'));
  }

  return { snapshot: data, etag: response.headers.get('ETag') };
}

async function davPut(config, snapshot, etag) {
  const fileUrl = buildFileUrl(config);
  const headers = {
    ...authHeaders(config),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  // 有强 ETag 时做乐观锁；弱 ETag 不能用于 If-Match，没有 ETag 时直接写入
  if (etag && !String(etag).startsWith('W/')) headers['If-Match'] = etag;

  const body = JSON.stringify(snapshot, null, 2);
  const response = await davFetch(fileUrl, {
    method: 'PUT',
    headers,
    body,
    cache: 'no-store',
    credentials: 'omit',
  });

  if (response.status === 412 || response.status === 423) {
    return { conflict: true };
  }
  if (!response.ok) {
    throw davError(response, 'bgActionWrite');
  }

  return { conflict: false, etag: response.headers.get('ETag') || etag || null };
}

async function davTest(config) {
  try {
    normalizeDavBase(config.url);
    const fileUrl = buildFileUrl(config);
    const response = await davFetch(withCacheBuster(fileUrl), {
      method: 'GET',
      headers: {
        ...authHeaders(config),
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
      credentials: 'omit',
    });

    if (response.status === 404) {
      return { ok: true, message: I18n.t('bgTestNoRemoteFile') };
    }
    if (response.status === 401) {
      return { ok: false, message: I18n.t('bgTestAuthFailed') };
    }
    if (response.status === 403) {
      return { ok: false, message: I18n.t('bgTestForbidden') };
    }
    if (!response.ok) {
      return { ok: false, message: davError(response, 'bgActionTest').message };
    }

    const text = await response.text();
    if (text.trim()) {
      try {
        SyncCore.coerceSnapshot(JSON.parse(text));
      } catch {
        return { ok: false, message: I18n.t('bgTestWrongFormat') };
      }
    }
    return { ok: true, message: I18n.t('bgTestSuccess') };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : I18n.t('bgTestFailedFallback') };
  }
}

// ==================== 同步引擎 ====================

async function readLocalState(deviceId) {
  const raw = await chrome.storage.local.get(['bookmarks', 'groups', 'tombstones']);
  return SyncCore.normalizeLocalState(raw, deviceId);
}

async function writeLocalState(state) {
  await chrome.storage.local.set({
    bookmarks: state.bookmarks,
    groups: state.groups,
    tombstones: state.tombstones,
  });
}

async function runSync(config) {
  await assertOriginPermission(config.url);

  const deviceId = await ensureDeviceId();
  let localState = await readLocalState(deviceId);
  let remote = await davGet(config);
  let remoteSnapshot = remote.snapshot ? SyncCore.coerceSnapshot(remote.snapshot) : null;
  let etag = remote.etag;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const merged = SyncCore.mergeSnapshots(
      SyncCore.buildSnapshot(localState, deviceId),
      remoteSnapshot
    );
    const mergedSignature = SyncCore.signature(merged);
    const localSignature = SyncCore.signature(localState);
    const applied = SyncCore.applySnapshot(merged, localState);
    const appliedSignature = SyncCore.signature(applied);

    if (localState.changed || localSignature !== appliedSignature) {
      await writeLocalState(applied);
    }
    localState = applied;

    // 远端已经包含合并结果时不必重复写入（减少请求与版本历史噪音）
    const remoteSignature = remoteSnapshot ? SyncCore.signature(remoteSnapshot) : null;
    if (remoteSignature !== null && remoteSignature === mergedSignature) {
      return { signature: appliedSignature, etag };
    }

    const putResult = await davPut(config, merged, etag);
    if (!putResult.conflict) {
      return {
        signature: appliedSignature,
        etag: putResult.etag || '',
      };
    }

    // 远端在读取后被其他设备改过：重新拉取并合并
    remote = await davGet(config);
    remoteSnapshot = remote.snapshot ? SyncCore.coerceSnapshot(remote.snapshot) : null;
    etag = remote.etag;
    localState = await readLocalState(deviceId);
  }

  throw new Error(I18n.t('bgSyncConflict'));
}

async function performSync(options = {}) {
  const config = await getSyncConfig();
  if (!config.enabled) {
    return { ok: false, error: I18n.t('bgSyncNotEnabled'), ...publicStatus(config) };
  }
  if (!config.url) {
    return { ok: false, error: I18n.t('bgSyncUrlMissing'), ...publicStatus(config) };
  }

  // 打开新标签页时的轻量触发：2 分钟内且本地无变化则跳过
  if (!options.force && config.lastSyncOk && Date.now() - (config.lastSyncAt || 0) < 2 * 60 * 1000) {
    const deviceId = await ensureDeviceId();
    const state = await readLocalState(deviceId);
    if (config.lastSignature && SyncCore.signature(state) === config.lastSignature) {
      return { ok: true, skipped: true, ...publicStatus(config) };
    }
  }

  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const result = await runSync(config);
      const next = await setSyncConfig({
        lastSyncAt: Date.now(),
        lastSyncOk: true,
        lastSyncError: '',
        lastSignature: result.signature,
        remoteEtag: result.etag || '',
      });
      return { ok: true, ...publicStatus(next) };
    } catch (error) {
      const message = localizeSyncError(error) || String(error);
      const next = await setSyncConfig({
        lastSyncAt: Date.now(),
        lastSyncOk: false,
        lastSyncError: message,
      });
      return { ok: false, error: message, ...publicStatus(next) };
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

// ==================== 定时与触发 ====================

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_PERIOD_ALARM) {
    performSync({ reason: 'alarm' }).catch(() => {});
    return;
  }
  if (alarm.name === SYNC_DEBOUNCE_ALARM) {
    debouncedPush().catch(() => {});
  }
});

async function debouncedPush() {
  const config = await getSyncConfig();
  if (!config.enabled) return;
  const deviceId = await ensureDeviceId();
  const state = await readLocalState(deviceId);
  // 同步自己写回的 storage 变化不重复推送
  if (config.lastSignature && SyncCore.signature(state) === config.lastSignature) return;
  await performSync({ reason: 'change', force: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const relevant = 'bookmarks' in changes || 'groups' in changes || 'tombstones' in changes;
  if (!relevant) return;

  chrome.storage.local.get('syncConfig').then((result) => {
    const config = result.syncConfig;
    if (!config || !config.enabled) return;
    chrome.alarms.create(SYNC_DEBOUNCE_ALARM, { delayInMinutes: SYNC_DEBOUNCE_MINUTES });
  }).catch(() => {});
});

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request.action !== 'string') return;

  if (request.action === 'addBookmark') {
    addBookmarkFromMessage(request.bookmark)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action.startsWith('sync:')) {
    handleSyncMessage(request)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: localizeSyncError(error) }));
    return true;
  }
});

async function handleSyncMessage(request) {
  switch (request.action) {
    case 'sync:getStatus': {
      const config = await getSyncConfig();
      return { ok: true, ...publicStatus(config) };
    }

    case 'sync:saveConfig': {
      const input = request.config || {};
      const current = await getSyncConfig();
      const url = String(input.url || '').trim();

      if (input.enabled !== false && !/^https?:\/\//i.test(url)) {
        return { ok: false, error: I18n.t('bgUrlInvalid') };
      }

      const patch = {
        enabled: input.enabled !== false,
        providerId: input.providerId || current.providerId || 'custom',
        url,
        username: String(input.username || ''),
        filename: String(input.filename || '').trim() || DEFAULT_SYNC_FILENAME,
        lastSignature: '',
        lastSyncOk: false,
        lastSyncError: '',
      };
      if (typeof input.password === 'string' && input.password !== '') {
        patch.password = input.password;
      }

      const next = await setSyncConfig(patch);
      await applySyncAlarms();

      if (next.enabled) {
        const syncResult = await performSync({ reason: 'save', force: true });
        return {
          ok: true,
          saved: true,
          sync: syncResult,
          ...publicStatus(await getSyncConfig()),
        };
      }

      return { ok: true, saved: true, ...publicStatus(next) };
    }

    case 'sync:testConnection': {
      const input = request.config || {};
      const current = await getSyncConfig();
      const config = {
        ...current,
        url: String(input.url || current.url || '').trim(),
        username: typeof input.username === 'string' ? input.username : current.username,
        password: typeof input.password === 'string' && input.password ? input.password : current.password,
        filename: String(input.filename || current.filename || DEFAULT_SYNC_FILENAME).trim(),
      };
      return davTest(config);
    }

    case 'sync:now': {
      return performSync({ reason: request.reason || 'manual', force: !!request.force });
    }

    case 'sync:disable': {
      await setSyncConfig({ enabled: false });
      await applySyncAlarms();
      return { ok: true, ...publicStatus(await getSyncConfig()) };
    }

    default:
      return { ok: false, error: I18n.t('bgUnknownSyncAction', [request.action]) };
  }
}

// ==================== 来自 popup 的添加书签 ====================

async function addBookmarkFromMessage(bookmarkData) {
  try {
    const result = await chrome.storage.local.get(['bookmarks']);
    const bookmarks = result.bookmarks || [];

    const exists = bookmarks.find(b => b.url === bookmarkData.url);
    if (exists) {
      throw new Error(I18n.t('bgBookmarkExists'));
    }

    const newBookmark = {
      id: Date.now().toString(),
      ...bookmarkData,
      visitCount: 0,
      lastVisit: 0,
      order: bookmarks.length,
      updatedAt: Date.now(),
      visits: {},
    };

    bookmarks.push(newBookmark);
    await chrome.storage.local.set({ bookmarks });

    return newBookmark;
  } catch (error) {
    throw error;
  }
}
