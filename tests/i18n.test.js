/* eslint-disable no-console */
// 国际化一致性测试：运行：node tests/i18n.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

globalThis.self = globalThis;
require('../i18n.js');

const I18n = globalThis.I18n;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const manifest = readJson('manifest.json');
const en = readJson('_locales/en/messages.json');
const zh = readJson('_locales/zh_CN/messages.json');

const SCANNED_FILES = [
  'newtab.html',
  'popup.html',
  'newtab.js',
  'popup.js',
  'background.js',
];

const HTML_FILES = ['newtab.html', 'popup.html'];

const CHINESE = /[一-鿿]/;

// 取出消息里用到的具名占位符（$name$）
function namedPlaceholders(message) {
  const found = new Set();
  const regex = /\$([A-Za-z0-9_]+)\$/g;
  let match = regex.exec(message);
  while (match) {
    found.add(match[1]);
    match = regex.exec(message);
  }
  return found;
}

// 取出消息里直接使用的位置占位符（$1 ~ $9）
function positionalPlaceholders(message) {
  const found = new Set();
  const regex = /\$([1-9])/g;
  let match = regex.exec(message);
  while (match) {
    found.add(match[1]);
    match = regex.exec(message);
  }
  return found;
}

test('manifest 使用 __MSG__ 且带 default_locale', () => {
  assert.strictEqual(manifest.default_locale, 'en');
  assert.strictEqual(manifest.name, '__MSG_extName__');
  assert.strictEqual(manifest.description, '__MSG_extDescription__');
  assert.strictEqual(manifest.version, '1.2.0');
});

test('manifest 引用的消息 key 在两种语言里都存在', () => {
  const referenced = [];
  ['name', 'description'].forEach((field) => {
    const value = manifest[field];
    assert.ok(/^__MSG_.+__$/.test(value), `${field} 应使用 __MSG_ 格式：${value}`);
    referenced.push(value.slice('__MSG_'.length, -'__'.length));
  });

  referenced.forEach((key) => {
    assert.ok(en[key], `en 缺少消息 ${key}`);
    assert.ok(zh[key], `zh_CN 缺少消息 ${key}`);
  });
});

test('两种语言的 key 集合完全一致', () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepStrictEqual(enKeys, zhKeys);
  assert.ok(enKeys.length > 0);
});

test('每条消息都非空', () => {
  Object.keys(en).forEach((key) => {
    assert.ok(typeof en[key].message === 'string' && en[key].message.trim(), `en/${key} 消息为空`);
    assert.ok(typeof zh[key].message === 'string' && zh[key].message.trim(), `zh_CN/${key} 消息为空`);
  });
});

test('占位符声明与消息内容匹配，且两种语言一致', () => {
  Object.keys(en).forEach((key) => {
    const enEntry = en[key];
    const zhEntry = zh[key];

    const enNamed = namedPlaceholders(enEntry.message);
    const zhNamed = namedPlaceholders(zhEntry.message);
    assert.deepStrictEqual([...zhNamed].sort(), [...enNamed].sort(), `${key} 两种语言的具名占位符不一致`);

    const enDeclared = Object.keys(enEntry.placeholders || {}).sort();
    const zhDeclared = Object.keys(zhEntry.placeholders || {}).sort();
    assert.deepStrictEqual(zhDeclared, enDeclared, `${key} 两种语言的 placeholders 声明不一致`);

    enNamed.forEach((name) => {
      assert.ok(enDeclared.includes(name), `en/${key} 使用了未声明的占位符 $${name}$`);
    });

    enDeclared.forEach((name) => {
      const enContent = (enEntry.placeholders[name] || {}).content || '';
      const zhContent = (zhEntry.placeholders[name] || {}).content || '';
      assert.strictEqual(zhContent, enContent, `${key} 占位符 $${name}$ 的 content 两种语言不一致`);
      assert.ok(/^\$[1-9]$/.test(enContent), `${key} 占位符 $${name}$ 的 content 应为 $N 形式`);
    });

    assert.deepStrictEqual(
      [...positionalPlaceholders(zhEntry.message)].sort(),
      [...positionalPlaceholders(enEntry.message)].sort(),
      `${key} 两种语言的位置占位符不一致`
    );
  });
});

test('页面与脚本里引用的 i18n key 都存在于两种语言目录', () => {
  const missing = [];

  SCANNED_FILES.forEach((file) => {
    const source = readText(file);

    const attrRegex = /data-i18n(?:-[a-z]+)?\s*=\s*"([^"]+)"/g;
    let match = attrRegex.exec(source);
    while (match) {
      if (!en[match[1]] || !zh[match[1]]) missing.push(`${file} data-i18n: ${match[1]}`);
      match = attrRegex.exec(source);
    }

    const callRegex = /I18n\.t\(\s*'([^']+)'/g;
    let call = callRegex.exec(source);
    while (call) {
      if (!en[call[1]] || !zh[call[1]]) missing.push(`${file} I18n.t: ${call[1]}`);
      call = callRegex.exec(source);
    }
  });

  assert.deepStrictEqual(missing, [], `以下 i18n key 未在两种语言目录中定义：\n${missing.join('\n')}`);
});

test('HTML 去掉注释后不再残留中文硬编码', () => {
  HTML_FILES.forEach((file) => {
    const stripped = readText(file).replace(/<!--[\s\S]*?-->/g, '');
    const found = stripped.match(CHINESE);
    assert.strictEqual(found, null, `${file} 仍有中文字符：${found ? found.join('') : ''}`);
  });
});

test('I18n.t 能取到消息，缺失时回退到 key', () => {
  const messages = {
    hello: { message: '你好' },
    count: {
      message: '共 $total$ 条',
      placeholders: { total: { content: '$1' } },
    },
  };

  globalThis.chrome = {
    i18n: {
      getUILanguage: () => 'zh-CN',
      getMessage: (key, substitutions) => {
        const entry = messages[key];
        if (!entry) return '';
        const subs = Array.isArray(substitutions) ? substitutions : [];
        let text = entry.message;
        Object.keys(entry.placeholders || {}).forEach((name) => {
          const content = entry.placeholders[name].content || '';
          const indexMatch = /^\$([1-9])$/.exec(content);
          const value = indexMatch && subs[Number(indexMatch[1]) - 1] !== undefined
            ? String(subs[Number(indexMatch[1]) - 1])
            : content;
          text = text.split(`$${name}$`).join(value);
        });
        return text;
      },
    },
  };

  assert.strictEqual(I18n.t('hello'), '你好');
  assert.strictEqual(I18n.t('count', ['3']), '共 3 条');
  assert.strictEqual(I18n.t('not-exist'), 'not-exist');
  assert.strictEqual(I18n.t(''), '');
});

test('htmlLang 跟随浏览器语言', () => {
  globalThis.chrome = { i18n: { getUILanguage: () => 'zh-CN' } };
  assert.strictEqual(I18n.htmlLang(), 'zh-CN');

  globalThis.chrome = { i18n: { getUILanguage: () => 'zh-TW' } };
  assert.strictEqual(I18n.htmlLang(), 'zh-CN');

  globalThis.chrome = { i18n: { getUILanguage: () => 'en-US' } };
  assert.strictEqual(I18n.htmlLang(), 'en');

  globalThis.chrome = { i18n: { getUILanguage: () => 'fr-FR' } };
  assert.strictEqual(I18n.htmlLang(), 'en');

  delete globalThis.chrome;
  assert.strictEqual(I18n.uiLanguage(), 'en');
  assert.strictEqual(I18n.htmlLang(), 'en');
  assert.strictEqual(I18n.t('groupDefault'), 'groupDefault');
});

test('默认分组存储值保持中文，界面显示走 i18n', () => {
  globalThis.self = globalThis;
  require('../sync-core.js');
  const S = globalThis.SyncCore;
  assert.strictEqual(S.DEFAULT_GROUP_NAME, '默认分组');
  assert.strictEqual(S.DEFAULT_GROUP_ID, 'default');
});

console.log(`\n${passed} tests passed`);
