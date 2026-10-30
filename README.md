# Cookie Switcher

把某个网站当前的登录状态（Cookie，可选 localStorage）保存成一个「身份」，之后随时一键切回。

基于 Manifest V3 的 Chrome 浏览器扩展，内置本地加密存储与可选启动密码。

## 功能特性

- **一键切换身份**：保存当前登录态为「身份」，换号时点一下即可切换并自动刷新页面。
- **Cookie 范围可选**：
  - `含子域`：包含 `*.example.com` 下全部子域，切换更彻底。
  - `仅此域名`：只处理当前主机名自身的 Cookie，不触碰上级域（如 `.example.com`）。
- **localStorage 快照**：可选一并保存/还原页面的 localStorage（按 origin 隔离，仅 origin 一致时写入）。
- **三条操作入口**（后两者默认关闭，可在设置中开启）：
  - 工具栏弹窗（Popup）
  - 页面右键菜单
  - 网页内可拖动的悬浮窗
- **本地加密存储**：Cookie 默认以 AES-256-GCM 加密后存放，密钥随机生成且不可导出（non-extractable），持久化在 IndexedDB 中，扩展存储目录里不存在明文登录凭证。
- **启动密码（可选）**：仅用于锁定界面，与数据加密相互独立。使用 PBKDF2-SHA256 校验，解锁状态只存于内存，浏览器重启后失效，并带连续失败冷却。
- **导入 / 导出**：支持导出为 JSON、导入时按字段清洗校验（校验域名归属、限制条数与体积）。
- **清除本站 Cookie**：相当于在当前网页登出，已保存的身份不受影响。
- **国际化**：内置简体中文与英文界面，可跟随浏览器语言。
- **快捷入口生效范围**：支持「全部 / 仅白名单 / 排除黑名单」，域名规则自动包含子域。

## 技术栈

- TypeScript 5
- React 18 + React DOM
- Vite 6（扩展页面与 service worker 用主构建，content script 用独立 IIFE 构建）
- Chrome Extension Manifest V3
- 无第三方运行时依赖（打包脚本为纯 Node 实现）

## 目录结构

```
src/
  background/    service worker：消息处理、Cookie 读写、加密、锁定、快捷入口
    index.ts       消息路由与核心业务逻辑
    cookies.ts     Cookie 采集 / 写入 / 清除（含 CHIPS 分区、__Host- 前缀处理）
    crypto.ts      AES-GCM 加解密，密钥存放于 IndexedDB
    storage.ts     身份与设置的持久化、读写串行化
    lock.ts        可选启动密码（PBKDF2）
    quickAccess.ts 右键菜单与页面悬浮窗的注册 / 重建
    inject.ts      localStorage 读写（通过 scripting 注入）
    notice.ts      页面顶部结果横幅
  content/       页面悬浮窗（IIFE content script）
  popup/         工具栏弹窗
  options/       管理页（身份列表、设置、关于）
  shared/        共享类型、域名工具、快捷入口范围、消息协议、i18n
public/
  manifest.json  扩展清单
  _locales/      扩展名称与描述的本地化
  icons/         图标
scripts/
  dev.mjs        开发期 watch 构建
  make-icons.mjs 生成图标
  pack.mjs       打包 zip / crx（CRX3 签名）
```

## 开发

要求 Node.js ≥ 18。

```bash
npm install      # 安装依赖
npm run dev      # 同时 watch 主构建与 content script 构建
```

在浏览器中打开 `chrome://extensions`，开启「开发者模式」，选择「加载已解压的扩展程序」，指向项目根目录下的 `dist/` 目录。修改源码后 `dist/` 会自动更新，在扩展页点击刷新即可生效。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发期 watch 构建（输出到 `dist/`） |
| `npm run build` | 类型检查 + 生成图标 + 完整构建 |
| `npm run typecheck` | 仅做 TypeScript 类型检查 |
| `npm run icons` | 由 `logo.png` 生成各尺寸图标 |
| `npm run pack` | 构建并打包为 zip 与 crx |
| `npm run pack:zip` | 仅打包 zip（商店上传 / 分发） |
| `npm run pack:crx` | 仅打包 crx（本地安装） |

打包产物位于 `release/`。crx 签名私钥首次运行自动生成于 `.keys/crx.pem`，请妥善备份且勿提交（已在 `.gitignore` 中忽略）。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `cookies` | 读取 / 写入 / 清除站点 Cookie |
| `storage` | 保存身份与设置（`unlimitedStorage` 提供更大配额） |
| `scripting` | 注入脚本以读写 localStorage、显示结果横幅、挂载悬浮窗 |
| `tabs` | 获取当前标签页信息、切换后刷新页面 |
| `contextMenus` | 提供页面右键菜单快捷入口 |
| `<all_urls>` | 在任意站点执行上述操作 |

## 设计与安全说明

- **数据只存本机**，不会上传；卸载扩展会一并删除。
- 切换身份会**先清空该站点范围内的 Cookie 再写入快照**，不会保留切换前的状态。
- 界面会明确提示当前存储是否已加密（`本地已加密` / `本地未加密`）。
- 导入的数据会逐字段重建，拒绝越界域名与超限内容，避免被注入非目标站点的 Cookie。
- 「忘记密码」只能通过**丢弃全部已保存身份**来重置锁定。

> 保存的 Cookie 等价于登录凭证。建议保持加密存储开启，导出文件请妥善保管，不要在共用电脑上使用。

## 使用示例

1. 打开目标网站并登录到你想保存的账号。
2. 点击工具栏图标，填写名称（如「工作号」）与 Cookie 范围，选择「保存当前身份」。
3. 换号时在同一网站打开图标，点击对应身份即可一键切换；若开启了「切换后自动刷新页面」，页面会自动刷新。
