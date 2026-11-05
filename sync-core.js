// 同步核心：纯函数，无网络、无 chrome API 依赖
// 同时被 background.js（importScripts）和 newtab.js（<script>）使用
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const APP_ID = 'custom-newtab';
  const DEFAULT_GROUP_ID = 'default';
  const DEFAULT_GROUP_NAME = '默认分组';
  const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000; // 删除标记保留 90 天

  function randomId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // 书签身份统一用规范化 URL，避免各设备自增 id 冲突
  function normalizeUrl(raw) {
    if (raw == null) return '';
    let value = String(raw).trim();
    if (!value) return '';
    if (value.startsWith('//')) value = `https:${value}`;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.pathname === '/') url.pathname = '';
      return url.href;
    } catch {
      return '';
    }
  }

  function normalizeGroupName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  }

  function normalizeVisits(visits) {
    const result = {};
    if (visits && typeof visits === 'object') {
      Object.entries(visits).forEach(([deviceId, count]) => {
        const value = Math.floor(Number(count));
        if (deviceId && Number.isFinite(value) && value > 0) {
          result[String(deviceId)] = (result[String(deviceId)] || 0) + value;
        }
      });
    }
    return result;
  }

  function mergeVisits(a, b) {
    const result = { ...normalizeVisits(a) };
    Object.entries(normalizeVisits(b)).forEach(([deviceId, count]) => {
      result[deviceId] = Math.max(result[deviceId] || 0, count);
    });
    return result;
  }

  function sumVisits(visits) {
    return Object.values(normalizeVisits(visits)).reduce((sum, count) => sum + count, 0);
  }

  function normalizeTombstones(tombstones) {
    const source = tombstones && typeof tombstones === 'object' ? tombstones : {};
    const result = { bookmarks: {}, groups: {} };

    if (source.bookmarks && typeof source.bookmarks === 'object') {
      Object.entries(source.bookmarks).forEach(([url, ts]) => {
        const key = normalizeUrl(url);
        const value = Number(ts);
        if (key && Number.isFinite(value) && value > 0) {
          result.bookmarks[key] = Math.max(result.bookmarks[key] || 0, value);
        }
      });
    }

    if (source.groups && typeof source.groups === 'object') {
      Object.entries(source.groups).forEach(([name, ts]) => {
        const key = normalizeGroupName(name);
        const value = Number(ts);
        if (key && Number.isFinite(value) && value > 0) {
          result.groups[key] = Math.max(result.groups[key] || 0, value);
        }
      });
    }

    return result;
  }

  function mergeTombstones(a, b) {
    const left = normalizeTombstones(a);
    const right = normalizeTombstones(b);
    const result = { bookmarks: { ...left.bookmarks }, groups: { ...left.groups } };

    Object.entries(right.bookmarks).forEach(([url, ts]) => {
      result.bookmarks[url] = Math.max(result.bookmarks[url] || 0, ts);
    });
    Object.entries(right.groups).forEach(([name, ts]) => {
      result.groups[name] = Math.max(result.groups[name] || 0, ts);
    });

    return result;
  }

  function pruneTombstones(tombstones, now, ttl) {
    const normalized = normalizeTombstones(tombstones);
    const cutoff = (now || Date.now()) - (ttl || TOMBSTONE_TTL);
    const result = { bookmarks: {}, groups: {} };

    Object.entries(normalized.bookmarks).forEach(([url, ts]) => {
      if (ts > cutoff) result.bookmarks[url] = ts;
    });
    Object.entries(normalized.groups).forEach(([name, ts]) => {
      if (ts > cutoff) result.groups[name] = ts;
    });

    return result;
  }

  // 把本地 storage 里的数据整理成统一结构。
  // 兼容旧数据：没有 visits 的用 visitCount 迁移到当前设备，没有 updatedAt 的补当前时间。
  function normalizeLocalState(raw, deviceId, now) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const currentNow = now || Date.now();
    const device = deviceId || 'unknown-device';
    const rawBookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : [];
    const rawGroups = Array.isArray(source.groups) ? source.groups : [];

    const bookmarks = [];
    const byUrl = new Map();

    rawBookmarks.forEach((bookmark) => {
      if (!bookmark || typeof bookmark !== 'object') return;
      const url = normalizeUrl(bookmark.url);
      if (!url) return;

      let visits = normalizeVisits(bookmark.visits);
      if (Object.keys(visits).length === 0 && Number(bookmark.visitCount) > 0) {
        visits = { [device]: Math.floor(Number(bookmark.visitCount)) };
      }

      const updatedAt = Number(bookmark.updatedAt) > 0 ? Number(bookmark.updatedAt) : currentNow;
      const item = {
        id: bookmark.id ? String(bookmark.id) : randomId(),
        title: String(bookmark.title || url).trim() || url,
        url,
        favicon: typeof bookmark.favicon === 'string' ? bookmark.favicon : '',
        visitCount: sumVisits(visits),
        lastVisit: Number(bookmark.lastVisit) > 0 ? Number(bookmark.lastVisit) : 0,
        order: Number.isFinite(Number(bookmark.order)) ? Number(bookmark.order) : bookmarks.length,
        groupId: bookmark.groupId ? String(bookmark.groupId) : DEFAULT_GROUP_ID,
        updatedAt,
        visits,
      };

      const previous = byUrl.get(url);
      if (previous) {
        previous.visits = mergeVisits(previous.visits, item.visits);
        previous.visitCount = sumVisits(previous.visits);
        previous.lastVisit = Math.max(previous.lastVisit, item.lastVisit);
        if (item.updatedAt > previous.updatedAt) {
          previous.title = item.title;
          previous.groupId = item.groupId;
          previous.order = item.order;
          previous.updatedAt = item.updatedAt;
          previous.favicon = item.favicon || previous.favicon;
        }
        return;
      }

      byUrl.set(url, item);
      bookmarks.push(item);
    });

    const groups = [];
    const seenNames = new Set();
    rawGroups.forEach((group) => {
      if (!group || typeof group !== 'object') return;
      const name = normalizeGroupName(group.name);
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);
      groups.push({
        id: group.id ? String(group.id) : (name === DEFAULT_GROUP_NAME ? DEFAULT_GROUP_ID : randomId()),
        name,
        order: Number.isFinite(Number(group.order)) ? Number(group.order) : groups.length,
        updatedAt: Number(group.updatedAt) > 0 ? Number(group.updatedAt) : 0,
      });
    });

    if (!groups.some((group) => group.name === DEFAULT_GROUP_NAME)) {
      groups.unshift({
        id: DEFAULT_GROUP_ID,
        name: DEFAULT_GROUP_NAME,
        order: 0,
        updatedAt: 0,
      });
    }

    // 默认分组固定使用 id=default，历史数据里的分组 id 一并重映射
    const defaultGroup = groups.find((group) => group.name === DEFAULT_GROUP_NAME);
    if (defaultGroup.id !== DEFAULT_GROUP_ID) {
      const oldId = defaultGroup.id;
      defaultGroup.id = DEFAULT_GROUP_ID;
      bookmarks.forEach((bookmark) => {
        if (bookmark.groupId === oldId) bookmark.groupId = DEFAULT_GROUP_ID;
      });
    }

    const groupIds = new Set(groups.map((group) => group.id));
    bookmarks.forEach((bookmark) => {
      if (!groupIds.has(bookmark.groupId)) bookmark.groupId = DEFAULT_GROUP_ID;
    });

    groups.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    groups.forEach((group, index) => { group.order = index; });

    const tombstones = normalizeTombstones(source.tombstones);
    const result = { bookmarks, groups, tombstones };

    let changed = false;
    try {
      changed = JSON.stringify({
        bookmarks: source.bookmarks,
        groups: source.groups,
        tombstones: source.tombstones || null,
      }) !== JSON.stringify({ bookmarks, groups, tombstones });
    } catch {
      changed = true;
    }
    result.changed = changed;
    return result;
  }

  function buildSnapshot(state, deviceId, now) {
    const groupNames = new Map((state.groups || []).map((group) => [group.id, group.name]));

    const groups = (state.groups || [])
      .map((group) => ({
        name: normalizeGroupName(group.name),
        order: Number(group.order) || 0,
        updatedAt: Number(group.updatedAt) || 0,
      }))
      .filter((group) => group.name)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const bookmarks = (state.bookmarks || [])
      .map((bookmark) => ({
        url: normalizeUrl(bookmark.url),
        title: String(bookmark.title || bookmark.url || ''),
        groupName: groupNames.get(bookmark.groupId) || DEFAULT_GROUP_NAME,
        order: Number(bookmark.order) || 0,
        visits: normalizeVisits(bookmark.visits),
        lastVisit: Number(bookmark.lastVisit) || 0,
        updatedAt: Number(bookmark.updatedAt) || 0,
      }))
      .filter((bookmark) => bookmark.url);

    return {
      schema: SCHEMA_VERSION,
      app: APP_ID,
      deviceId: deviceId || '',
      updatedAt: now || Date.now(),
      groups,
      bookmarks,
      tombstones: normalizeTombstones(state.tombstones),
    };
  }

  // 兼容旧版导出文件（version: 1，没有 visits/updatedAt）
  function coerceSnapshot(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('同步文件内容不是合法 JSON 对象');
    }

    if (Array.isArray(data.bookmarks)) {
      if (data.schema === SCHEMA_VERSION) {
        return {
          schema: SCHEMA_VERSION,
          app: data.app || APP_ID,
          deviceId: typeof data.deviceId === 'string' ? data.deviceId : '',
          updatedAt: Number(data.updatedAt) || 0,
          groups: Array.isArray(data.groups) ? data.groups : [],
          bookmarks: data.bookmarks,
          tombstones: normalizeTombstones(data.tombstones),
        };
      }

      if (Array.isArray(data.bookmarks)) {
        const exportedAt = Date.parse(data.exportedAt) || 0;
        const groupNamesById = new Map();
        const groups = (Array.isArray(data.groups) ? data.groups : []).map((group, index) => {
          const name = normalizeGroupName(group && group.name) || `分组 ${index + 1}`;
          if (group && group.id) groupNamesById.set(group.id, name);
          return {
            name,
            order: Number(group && group.order) || index,
            updatedAt: exportedAt,
          };
        });

        const bookmarks = data.bookmarks
          .map((bookmark) => {
            if (!bookmark || !bookmark.url) return null;
            let visits = normalizeVisits(bookmark.visits);
            if (Object.keys(visits).length === 0 && Number(bookmark.visitCount) > 0) {
              visits = { legacy: Math.floor(Number(bookmark.visitCount)) };
            }
            return {
              url: normalizeUrl(bookmark.url),
              title: String(bookmark.title || bookmark.url),
              groupName: groupNamesById.get(bookmark.groupId) || DEFAULT_GROUP_NAME,
              order: Number(bookmark.order) || 0,
              visits,
              lastVisit: Number(bookmark.lastVisit) || 0,
              updatedAt: Number(bookmark.updatedAt) > 0 ? Number(bookmark.updatedAt) : exportedAt,
            };
          })
          .filter(Boolean);

        return {
          schema: SCHEMA_VERSION,
          app: APP_ID,
          deviceId: 'legacy',
          updatedAt: exportedAt,
          groups,
          bookmarks,
          tombstones: normalizeTombstones(data.tombstones),
        };
      }
    }

    throw new Error('无法识别的同步文件格式（缺少 bookmarks 数据）');
  }

  function mergeSnapshots(localSnapshot, remoteSnapshot, now) {
    const currentNow = now || Date.now();
    const sources = [localSnapshot, remoteSnapshot].filter(Boolean);

    let tombstones = { bookmarks: {}, groups: {} };
    sources.forEach((source) => {
      tombstones = mergeTombstones(tombstones, source.tombstones);
    });
    tombstones = pruneTombstones(tombstones, currentNow);

    // 分组以名称为身份合并
    const groupMap = new Map();
    sources.forEach((source) => {
      (source.groups || []).forEach((group) => {
        if (!group || typeof group !== 'object') return;
        const name = normalizeGroupName(group.name);
        if (!name) return;
        const order = Number.isFinite(Number(group.order)) ? Number(group.order) : groupMap.size;
        const updatedAt = Number(group.updatedAt) || 0;
        const previous = groupMap.get(name);
        if (!previous) {
          groupMap.set(name, { name, order, updatedAt });
          return;
        }
        if (updatedAt > previous.updatedAt) previous.order = order;
        previous.updatedAt = Math.max(previous.updatedAt, updatedAt);
      });
    });

    Object.entries(tombstones.groups).forEach(([name, ts]) => {
      if (name === DEFAULT_GROUP_NAME) return;
      const group = groupMap.get(name);
      if (group && ts >= group.updatedAt) groupMap.delete(name);
    });

    if (!groupMap.has(DEFAULT_GROUP_NAME)) {
      groupMap.set(DEFAULT_GROUP_NAME, { name: DEFAULT_GROUP_NAME, order: 0, updatedAt: 0 });
    }

    const groups = [...groupMap.values()]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    groups.forEach((group, index) => { group.order = index; });
    const groupNames = new Set(groups.map((group) => group.name));

    // 书签以规范化 URL 为身份合并
    const bookmarkMap = new Map();
    sources.forEach((source) => {
      (source.bookmarks || []).forEach((bookmark) => {
        if (!bookmark || typeof bookmark !== 'object') return;
        const url = normalizeUrl(bookmark.url);
        if (!url) return;
        const item = {
          url,
          title: String(bookmark.title || url),
          groupName: normalizeGroupName(bookmark.groupName) || DEFAULT_GROUP_NAME,
          order: Number(bookmark.order) || 0,
          visits: normalizeVisits(bookmark.visits),
          lastVisit: Number(bookmark.lastVisit) || 0,
          updatedAt: Number(bookmark.updatedAt) || 0,
        };

        const previous = bookmarkMap.get(url);
        if (!previous) {
          bookmarkMap.set(url, item);
          return;
        }

        const itemIsNewer = item.updatedAt > previous.updatedAt;
        previous.visits = mergeVisits(previous.visits, item.visits);
        previous.lastVisit = Math.max(previous.lastVisit, item.lastVisit);

        if (itemIsNewer) {
          previous.title = item.title;
          previous.groupName = item.groupName;
          previous.order = item.order;
        }
        previous.updatedAt = Math.max(previous.updatedAt, item.updatedAt);
      });
    });

    [...bookmarkMap.entries()].forEach(([url, bookmark]) => {
      const deletedAt = tombstones.bookmarks[url];
      if (deletedAt && deletedAt >= bookmark.updatedAt) {
        bookmarkMap.delete(url);
        return;
      }
      if (!groupNames.has(bookmark.groupName)) bookmark.groupName = DEFAULT_GROUP_NAME;
    });

    const groupOrder = new Map(groups.map((group, index) => [group.name, index]));
    const bookmarks = [...bookmarkMap.values()].sort((a, b) => {
      const groupDiff = (groupOrder.get(a.groupName) || 0) - (groupOrder.get(b.groupName) || 0);
      if (groupDiff !== 0) return groupDiff;
      if (a.order !== b.order) return a.order - b.order;
      return a.url.localeCompare(b.url);
    });
    bookmarks.forEach((bookmark, index) => { bookmark.order = index; });

    return {
      schema: SCHEMA_VERSION,
      app: APP_ID,
      deviceId: (localSnapshot && localSnapshot.deviceId) || '',
      updatedAt: currentNow,
      groups,
      bookmarks,
      tombstones,
    };
  }

  // 把合并结果写回本地结构，尽量保留本机已有 id / favicon
  function applySnapshot(snapshot, localState) {
    const local = localState || { bookmarks: [], groups: [], tombstones: {} };
    const localGroupsByName = new Map(
      (local.groups || []).map((group) => [normalizeGroupName(group.name), group])
    );

    const groups = [];
    (snapshot.groups || []).forEach((group) => {
      const name = normalizeGroupName(group.name);
      if (!name) return;
      const existing = localGroupsByName.get(name);
      groups.push({
        id: existing ? existing.id : (name === DEFAULT_GROUP_NAME ? DEFAULT_GROUP_ID : randomId()),
        name,
        order: Number(group.order) || 0,
        updatedAt: Number(group.updatedAt) || 0,
      });
    });

    if (!groups.some((group) => group.name === DEFAULT_GROUP_NAME)) {
      groups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: 0, updatedAt: 0 });
    }

    const groupIdByName = new Map(groups.map((group) => [group.name, group.id]));
    const localBookmarksByUrl = new Map(
      (local.bookmarks || []).map((bookmark) => [normalizeUrl(bookmark.url), bookmark])
    );

    const bookmarks = [];
    (snapshot.bookmarks || []).forEach((bookmark) => {
      const url = normalizeUrl(bookmark.url);
      if (!url) return;
      const existing = localBookmarksByUrl.get(url);
      const groupName = groupIdByName.has(normalizeGroupName(bookmark.groupName))
        ? normalizeGroupName(bookmark.groupName)
        : DEFAULT_GROUP_NAME;
      const visits = normalizeVisits(bookmark.visits);

      bookmarks.push({
        id: existing ? existing.id : randomId(),
        title: String(bookmark.title || url),
        url,
        favicon: (existing && existing.favicon) || '',
        visitCount: sumVisits(visits),
        lastVisit: Number(bookmark.lastVisit) || 0,
        order: Number(bookmark.order) || 0,
        groupId: groupIdByName.get(groupName),
        updatedAt: Number(bookmark.updatedAt) || 0,
        visits,
      });
    });

    return {
      bookmarks,
      groups,
      tombstones: normalizeTombstones(snapshot.tombstones),
    };
  }

  // 用于判断「这次 storage 变化是不是同步自己写回的」，避免回环
  function signature(state) {
    const source = state || {};
    const tombstones = normalizeTombstones(source.tombstones);

    const bookmarks = (source.bookmarks || [])
      .map((bookmark) => [
        normalizeUrl(bookmark.url),
        String(bookmark.title || ''),
        bookmark.groupId || bookmark.groupName || '',
        Number(bookmark.order) || 0,
        sumVisits(normalizeVisits(bookmark.visits)),
        Number(bookmark.lastVisit) || 0,
        Number(bookmark.updatedAt) || 0,
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    const groups = (source.groups || [])
      .map((group) => [
        normalizeGroupName(group.name),
        Number(group.order) || 0,
        Number(group.updatedAt) || 0,
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    const sortedTombstones = (tombstones) =>
      Object.keys(tombstones).sort().map((key) => [key, tombstones[key]]);

    return JSON.stringify({
      bookmarks,
      groups,
      tombstones: {
        bookmarks: sortedTombstones(tombstones.bookmarks),
        groups: sortedTombstones(tombstones.groups),
      },
    });
  }

  root.SyncCore = {
    SCHEMA_VERSION,
    APP_ID,
    DEFAULT_GROUP_ID,
    DEFAULT_GROUP_NAME,
    TOMBSTONE_TTL,
    randomId,
    normalizeUrl,
    normalizeGroupName,
    normalizeVisits,
    mergeVisits,
    sumVisits,
    normalizeTombstones,
    mergeTombstones,
    pruneTombstones,
    normalizeLocalState,
    buildSnapshot,
    coerceSnapshot,
    mergeSnapshots,
    applySnapshot,
    signature,
  };
})(typeof self !== 'undefined' ? self : globalThis);
