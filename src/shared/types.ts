import type { LocalePreference } from './i18n';

export type Scope = 'exact' | 'subdomains';

/** CHIPS 分区 cookie 的归属信息 */
export interface CookiePartitionKey {
  topLevelSite: string;
  hasCrossSiteAncestor?: boolean;
}

export interface CookieRecord {
  name: string;
  value: string;
  /** cookie 原始 domain，域 cookie 带前导点 */
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: chrome.cookies.SameSiteStatus;
  /** 无 expirationDate 的会话 cookie */
  session: boolean;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
}

export interface StorageSnapshot {
  /** localStorage 是 origin 级隔离，记录来源以便切换时校验 */
  origin: string;
  localStorage: Record<string, string>;
}

export interface Profile {
  id: string;
  name: string;
  /** exact 时是完整 hostname，subdomains 时是注册主域 */
  site: string;
  scope: Scope;
  cookies: CookieRecord[];
  storage?: StorageSnapshot;
  createdAt: number;
  updatedAt: number;
}

export interface LockState {
  /** 是否设置了启动密码 */
  enabled: boolean;
  /** 当前会话是否已解锁 */
  unlocked: boolean;
}

/** 快捷入口（右键菜单 / 悬浮窗）的生效范围 */
export type QuickAccessScope = 'all' | 'whitelist' | 'blacklist';



export interface Settings {
  /** 切换后自动刷新标签页 */
  reloadAfterSwitch: boolean;
  /** 同时刷新该站点下其他标签页 */
  reloadAllSiteTabs: boolean;
  /** 是否加密存储 Profile（默认开启） */
  encryptStorage: boolean;
  /** 界面语言偏好 */
  locale: LocalePreference;
  /** 页面右键菜单里的快捷切换入口（默认关闭） */
  contextMenuEnabled: boolean;
  /** 网页内的悬浮窗快捷入口（默认关闭） */
  floatingPanelEnabled: boolean;
  /** 快捷入口的生效范围 */
  quickAccessScope: QuickAccessScope;
  /** 范围规则里用到的域名，一行一个；子域自动包含 */
  quickAccessSites: string[];
  /** 页面悬浮窗缩放百分比（50-150，100 为标准尺寸） */
  panelScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  reloadAfterSwitch: true,
  reloadAllSiteTabs: false,
  encryptStorage: true,
  locale: 'auto',
  contextMenuEnabled: false,
  floatingPanelEnabled: false,
  quickAccessScope: 'all',
  quickAccessSites: [],
  panelScale: 100,
};

export interface ActiveContext {
  tabId: number | null;
  url: string | null;
  hostname: string | null;
  /** 注册主域，如 www.a.com -> a.com */
  site: string | null;
  origin: string | null;
  /** 当前站点现有 cookie 数，用于对比提示 */
  liveCookieCount: number;
  injectable: boolean;
}

export interface PopupState {
  context: ActiveContext;
  /** 与当前站点匹配的 Profile */
  profiles: Profile[];
  settings: Settings;
}

/** 页面悬浮窗通过 content script 拉取的最小数据 */
export interface PanelState {
  hostname: string | null;
  site: string | null;
  profiles: Profile[];
}

export interface SwitchResult {
  ok: boolean;
  profileName: string;
  cleared: number;
  written: number;
  skippedExpired: number;
  /** localStorage 是否写入 */
  storageWritten: boolean;
  storageNote?: string;
  /** 非致命但需要提醒用户的情况 */
  warnings: string[];
  errors: string[];
}

/** 清除当前站点 cookie（相当于在当前网页登出，已保存的身份不受影响） */
export interface ClearSiteResult {
  cleared: number;
  /** 一并清掉的 localStorage 条目数 */
  storageCleared: number;
  errors: string[];
  /** 是否已安排自动刷新页面 */
  reloading: boolean;
}

export interface SaveResult {
  ok: boolean;
  profile?: Profile;
  cookieCount: number;
  storageCount: number;
  errors: string[];
}

export interface ExportBundle {
  app: 'cookie-profile-switcher';
  version: 1;
  exportedAt: number;
  profiles: Profile[];
}
