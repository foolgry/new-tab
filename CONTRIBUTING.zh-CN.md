# 贡献指南

[English](CONTRIBUTING.md) | 简体中文

感谢你关注并愿意为本项目做出贡献。本文说明本地开发、测试、提交和 PR 的约定，提交前请先阅读。

## 项目约束

- 纯 HTML / CSS / JavaScript 的 Chrome Manifest V3 扩展，无框架、无构建步骤、无 npm 依赖。
- 支持 Chrome / Edge 88+ 及其他 Chromium 内核浏览器。
- 界面中英双语并跟随浏览器语言，用户可见文案统一放在 `_locales/`。
- 代码注释、`console.*` 日志与提交信息继续使用简体中文。

## 本地开发

1. Fork 并克隆仓库到本地。
2. 打开 Chrome，进入 `chrome://extensions/`，开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择项目根目录。
4. 修改代码后，在扩展页点击「重新加载」使改动生效。

## 运行测试

测试直接使用 Node.js 运行，无需安装依赖：

```bash
node tests/sync-core.test.js
node tests/webdav-sync.test.js
node tests/i18n.test.js
```

- `sync-core.test.js`：同步核心纯函数的单元测试。
- `webdav-sync.test.js`：mock Chrome API + 本地 HTTP 服务器模拟 WebDAV 的集成测试。
- `i18n.test.js`：消息目录与 `data-i18n*` 标记的一致性测试。

## 编码约定

- 2 空格缩进、单引号、分号，`async/await`，优先使用 `const`。
- 使用原生 DOM API，不引入框架、构建工具或新的 npm 依赖。
- 保持零外链资源：字体、图标均本地化。
- 同步逻辑必须放在 `sync-core.js` 并保持纯函数（无网络、无 chrome API 依赖），否则无法测试。
- 权限保持最小化：WebDAV 域名继续使用 `optional_host_permissions` 按需申请，不要改为安装时的全站权限。
- 用户可见文案必须定义在 `_locales/<locale>/messages.json`；静态标记使用 `data-i18n*` 属性，动态渲染使用 `I18n.t('key')`。两个语言目录的 key 集合必须完全一致。
- `SyncCore.DEFAULT_GROUP_NAME` 是默认分组的**跨设备身份**，禁止翻译；只有界面显示的标签会被本地化。
- 失败路径使用 `try/catch` 并保留可读的错误信息，不要静默吞掉异常。
- 不要在代码中硬编码账号、密钥或 WebDAV 凭据。

## 文档维护

- README、隐私权政策、贡献指南都维护中英两份：英文文件为主文档，`*.zh-CN.md` 为中文副本，两者在同一次提交里一起修改。
- `AGENTS.md` 是面向 AI 编码代理的中文内部文档，不做翻译。

## 测试要求

- 纯函数改动：在 `tests/sync-core.test.js` 增加用例。
- 涉及网络、消息、存储行为的改动：在 `tests/webdav-sync.test.js` 增加用例。
- 改动 i18n 文案、消息目录或 `data-i18n*` 标记：运行并补充 `tests/i18n.test.js`。
- 任何改变同步快照语义的修改，必须同步更新 `SCHEMA_VERSION` 并兼容旧格式。

## 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)，scope 可参考：

- `feat(sync)`、`fix(newtab)`、`perf(newtab)`、`refactor(frontend)`、`docs`、`chore`

示例：

```text
feat(sync): 支持 WebDAV 分页拉取
fix(newtab): 修复拖拽排序后顺序丢失
docs: 补充贡献指南
```

## 提交 Pull Request

1. 从远程默认分支创建新分支，一个 PR 聚焦一件事。
2. 在 PR 描述中说明动机、改动内容和验证方式。
3. 确认三个测试文件均通过；涉及界面或交互的改动请附截图或录屏。
4. 不要提交 WebDAV 账号、密码、应用专用密码等敏感信息。
5. 发布相关改动需确认 `manifest.json` 的 `version` 已递增。

## 报告问题

请使用 Issue 模板，尽量提供：

- 浏览器及版本、扩展版本（`manifest.json` 中的 `version`）、操作系统；
- 复现步骤、期望行为与实际行为；
- 控制台报错或截图（请先移除账号、密码、WebDAV 地址等敏感信息）。

## 安全问题

如果你发现安全漏洞，请不要公开提交 Issue，请通过 GitHub 的私下渠道联系维护者，待修复后再公开讨论。
