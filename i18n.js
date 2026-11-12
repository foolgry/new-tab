// 国际化运行时：统一读取 chrome.i18n 消息，缺失时回退到 key
// 界面语言跟随浏览器语言：zh* → 简体中文，其余 → 英文
(function (root) {
  'use strict';

  // 取消息；没有 chrome.i18n（Node 测试环境）或 key 不存在时回退 key
  function t(key, substitutions) {
    if (!key) return '';
    if (root.chrome && root.chrome.i18n && typeof root.chrome.i18n.getMessage === 'function') {
      const message = root.chrome.i18n.getMessage(key, substitutions);
      if (message) return message;
    }
    return key;
  }

  // 浏览器界面语言，如 zh-CN / en-US
  function uiLanguage() {
    if (root.chrome && root.chrome.i18n && typeof root.chrome.i18n.getUILanguage === 'function') {
      const language = root.chrome.i18n.getUILanguage();
      if (language) return language;
    }
    return 'en';
  }

  // 写进 <html lang> 的值
  function htmlLang() {
    return /^zh/i.test(uiLanguage()) ? 'zh-CN' : 'en';
  }

  // 遍历文档中的 data-i18n* 标记并写入对应文案
  function localizeDocument(doc) {
    const target = doc || root.document;
    if (!target) return;

    if (target.documentElement) {
      target.documentElement.lang = htmlLang();
    }

    const apply = (selector, applyTo) => {
      const nodes = target.querySelectorAll(selector);
      for (let i = 0; i < nodes.length; i += 1) {
        applyTo(nodes[i]);
      }
    };

    apply('[data-i18n]', (el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });

    apply('[data-i18n-placeholder]', (el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });

    apply('[data-i18n-title]', (el) => {
      const message = t(el.getAttribute('data-i18n-title'));
      if (el.tagName === 'TITLE') {
        target.title = message;
      } else {
        el.setAttribute('title', message);
      }
    });

    apply('[data-i18n-alt]', (el) => {
      el.setAttribute('alt', t(el.getAttribute('data-i18n-alt')));
    });

    apply('[data-i18n-content]', (el) => {
      el.setAttribute('content', t(el.getAttribute('data-i18n-content')));
    });

    // <html data-i18n-title="..."> 也可以指定页面标题
    if (target.documentElement) {
      const htmlTitle = target.documentElement.getAttribute('data-i18n-title');
      if (htmlTitle) target.title = t(htmlTitle);
    }
  }

  root.I18n = {
    t,
    uiLanguage,
    htmlLang,
    localizeDocument,
  };
})(typeof self !== 'undefined' ? self : globalThis);
