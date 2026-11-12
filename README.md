# Custom New Tab Extension

English | [简体中文](README.zh-CN.md)

A clean, modern Chrome new tab page bookmark extension with manual bookmark entry, drag-and-drop ordering, and visit-frequency statistics.

## Features

- ✨ Replaces the default Chrome new tab page with your own bookmarks
- ➕ Add bookmarks manually
- 🖱️ Save the current page as a bookmark from the toolbar icon
- 🔄 Drag-and-drop ordering (custom order mode)
- 📊 Visit-frequency statistics and smart sorting
- ☁️ WebDAV cloud sync (Nutstore / Nextcloud / Synology / AList and more)
- 💾 Local storage, your data stays on your device
- 🌐 Bilingual UI (English / Simplified Chinese) that follows the browser language
- 🎨 Modern, minimal UI design

## Installation

### Option 1: Developer mode

1. Download or clone this project
2. Open Chrome
3. Go to `chrome://extensions/`
4. Turn on "Developer mode" in the top-right corner
5. Click "Load unpacked"
6. Select the project folder
7. Done!

### Option 2: Packaged extension

1. Create a zip file in the project folder
2. Drag the zip file onto the Chrome extensions page to install it

## Usage

### New tab page
- Open a new tab (Ctrl+T) after installing to see your custom bookmark page
- Click the "Add Bookmark" button to add a site manually
- Click a bookmark to open the site
- Switch sorting mode: custom order / by visit frequency
- In custom order mode you can drag bookmarks to rearrange them

### Toolbar popup
- Click the extension icon in the browser toolbar
- The current page is detected automatically
- Add the current page to your bookmarks with one click
- View all bookmarks

### Cloud sync (WebDAV)

Click the ☁ button in the top-right corner of the new tab page, pick a provider and fill in your account and key.

Built-in provider presets:

| Provider | Address | What to fill in |
|---|---|---|
| Nutstore | `https://dav.jianguoyun.com/dav/` | Registered email + app password |
| pCloud | `https://webdav.pcloud.com/` | Email + password |
| Yandex Disk | `https://webdav.yandex.ru/` | Email + app password |
| InfiniCLOUD | `https://<server>.teracloud.jp/dav/` | Server name + account + password |
| Nextcloud | `https://<host>/remote.php/dav/files/<user>/` | Address + account + password |
| Synology NAS | `https://<host>:5006/` | Address + account + password |
| AList | `http://<host>:5244/dav/` | Address + account + password |
| Custom | any WebDAV directory | Address + account + password |

Sync notes:

- The sync file is `newtab-bookmarks.json` in the target directory by default; the file name can be changed.
- The first sync **merges** local and remote data (deduplicated by URL) and never overwrites either side.
- Changes are pushed automatically after 1 minute; every 15 minutes the remote side is pulled; opening a new tab also triggers a lightweight check.
- Deletions propagate through tombstones that stay valid for 90 days; adding the same URL again restores the bookmark.
- Visit counts are recorded per device and then summed, so multiple devices never overwrite each other.
- The account and password are stored only in the local `chrome.storage.local` and are never uploaded to any other server. Use the "app-specific password" provided by your service.
- WebDAV domains use optional permissions: the browser only asks for a domain when you save the configuration, never for all sites at install time.

## Tech stack

- **Frontend**: plain HTML + CSS + JavaScript (no framework)
- **Extension API**: Chrome Extension Manifest V3
- **Data storage**: Chrome Storage API
- **Internationalization**: `chrome.i18n` with `_locales/en` and `_locales/zh_CN`
- **Cloud sync**: WebDAV (Basic Auth, direct `fetch`)
- **Drag and drop**: native HTML5 Drag and Drop API

## favicon notes

- The extension's built-in `/_favicon/?pageUrl=...&size=...` API is tried first (more stable, works on extension pages).
- On failure it falls back to the Google s2 favicon, then to the site's `/favicon.ico`, and finally to a built-in placeholder icon.

## File structure

```
new-tab-extension/
├── manifest.json         # Extension manifest
├── newtab.html          # New tab page HTML
├── newtab.css           # New tab page styles
├── newtab.js            # New tab page logic
├── popup.html           # Toolbar popup HTML
├── popup.css            # Toolbar popup styles
├── popup.js             # Toolbar popup logic
├── background.js        # Service worker (default data + WebDAV sync engine)
├── sync-core.js         # Sync core pure functions (merge / tombstones / legacy format)
├── i18n.js              # i18n runtime helpers (chrome.i18n wrapper)
├── _locales/
│   ├── en/messages.json # English messages (default locale)
│   └── zh_CN/messages.json # Simplified Chinese messages
├── tests/               # Node unit / integration tests
│   ├── sync-core.test.js    # Sync core unit tests
│   ├── webdav-sync.test.js  # WebDAV sync integration tests
│   └── i18n.test.js         # i18n consistency tests
├── icons/
│   └── tab.png         # Extension icon
├── LICENSE              # MIT License
├── CONTRIBUTING.md      # Contribution guide (English)
├── CONTRIBUTING.zh-CN.md # Contribution guide (Chinese)
├── PRIVACY.md           # Privacy policy (English)
├── PRIVACY.zh-CN.md     # Privacy policy (Chinese)
└── README.md            # Documentation (English)
```

## Development notes

### Data structure
Each bookmark contains the following fields:
```javascript
{
  id: "locally unique identifier",
  title: "bookmark title",
  url: "URL",
  favicon: "site icon URL",
  visitCount: "visit count (sum across devices)",
  lastVisit: "last visit time",
  order: "sort position",
  groupId: "group id",
  updatedAt: "last metadata change time",
  visits: { "device id": visit count }
}
```

Sync uses the **normalized URL** as the identity of a bookmark and the **group name** as the identity of a group; `id` and `groupId` are only valid on a single machine.

### Internationalization

- User-visible copy lives in `_locales/<locale>/messages.json`. Add the same key to every locale directory.
- Static markup uses `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-alt`; dynamic markup uses `I18n.t('key')`.
- `SyncCore.DEFAULT_GROUP_NAME` is the **cross-device identity** of the default group and must never be translated; only its on-screen label is localized.
- Code comments, `console.*` logs and commit messages stay in Simplified Chinese.

### Tests
```bash
node tests/sync-core.test.js
node tests/webdav-sync.test.js
node tests/i18n.test.js
```

### Packaging
```bash
zip -r release/archive.zip . -x "release/*" -x ".claude/*" -x ".DS_Store"
```

### Permissions
- `storage`: store bookmark data
- `activeTab`: read the current page's title and URL
- `alarms`: trigger cloud sync on a schedule
- `optional_host_permissions`: request WebDAV access per domain when saving the sync configuration
- `chrome_url_overrides`: replace the new tab page

## Browser compatibility
- Chrome 88+
- Edge 88+
- Other Chromium-based browsers

## License

Released under the [MIT License](LICENSE).

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first to learn about local development, testing and commit conventions.
