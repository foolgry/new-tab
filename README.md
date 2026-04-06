# 自定义新标签页扩展

一个简洁现代的Chrome新标签页书签扩展，支持手动添加书签、拖拽排序和访问频次统计。

## 功能特性

- ✨ 替换Chrome默认新标签页，显示自定义书签
- ➕ 手动添加书签功能
- 🖱️ 通过扩展图标快速添加当前页面为书签
- 🔄 拖拽排序（自定义顺序模式）
- 📊 访问频次统计和智能排序
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

## 技术实现

- **前端**: 纯HTML + CSS + JavaScript（无框架依赖）
- **扩展API**: Chrome Extension Manifest V3
- **数据存储**: Chrome Storage API
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
├── background.js        # 后台服务脚本
├── icons/
│   └── icon.svg         # 扩展图标
└── README.md            # 说明文档
```

## 开发说明

### 数据结构
每个书签包含以下字段：
```javascript
{
  id: "唯一标识",
  title: "书签标题",
  url: "网址",
  favicon: "网站图标URL",
  visitCount: "访问次数",
  lastVisit: "最后访问时间",
  order: "排序位置"
}
```

### 权限说明
- `storage`: 存储书签数据
- `activeTab`: 获取当前页面信息
- `chrome_url_overrides`: 替换新标签页

## 浏览器兼容性
- Chrome 88+
- Edge 88+
- 其他基于Chromium的浏览器

## 许可证
MIT License

## 贡献
欢迎提交Issue和Pull Request！

zip -r release/archive.zip . -x "release/*" -x ".claude/*" -x ".DS_Store"
