# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for taking the time to contribute to this project. This guide covers local development, testing, committing and pull requests; please read it before submitting a change.

## Project constraints

- A Chrome Manifest V3 extension written in plain HTML / CSS / JavaScript — no framework, no build step, no npm dependencies.
- Supports Chrome / Edge 88+ and other Chromium-based browsers.
- The user interface is bilingual (English / Simplified Chinese) and follows the browser language; user-visible copy lives in `_locales/`.
- Code comments, `console.*` logs and commit messages stay in Simplified Chinese.

## Local development

1. Fork and clone the repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the project root.
5. After editing the code, click "Reload" on the extensions page to apply the changes.

## Running the tests

The tests run directly with Node.js; no dependency installation is needed:

```bash
node tests/sync-core.test.js
node tests/webdav-sync.test.js
node tests/i18n.test.js
```

- `sync-core.test.js`: unit tests for the pure functions of the sync core.
- `webdav-sync.test.js`: integration tests with a mocked Chrome API and a local HTTP server that simulates WebDAV.
- `i18n.test.js`: consistency tests for the message catalogs and the `data-i18n*` markers.

## Coding conventions

- 2-space indentation, single quotes, semicolons, `async/await`, prefer `const`.
- Use the native DOM API; do not introduce frameworks, build tools or new npm dependencies.
- Keep zero external resources: fonts and icons are local.
- Sync logic must live in `sync-core.js` and stay pure (no network, no chrome API dependency), otherwise it cannot be tested.
- Keep permissions minimal: WebDAV domains keep using `optional_host_permissions` on demand; do not switch to all-site permissions at install time.
- User-visible copy must be defined in `_locales/<locale>/messages.json`; static markup uses `data-i18n*` attributes and dynamic markup uses `I18n.t('key')`. Both locale directories must define exactly the same key set.
- `SyncCore.DEFAULT_GROUP_NAME` is the **cross-device identity** of the default group and must never be translated; only its on-screen label is localized.
- Use `try/catch` on failure paths and keep readable error messages; never swallow exceptions silently.
- Do not hardcode accounts, keys or WebDAV credentials in the code.

## Documentation

- README, privacy policy and contribution guide are maintained in two languages: the English file is the primary document and the `*.zh-CN.md` file is its Chinese counterpart. Change both in the same commit.
- `AGENTS.md` is an internal Chinese-only document for AI coding agents and is not translated.

## Test requirements

- Pure function changes: add cases to `tests/sync-core.test.js`.
- Changes to network, messaging or storage behaviour: add cases to `tests/webdav-sync.test.js`.
- Changes to i18n copy, message catalogs or `data-i18n*` markers: run and extend `tests/i18n.test.js`.
- Any modification that changes sync snapshot semantics must update `SCHEMA_VERSION` and stay compatible with the old format.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/); common scopes:

- `feat(sync)`, `fix(newtab)`, `perf(newtab)`, `refactor(frontend)`, `docs`, `chore`

Examples:

```text
feat(sync): 支持 WebDAV 分页拉取
fix(newtab): 修复拖拽排序后顺序丢失
docs: 补充贡献指南
```

## Submitting a pull request

1. Create a branch from the remote default branch; keep one PR focused on one thing.
2. Describe the motivation, the changes and how you verified them in the PR description.
3. Make sure all three test files pass; attach screenshots or recordings for UI changes.
4. Do not commit WebDAV accounts, passwords, app-specific passwords or other secrets.
5. Release-related changes must bump the `version` in `manifest.json`.

## Reporting issues

Please use the issue templates and provide as much as possible:

- Browser and version, extension version (the `version` in `manifest.json`), and operating system;
- Steps to reproduce, expected behaviour and actual behaviour;
- Console errors or screenshots (please remove accounts, passwords, WebDAV addresses and other sensitive information first).

## Security issues

If you find a security vulnerability, please do not open a public issue. Contact the maintainer through GitHub's private channels and disclose it publicly once it is fixed.
