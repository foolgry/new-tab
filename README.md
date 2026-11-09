# 自定义新标签页扩展

一个简洁现代的Chrome新标签页书签扩展，支持手动添加书签、拖拽排序和访问频次统计。

## 功能特性

- ✨ 替换Chrome默认新标签页，显示自定义书签
- ➕ 手动添加书签功能
- 🖱️ 通过扩展图标快速添加当前页面为书签
- 🔄 拖拽排序（自定义顺序模式）
- 📊 访问频次统计和智能排序
- ☁️ WebDAV 云同步（坚果云 / Nextcloud / 群晖 / AList 等）
- 💾 本地存储，数据安全
- 🎨 现代简洁的UI设计

## 安装方法

### 方法一：开发者模式安装

1. 下载或克隆此项目到本地
2. 打开Chrome浏览器
3. 进入 `chrome://extensions/`
4. 开启右上角的"开发者模式"
5. 点击"加载已解压的扩展程序"
6. 选择项目文件夹
7. 安装完成！

### 方法二：打包安装

1. 在项目文件夹中创建一个zip文件
2. 在Chrome扩展页面拖拽zip文件进行安装

## 使用说明

### 新标签页
- 安装后打开新标签页（Ctrl+T）即可看到自定义书签页面
- 点击"添加书签"按钮手动添加网站
- 点击书签卡片访问网站
- 切换排序模式：自定义排序 / 按访问频次排序
- 在自定义排序模式下可以拖拽书签卡片调整顺序

### 扩展弹窗
- 点击浏览器工具栏中的扩展图标
- 自动识别当前页面信息
- 一键添加当前页面到书签
- 查看所有书签

### 云同步（WebDAV）

点击新标签页右上角的 ☁ 按钮，选择服务商后填写账号和密钥即可。

内置服务商预设：

| 服务商 | 地址 | 需要填写 |
|---|---|---|
| 坚果云 | `https://dav.jianguoyun.com/dav/` | 注册邮箱 + 应用密码 |
| pCloud | `https://webdav.pcloud.com/` | 邮箱 + 密码 |
| Yandex Disk | `https://webdav.yandex.ru/` | 邮箱 + 应用密码 |
| InfiniCLOUD | `https://<server>.teracloud.jp/dav/` | 服务器名 + 账号 + 密码 |
| Nextcloud | `https://<host>/remote.php/dav/files/<user>/` | 地址 + 账号 + 密码 |
| 群晖 NAS | `https://<host>:5006/` | 地址 + 账号 + 密码 |
| AList | `http://<host>:5244/dav/` | 地址 + 账号 + 密码 |
| 自定义 | 任意 WebDAV 目录 | 地址 + 账号 + 密码 |

同步说明：

- 同步文件默认为目录下的 `newtab-bookmarks.json`，可自行修改文件名。
- 首次同步会把本地与远端数据**合并**（按 URL 去重），不会直接覆盖任何一端。
- 修改后 1 分钟自动推送；每 15 分钟自动拉取一次；打开新标签页时也会轻量检查。
- 删除操作通过 90 天有效期的删除标记在设备间传播，重新添加同一 URL 可以恢复。
- 访问次数按设备分别记录后求和，多端使用不会互相覆盖。
- 账号和密码只保存在本机 `chrome.storage.local`，不会上传到其他服务器。请使用服务商的「应用专用密码」。
- WebDAV 域名使用可选权限，只在保存配置时向浏览器申请该域名，不在安装时索取全站权限。

## 技术实现

- **前端**: 纯HTML + CSS + JavaScript（无框架依赖）
- **扩展API**: Chrome Extension Manifest V3
- **数据存储**: Chrome Storage API
- **云同步**: WebDAV（Basic Auth，fetch 直连）
- **拖拽功能**: 原生HTML5 Drag and Drop API

## favicon 说明

- 优先使用扩展内置的 `/_favicon/?pageUrl=...&size=...` 获取图标（更稳定，适用于扩展页）。
- 如果获取失败，会自动回退到 Google s2 favicon，再回退到站点的 `/favicon.ico`，最后使用内置占位图标。

## 文件结构

```
new-tab-extension/
├── manifest.json         # 扩展清单文件
├── newtab.html          # 新标签页HTML
├── newtab.css           # 新标签页样式
├── newtab.js            # 新标签页逻辑
├── popup.html           # 扩展弹窗HTML
├── popup.css            # 扩展弹窗样式
├── popup.js             # 扩展弹窗逻辑
├── background.js        # 后台服务脚本（默认数据 + WebDAV 同步引擎）
├── sync-core.js         # 同步核心纯函数（合并 / 删除标记 / 兼容旧格式）
├── tests/               # Node 单元 / 集成测试
│   ├── sync-core.test.js    # 同步核心单元测试
│   └── webdav-sync.test.js  # WebDAV 同步集成测试
├── icons/
│   └── icon.svg         # 扩展图标
├── LICENSE              # MIT 许可证
├── CONTRIBUTING.md      # 贡献指南
└── README.md            # 说明文档
```

## 开发说明

### 数据结构
每个书签包含以下字段：
```javascript
{
  id: "本机唯一标识",
  title: "书签标题",
  url: "网址",
  favicon: "网站图标URL",
  visitCount: "访问次数（各设备之和）",
  lastVisit: "最后访问时间",
  order: "排序位置",
  groupId: "分组 id",
  updatedAt: "元数据最后修改时间",
  visits: { "设备标识": 访问次数 }
}
```

同步以「规范化 URL」作为书签身份、以「分组名称」作为分组身份；`id` 和 `groupId` 只在单机内有效。

### 测试
```bash
node tests/sync-core.test.js
node tests/webdav-sync.test.js
```

### 打包
```bash
zip -r release/archive.zip . -x "release/*" -x ".claude/*" -x ".DS_Store"
```

### 权限说明
- `storage`: 存储书签数据
- `activeTab`: 获取当前页面信息
- `alarms`: 定时触发云同步
- `optional_host_permissions`: 保存同步配置时按域名申请 WebDAV 访问权限
- `chrome_url_overrides`: 替换新标签页

## 浏览器兼容性
- Chrome 88+
- Edge 88+
- 其他基于Chromium的浏览器

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

## 贡献

欢迎提交 Issue 和 Pull Request。开始之前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，了解本地开发、测试和提交约定。
