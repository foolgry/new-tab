# AGENTS.md

本文件面向在本仓库工作的 AI 编码代理。人类开发说明见 `README.md`。

## 项目概览

Chrome 新标签页书签扩展（Manifest V3）。纯 HTML/CSS/JavaScript，无框架、无构建步骤、无 `package.json` 依赖。数据存于 `chrome.storage.local`，通过 WebDAV 在设备间同步。

- Chrome / Edge 88+（Chromium 内核）
- 主要语言：JavaScript（ES2020+ 语法，但扩展页面不做模块化打包）
- 用户可见文案、注释、提交信息均使用简体中文

## 目录结构

```
manifest.json       扩展清单（MV3），权限与入口定义
background.js       Service Worker：默认数据初始化、WebDAV 同步调度、定时任务
sync-core.js        同步核心纯函数（合并/删除标记/规范化），无 chrome API 依赖
newtab.html/css/js  新标签页（书签展示、分组、拖拽、同步配置 UI）
popup.html/css/js   工具栏弹窗（一键添加当前页）
migrate.js          一次性数据迁移脚本（手动在扩展页控制台执行）
tests/              Node 单元 / 集成测试
icons/tab.png       扩展图标
release/            打包产物（不要提交新 zip，除非用户明确要求）
```

## 常用命令

```bash
# 单元测试：同步核心
node tests/sync-core.test.js

# 集成测试：mock chrome API + 本地 HTTP 服务器模拟 WebDAV
node tests/webdav-sync.test.js

# 打包（与 README 保持一致，排除 release/.claude/.DS_Store）
zip -r release/archive.zip . -x "release/*" -x ".claude/*" -x ".DS_Store"
```

修改后没有自动化 lint/typecheck；验证方式是跑上述测试，并在 `chrome://extensions/` 里「重新加载」扩展后手动回归对应页面。

## 架构与职责边界

- `background.js` 是 Service Worker，**没有 DOM**，不能使用 `document` / `window`。它通过 `importScripts('sync-core.js')` 引入同步核心，并监听：
  - `chrome.runtime.onInstalled` / `onStartup`：初始化默认数据、设备标识、同步闹钟
  - `chrome.alarms`：`sync-periodic`（15 分钟拉取）、`sync-pending`（修改后 1 分钟防抖推送）
  - `chrome.runtime.onMessage`：响应页面发起的同步请求
- `newtab.js` 与 `popup.js` 是普通页面脚本，通过 `<script src="sync-core.js">` 共享同一套纯函数。
- `sync-core.js` 用 IIFE 挂载到 `root.SyncCore`，结尾同时兼容 `self`（Worker）与 `globalThis`（Node 测试）。**新增同步逻辑必须放在这里并保持纯函数（无网络、无 chrome API）**，否则无法测试。

## 数据模型与关键不变量

`chrome.storage.local` 键：

| 键 | 内容 |
|---|---|
| `bookmarks` | 书签数组 |
| `groups` | 分组数组 |
| `currentGroupId` | 当前选中的分组 |
| `deviceId` | 本机设备标识 |
| `tombstones` | 删除标记（书签 / 分组） |
| `syncConfig` | WebDAV 地址、账号、文件名、上次同步状态等 |

书签字段：`id`、`title`、`url`、`favicon`、`visitCount`、`lastVisit`、`order`、`groupId`、`updatedAt`、`visits`。

必须遵守的同步不变量：

1. **跨设备身份用规范化 URL**（`SyncCore.normalizeUrl`），不是 `id`；分组身份用分组名称（`normalizeGroupName`），不是 `groupId`。`id` / `groupId` 只在本机有效。
2. **合并永不覆盖一端**：首次同步与每次同步都按 URL 取并集，不可用远端数据直接 `set` 覆盖本地。
3. **删除通过 `tombstones` 传播**，保留 90 天（`TOMBSTONE_TTL`）；重新添加同一 URL 会清除标记并恢复。
4. **访问次数按设备分桶**（`visits[deviceId]`）后求和，合并时同设备取 `max`，避免多端互相覆盖。
5. 任何会改变同步快照语义的修改，必须同步更新 `SCHEMA_VERSION` 并兼容旧格式（参考 `coerceSnapshot` / `normalizeLocalState`）。

## 编码约定

- 沿用现有风格：2 空格缩进、单引号、分号、`async/await`、`const` 优先。
- 原生 DOM API，不引入框架或构建工具；不新增 npm 依赖。
- 保持零外链资源：字体、图标均本地化（见提交 `bf1a8f5`）。favicon 走内置 `/_favicon/` → Google s2 → 站点 `/favicon.ico` → 占位图的回退链。
- 权限最小化：WebDAV 域名使用 `optional_host_permissions` 按域名动态申请，**不要**改成安装时的全站权限。
- 错误信息与日志用中文；失败路径必须 `try/catch` 并保留可读错误，不要静默吞掉（`newtab.js` / `background.js` 现有写法可参考）。
- 不要在代码中硬编码账号、密钥或 WebDAV 凭据；凭据只能存 `chrome.storage.local`。

## 测试要求

- 纯函数改动：在 `tests/sync-core.test.js` 增加用例。
- 涉及网络、消息、存储行为的改动：在 `tests/webdav-sync.test.js` 增加用例（已有 chrome API mock 与本地 WebDAV 服务器）。
- 测试不依赖浏览器，直接 `node <file>` 运行；不要引入测试框架。

## 提交与发布

- 遵循 Conventional Commits，scope 可参考历史：`feat(sync)`、`perf(newtab)`、`refactor(frontend)`、`chore`。
- `release/*.zip` 已被版本库跟踪，仅在发布时替换；`.zcode/`、`.DS_Store` 已被 `.gitignore` 忽略。
- 发布前确认 `manifest.json` 的 `version` 已递增，并跑完两个测试文件。
