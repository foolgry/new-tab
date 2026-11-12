# Privacy Policy

English | [简体中文](PRIVACY.zh-CN.md)

Last updated: November 9, 2026

This privacy policy applies to the Chrome extension "Custom New Tab - Bookmark Manager" (hereinafter "the Extension").

## 1. Data Storage

The Extension does not collect or upload data to the developer or to any third-party analytics service. Bookmarks, groups, visit counts and settings are stored by default only in the user's browser via `chrome.storage.local`.

## 2. WebDAV Sync

- Only after the user explicitly enables and configures WebDAV sync does the Extension write bookmark snapshots to the WebDAV server the user specified.
- That server is chosen and controlled by the user (for example Nutstore, Nextcloud, Synology NAS, AList, or a self-hosted WebDAV service).
- The WebDAV account and password are stored only in the local `chrome.storage.local`, are used solely to authenticate requests to the WebDAV address the user configured, and are never sent to the developer or any other third party.
- The user can turn sync off at any time in the extension settings and delete the sync file on the WebDAV server themselves.

## 3. Permission Purposes

| Permission | Purpose |
| --- | --- |
| `storage` | Store bookmarks, groups, tombstones and sync configuration |
| `activeTab` | Read the current tab's title and URL when the user clicks the extension icon, to add a bookmark with one click |
| `favicon` | Display the favicon of the site a bookmark points to |
| `alarms` | Trigger WebDAV sync on a schedule |
| `optional_host_permissions` | Request access to a server only when the user saves a WebDAV configuration, and only for that domain |

## 4. Data Sharing and Sale

The Extension does not sell, rent or share user data with any third party. WebDAV sync is configured by the user, and data is only transmitted to the server the user specified.

## 5. Data Deletion

Users can delete individual bookmarks or groups in the extension UI; uninstalling the Extension clears all local data in `chrome.storage.local`. The sync file on the WebDAV server must be deleted by the user at the provider.

## 6. Children's Privacy

The Extension is not directed at children under 13 and does not knowingly collect data from children.

## 7. Policy Updates

If this policy changes, we will update this page and change the "Last updated" date.

## 8. Contact

For questions, please reach us through GitHub Issues: <https://github.com/foolgry/new-tab/issues>
