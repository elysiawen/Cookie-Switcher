# 隐私政策 / Privacy Policy

**Cookie Switcher** 浏览器扩展 · 最后更新：2026-10-30 · Last updated: 2026-10-30

[中文](#中文) | [English](#english)

---

## 中文

### 概述

Cookie Switcher（以下简称「本扩展」）用于把某个网站当前的登录状态（Cookie，可选 localStorage）保存为一个「身份」，并在同一网站上一键切换回已保存的身份。**本扩展完全在本地运行，不收集、不存储、不上传任何用户数据到任何服务器。**

### 我们收集哪些数据

**无。** 本扩展不收集、不传输任何个人信息或使用数据。具体而言：

1. 不收集任何可识别个人身份的信息，如姓名、邮箱、账号、设备标识等；
2. 不做统计分析、埋点或崩溃上报，不记录你的浏览行为；
3. 不含广告，不集成任何第三方 SDK；
4. 不发起任何网络请求（无 `fetch` / `XMLHttpRequest` / `WebSocket`）；
5. 不加载任何远程代码，所有脚本均打包在扩展内。

### 数据如何存储

以下数据仅保存在**你自己的设备本地**，不会离开本机。具体而言：

1. 存储位置：全部数据仅写入 `chrome.storage.local` 与浏览器的 IndexedDB，无任何云端或服务器副本；
2. 身份快照：你主动保存的「身份」包含该网站的 Cookie，以及（若你勾选）当前 origin 的 localStorage；
3. 扩展设置：语言、快捷入口开关、生效范围、悬浮窗位置与大小等；
4. 启动密码：若你启用，仅保存 PBKDF2-SHA256 派生校验值，不保存明文密码；
5. 加密保护：若开启「存储加密」，密钥随机生成且不可导出，保存在本机 IndexedDB；Cookie 快照等价于登录凭证，默认以 AES-256-GCM 加密后存放。

### 各项权限的用途

| 权限 | 用途 |
| --- | --- |
| `cookies` | 读取当前网站的 Cookie 以保存身份；切换身份或清除时写入 / 删除该网站的 Cookie |
| `storage` | 在本地保存身份快照与设置 |
| `scripting` | 在用户选择时读写当前页面的 localStorage、显示切换结果提示、挂载可选的悬浮窗（仅注入扩展自带的脚本） |
| `tabs` | 读取当前标签页地址以判断要操作哪个网站；切换后刷新相关标签页 |
| `contextMenus` | 在你开启后，提供网页右键菜单的快捷切换入口 |
| `unlimitedStorage` | 避免多站点、多身份的快照因配额不足被丢弃 |
| `<all_urls>` | 本扩展需在你自行选择保存 / 恢复登录态的任意网站上工作，目标站点无法预先确定 |

所有这些权限都只为完成「保存与切换网站登录状态」这一单一用途，数据均只在本机处理。

### 数据的共享与出售

**不共享、不出售、不转移。** 本扩展不与任何第三方共享你的数据，也不会将数据用于与上述单一用途无关的目的。

### 数据的删除

- 在扩展的「身份」页面中删除单个身份，或在「设置」中清空全部身份；
- 卸载扩展会一并删除本扩展在本地保存的全部数据。

### 儿童隐私

本扩展不面向儿童，也不会有意收集儿童的任何信息（事实上不收集任何人的信息）。

### 政策变更

如本政策发生变更，我们会更新本文件顶部的「最后更新」日期。重大变更将在仓库中说明。

### 联系方式

如有任何疑问，请通过以下方式联系：

- 提交 GitHub Issue：<https://github.com/elysiawen/Cookie-Switcher/issues>
- 邮箱：`<在此填写你的联系邮箱>`

---

## English

### Overview

Cookie Switcher (the "Extension") lets a user save the current login state (cookies, and optionally localStorage) of a website as a named "identity", and switch back to a saved identity on that same website with one click. **The Extension runs entirely on your device. It does not collect, store, or transmit any user data to any server.**

### What data we collect

**None.** The Extension does not collect or transmit any personal information or usage data. Specifically:

1. No personally identifiable information of any kind (name, email, account, device identifiers, etc.);
2. No analytics, telemetry, or crash reporting, and no recording of your browsing behavior;
3. No advertising and no third-party SDKs;
4. No network requests of any kind (no `fetch` / `XMLHttpRequest` / `WebSocket`);
5. No remote code — all scripts are bundled inside the Extension package.

### How data is stored

The following data is stored **only on your own device** and never leaves it. Specifically:

1. Storage location: all data is written solely to `chrome.storage.local` and the browser's IndexedDB, with no cloud or server copy;
2. Identities: an identity you choose to save contains the site's cookies and, if you opt in, the localStorage of the current origin;
3. Extension settings: language, quick-access toggles, scope, floating-panel position and size, etc.;
4. Startup password: if enabled, only a PBKDF2-SHA256 derived verification value is stored — never the plaintext password;
5. Encryption: if storage encryption is on, the key is randomly generated and non-extractable and kept in the local IndexedDB; cookie snapshots are equivalent to login credentials and are stored encrypted with AES-256-GCM by default.

### What each permission is used for

| Permission | Purpose |
| --- | --- |
| `cookies` | Read the current site's cookies to save an identity; write/clear that site's cookies when switching or clearing |
| `storage` | Store identity snapshots and settings locally |
| `scripting` | When you opt in, read/write the current page's localStorage, show the switch-result banner, and mount the optional floating panel (only the Extension's own packaged scripts are injected) |
| `tabs` | Read the current tab's URL to know which site to operate on; reload the affected tab(s) after switching |
| `contextMenus` | Provide an optional right-click menu shortcut once you enable it |
| `unlimitedStorage` | Prevent snapshots for many sites/identities from being dropped due to quota limits |
| `<all_urls>` | The Extension must work on whichever website you choose to save or restore a login state on; the target site is not known in advance |

All of these permissions serve the single purpose of saving and switching per-site login states, and all data is handled locally on your device.

### Data sharing and selling

**We do not share, sell, or transfer any data.** The Extension does not share your data with any third party and does not use it for any purpose unrelated to the single purpose described above.

### Data deletion

- Delete individual identities on the "Identities" page, or clear all identities in "Settings";
- Uninstalling the Extension deletes all data it stored locally.

### Children's privacy

The Extension is not directed to children and does not knowingly collect any information from anyone (in fact, it collects no information at all).

### Changes to this policy

If this policy changes, we will update the "Last updated" date at the top of this document. Material changes will be noted in the repository.

### Contact

If you have any questions, please reach out:

- Open a GitHub Issue: <https://github.com/elysiawen/Cookie-Switcher/issues>
- Email: `<your contact email here>`
