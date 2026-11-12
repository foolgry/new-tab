/* eslint-disable no-console */
// 可选的真实浏览器双语回归：node tests/i18n-browser-check.js [--out <目录>]
//
// 用本机 Chrome / Edge / Chromium 无头加载扩展，分别以 en、zh_CN 两套消息目录
// 渲染 newtab、popup、同步面板，断言实际文案与消息目录一致，并保存截图供人工检查排版。
// 与另外三个 Node 测试不同，本脚本依赖浏览器：找不到浏览器或 Node 无全局 WebSocket
// （需要 Node 22+）时直接跳过并以 0 退出。
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex !== -1 && process.argv[outIndex + 1]
  ? path.resolve(process.argv[outIndex + 1])
  : fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-browser-check-'));
fs.mkdirSync(outDir, { recursive: true });

// 种子数据：默认分组用中文存储名「默认分组」，另加一个自定义分组和两条书签
const SEED_DATA = {
  deviceId: 'i18n-device',
  groups: [
    { id: 'default', name: '默认分组', order: 0, updatedAt: 0 },
    { id: 'g2', name: '自定义A', order: 1, updatedAt: 0 },
  ],
  bookmarks: [
    { id: 'b1', title: 'Example Site', url: 'https://example.com/', favicon: '', visitCount: 0, lastVisit: 0, order: 0, groupId: 'default', updatedAt: 1, visits: {} },
    { id: 'b2', title: 'Another Site', url: 'https://example.org/', favicon: '', visitCount: 0, lastVisit: 0, order: 1, groupId: 'g2', updatedAt: 1, visits: {} },
  ],
  currentGroupId: 'default',
  tombstones: { bookmarks: {}, groups: {} },
};

const DEFAULT_GROUP_NAME = '默认分组';
const CUSTOM_GROUP_NAME = '自定义A';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCatalog(locale) {
  return readJson(path.join(ROOT, '_locales', locale, 'messages.json'));
}

// 按消息目录的 placeholders 声明做替换，用于计算期望文案
function substitute(entry, substitutions) {
  let text = entry.message;
  Object.keys(entry.placeholders || {}).forEach((name) => {
    const content = (entry.placeholders[name] || {}).content || '';
    const indexMatch = /^\$([1-9])$/.exec(content);
    const value = indexMatch && substitutions[Number(indexMatch[1]) - 1] !== undefined
      ? String(substitutions[Number(indexMatch[1]) - 1])
      : content;
    text = text.split(`$${name}$`).join(value);
  });
  return text;
}

function findChromeBinary() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execSync(`command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (found) return found;
    } catch {
      // 继续找下一个
    }
  }
  return null;
}

// ==================== CDP 客户端 ====================

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    });
  }

  static connect(wsUrl) {
    const cdp = new Cdp(wsUrl);
    return new Promise((resolve, reject) => {
      cdp.ws.addEventListener('open', () => resolve(cdp));
      cdp.ws.addEventListener('error', () => reject(new Error('无法连接 DevTools 端口')));
    });
  }

  send(method, params, sessionId) {
    this.seq += 1;
    const payload = { id: this.seq, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(this.seq, (message) => {
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // 忽略关闭异常
    }
  }
}

function launchChrome(binary, userDataDir) {
  const proc = spawn(binary, [
    '--headless=new',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    // 贴近真实新标签页尺寸，便于检查英文长文案是否挤压布局
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('等待 DevTools 端口超时'));
    }, 30000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ proc, wsUrl: match[1] });
      }
    });

    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`浏览器提前退出（code ${code}）：${stderr.slice(0, 400)}`));
    });
  });
}

async function evalValue(cdp, sessionId, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    const description = (detail.exception && detail.exception.description) || detail.text;
    throw new Error(`页面脚本异常：${description}`);
  }
  return result.result.value;
}

// 轮询等待页面条件成立（页面刷新期间上下文会销毁，需要容忍瞬时异常）
async function poll(cdp, sessionId, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evalValue(cdp, sessionId, expression);
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待条件超时：${expression}${lastError ? `（最后错误：${lastError.message}）` : ''}`);
}

async function saveScreenshot(cdp, sessionId, filePath) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
}

// ==================== 页面采集 ====================

const COLLECT_NEWTAB = `(function () {
  const q = (selector) => document.querySelector(selector);
  return JSON.stringify({
    htmlLang: document.documentElement.lang,
    title: document.title,
    searchPlaceholder: q('#search-input') ? q('#search-input').placeholder : null,
    sortCustom: q('#sort-custom') ? q('#sort-custom').textContent : null,
    sortFrequency: q('#sort-frequency') ? q('#sort-frequency').textContent : null,
    syncBtnTitle: q('#sync-btn') ? q('#sync-btn').title : null,
    groupNames: Array.from(document.querySelectorAll('.group-name')).map((el) => el.textContent),
    rowCount: document.querySelectorAll('.bookmark-row').length,
  });
})()`;

const COLLECT_SYNC_MODAL = `(function () {
  const q = (selector) => document.querySelector(selector);
  const modal = document.getElementById('sync-modal');
  const provider = document.getElementById('sync-provider');
  const options = provider ? Array.from(provider.options).map((option) => ({
    value: option.value,
    label: option.textContent
  })) : [];
  const find = (value) => (options.find((option) => option.value === value) || {}).label || null;
  return JSON.stringify({
    visible: modal ? modal.style.display === 'flex' : false,
    modalTitle: q('#sync-modal h2') ? q('#sync-modal h2').textContent : null,
    note: q('.sync-note') ? q('.sync-note').textContent : null,
    providerCount: options.length,
    providerCustomLabel: find('custom'),
    providerJianguoyunLabel: find('jianguoyun'),
    hint: document.getElementById('sync-url-hint') ? document.getElementById('sync-url-hint').textContent : null,
  });
})()`;

const COLLECT_POPUP = `(function () {
  const q = (selector) => document.querySelector(selector);
  const group = document.getElementById('bookmark-group');
  return JSON.stringify({
    htmlLang: document.documentElement.lang,
    title: document.title,
    submitLabel: q('#submit-btn') ? q('#submit-btn').textContent : null,
    viewAllLabel: q('#view-bookmarks') ? q('#view-bookmarks').textContent : null,
    firstGroupOption: group && group.options.length ? group.options[0].textContent : null,
  });
})()`;

const COLLECT_SERVICE_WORKER = `(function () {
  return JSON.stringify({
    notObject: localizeSyncError({ code: 'SYNC_FILE_NOT_OBJECT', message: '原始中文错误' }),
    unknownFormat: localizeSyncError({ code: 'SYNC_FILE_UNKNOWN_FORMAT', message: '原始中文错误' }),
    fallback: localizeSyncError({ message: '原始中文错误' }),
    actionRead: I18n.t('bgActionRead'),
  });
})()`;

// ==================== 断言 ====================

function check(failures, label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return true;
  failures.push(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  return false;
}

function checkOneOf(failures, label, actual, expectedList) {
  if (expectedList.includes(actual)) return true;
  failures.push(`${label}：期望 ${JSON.stringify(expectedList)} 之一，实际 ${JSON.stringify(actual)}`);
  return false;
}

// ==================== 场景执行 ====================

// 复制一份只保留单个语言目录的扩展，并把 default_locale 指向该目录，
// 这样无论浏览器 UI 语言是什么，都会稳定渲染指定的语言
function makeLocaleCopy(locale, workDir) {
  const dir = path.join(workDir, `ext-${locale}`);
  fs.mkdirSync(path.join(dir, '_locales'), { recursive: true });
  [
    'manifest.json',
    'background.js',
    'sync-core.js',
    'i18n.js',
    'newtab.html',
    'newtab.css',
    'newtab.js',
    'popup.html',
    'popup.css',
    'popup.js',
  ].forEach((file) => fs.copyFileSync(path.join(ROOT, file), path.join(dir, file)));
  fs.cpSync(path.join(ROOT, 'icons'), path.join(dir, 'icons'), { recursive: true });
  fs.cpSync(path.join(ROOT, '_locales', locale), path.join(dir, '_locales', locale), { recursive: true });

  const manifest = readJson(path.join(dir, 'manifest.json'));
  manifest.default_locale = locale;
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// 写入种子数据并刷新页面；后台 onInstalled 可能覆盖数据，失败时重试
async function seedAndRender(cdp, sessionId, defaultLabel) {
  const seedExpression = `chrome.storage.local.set(${JSON.stringify(SEED_DATA)}).then(() => 'seeded')`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evalValue(cdp, sessionId, seedExpression, true);
    await evalValue(cdp, sessionId, 'location.reload(); 1');
    await poll(cdp, sessionId, `document.readyState === 'complete' && document.querySelectorAll('.group-name').length >= 2`);
    const blob = JSON.parse(await evalValue(cdp, sessionId, COLLECT_NEWTAB));
    if (blob.groupNames[0] === defaultLabel && blob.groupNames[1] === CUSTOM_GROUP_NAME) return blob;
  }
  throw new Error('种子数据未能稳定渲染（可能被后台初始化覆盖）');
}

async function runScenario(scenario, binary, workDir) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-profile-'));
  const failures = [];
  const { proc, wsUrl } = await launchChrome(binary, userDataDir);
  const cdp = await Cdp.connect(wsUrl);

  try {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: scenario.extDir });
    const extId = loaded.id;

    // ---- newtab 页面 ----
    const newtabTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/newtab.html` });
    const newtabSession = (await cdp.send('Target.attachToTarget', {
      targetId: newtabTarget.targetId,
      flatten: true,
    })).sessionId;

    await poll(cdp, newtabSession, `document.readyState === 'complete' && !!document.getElementById('search-input')`);
    const uiLocale = await evalValue(cdp, newtabSession, 'chrome.i18n.getUILanguage()');
    const locale = scenario.locale || (/^zh/i.test(uiLocale) ? 'zh_CN' : 'en');
    const catalog = loadCatalog(locale);
    console.log(`[${scenario.name}] 浏览器 UI 语言 ${uiLocale} → 生效消息目录 ${locale}`);

    const defaultLabel = catalog.groupDefault.message;
    const newtab = await seedAndRender(cdp, newtabSession, defaultLabel);
    const htmlLang = /^zh/i.test(uiLocale) ? 'zh-CN' : 'en';

    check(failures, 'newtab html lang', newtab.htmlLang, htmlLang);
    check(failures, 'newtab 标题', newtab.title, catalog.newtabTitle.message);
    check(failures, 'newtab 搜索框 placeholder', newtab.searchPlaceholder, catalog.searchPlaceholder.message);
    check(failures, 'newtab 排序标签（自定义）', newtab.sortCustom, catalog.sortCustom.message);
    check(failures, 'newtab 排序标签（访问次数）', newtab.sortFrequency, catalog.sortFrequency.message);
    checkOneOf(failures, 'newtab 同步按钮 title', newtab.syncBtnTitle, [catalog.syncTitle.message, catalog.syncTitleOff.message]);
    check(failures, 'newtab 分组列名', newtab.groupNames, [defaultLabel, CUSTOM_GROUP_NAME]);
    check(failures, 'newtab 书签行数', newtab.rowCount, 2);

    const storedRaw = await evalValue(
      cdp,
      newtabSession,
      `chrome.storage.local.get(['groups']).then((result) => JSON.stringify(result.groups || []))`,
      true
    );
    const storedGroups = JSON.parse(storedRaw);
    check(failures, '存储分组名（跨设备身份不翻译）', storedGroups.map((group) => group.name), [DEFAULT_GROUP_NAME, CUSTOM_GROUP_NAME]);
    check(failures, '存储分组 id', storedGroups.map((group) => group.id), ['default', 'g2']);

    const importDone = await evalValue(cdp, newtabSession, `chrome.i18n.getMessage('importDone', ['3', '1', '2'])`);
    check(failures, 'importDone 占位符替换', importDone, substitute(catalog.importDone, ['3', '1', '2']));

    await saveScreenshot(cdp, newtabSession, path.join(outDir, `${scenario.name}-newtab.png`));

    // ---- 同步面板 ----
    await evalValue(cdp, newtabSession, `document.getElementById('sync-btn').click(); 1`);
    await poll(cdp, newtabSession, `document.getElementById('sync-modal').style.display === 'flex'`);
    const syncModal = JSON.parse(await evalValue(cdp, newtabSession, COLLECT_SYNC_MODAL));
    check(failures, '同步面板可见', syncModal.visible, true);
    check(failures, '同步面板标题', syncModal.modalTitle, catalog.syncModalTitle.message);
    check(failures, '同步面板说明', syncModal.note, catalog.syncNote.message);
    check(failures, '同步服务商数量', syncModal.providerCount, 8);
    check(failures, '同步服务商名称（自定义）', syncModal.providerCustomLabel, catalog.providerCustom.message);
    check(failures, '同步服务商名称（坚果云）', syncModal.providerJianguoyunLabel, catalog.providerJianguoyun.message);
    check(failures, '同步地址提示', syncModal.hint, catalog.providerCustomHint.message);

    await saveScreenshot(cdp, newtabSession, path.join(outDir, `${scenario.name}-sync.png`));

    // ---- popup 页面 ----
    const popupTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
    const popupSession = (await cdp.send('Target.attachToTarget', {
      targetId: popupTarget.targetId,
      flatten: true,
    })).sessionId;
    await poll(cdp, popupSession, `document.readyState === 'complete' && document.querySelectorAll('#bookmark-group option').length >= 1`);
    const popup = JSON.parse(await evalValue(cdp, popupSession, COLLECT_POPUP));
    check(failures, 'popup html lang', popup.htmlLang, htmlLang);
    check(failures, 'popup 标题', popup.title, catalog.popupTitle.message);
    check(failures, 'popup 提交按钮', popup.submitLabel, catalog.addToBookmarks.message);
    check(failures, 'popup 查看全部按钮', popup.viewAllLabel, catalog.viewAllBookmarks.message);
    check(failures, 'popup 默认分组显示名', popup.firstGroupOption, defaultLabel);

    await saveScreenshot(cdp, popupSession, path.join(outDir, `${scenario.name}-popup.png`));

    // ---- 后台 Service Worker 的错误文案翻译 ----
    let workerSession = null;
    const workerDeadline = Date.now() + 15000;
    while (Date.now() < workerDeadline && !workerSession) {
      const targets = await cdp.send('Target.getTargets', {});
      const worker = (targets.targetInfos || []).find((info) => info.type === 'service_worker' && info.url.includes(extId));
      if (worker) {
        workerSession = (await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!workerSession) {
      failures.push('找不到后台 Service Worker target，无法校验错误文案翻译');
    } else {
      const worker = JSON.parse(await evalValue(cdp, workerSession, COLLECT_SERVICE_WORKER));
      check(failures, '后台错误码翻译（不是合法对象）', worker.notObject, catalog.bgSyncFileNotObject.message);
      check(failures, '后台错误码翻译（未知格式）', worker.unknownFormat, catalog.bgSyncFileUnknownFormat.message);
      check(failures, '后台未知错误回退原文', worker.fallback, '原始中文错误');
      check(failures, '后台动作文案', worker.actionRead, catalog.bgActionRead.message);
    }

    if (failures.length === 0) {
      console.log(`[${scenario.name}] 全部断言通过（newtab / 同步面板 / popup / 后台）`);
    } else {
      console.log(`[${scenario.name}] 断言失败 ${failures.length} 项：`);
      failures.forEach((item) => console.log(`    - ${item}`));
    }
    return failures.length === 0;
  } finally {
    cdp.close();
    proc.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      console.log(`提示：临时浏览器目录未能删除：${userDataDir}`);
    }
  }
}

async function main() {
  if (typeof WebSocket === 'undefined') {
    console.log('跳过：当前 Node 没有全局 WebSocket（需要 Node 22+）');
    return 0;
  }
  const binary = findChromeBinary();
  if (!binary) {
    console.log('跳过：未找到 Chrome / Edge / Chromium（可用 CHROME_PATH 环境变量指定）');
    return 0;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-work-'));
  console.log(`浏览器：${binary}`);
  console.log(`产物目录：${outDir}\n`);

  const scenarios = [
    { name: 'real', extDir: ROOT },
    { name: 'en-forced', locale: 'en', extDir: makeLocaleCopy('en', workDir) },
    { name: 'zh-forced', locale: 'zh_CN', extDir: makeLocaleCopy('zh_CN', workDir) },
  ];

  let failed = 0;
  for (const scenario of scenarios) {
    try {
      const passed = await runScenario(scenario, binary, workDir);
      if (!passed) failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[${scenario.name}] 运行失败：${error.message}`);
    }
  }

  console.log(`\n截图目录：${outDir}`);
  if (failed > 0) {
    console.log(`结果：${failed} 个场景未通过`);
    return 1;
  }
  console.log(`结果：${scenarios.length} 个场景全部通过`);
  return 0;
}

main().then((code) => {
  process.exit(code);
}).catch((error) => {
  console.error('回归脚本异常：', error);
  process.exit(1);
});
