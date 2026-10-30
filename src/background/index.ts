import {
  cookieInScope,
  hostnameFromUrl as hostnameOf,
  normalizeHostname,
  originFromUrl,
  profileCoversHostname,
  resolveSiteKey,
  siteKeyFromHostname,
  stripLeadingDot,
} from '@/shared/domain';
import { resolveCurrentLocale, setRuntimeLocale, t } from '@/shared/i18n';
import { LOCKED_ERROR, type Request } from '@/shared/messages';
import {
  PANEL_POS_KEY,
  type ActiveContext,
  type CookieRecord,
  type ExportBundle,
  type LockState,
  type PanelState,
  type PopupState,
  type Profile,
  type SaveResult,
  type Scope,
  type StorageSnapshot,
  type SwitchResult,
} from '@/shared/types';
import { applyCookies, clearCookies, collectCookies, countCookies, errorText } from './cookies';
import { clearLocalStorage, readLocalStorage, writeLocalStorage } from './inject';
import {
  getLockState,
  lockNow,
  removePassword,
  resetLock,
  setPassword,
  unlock,
} from './lock';
import { showPageNotice } from './notice';
import { initQuickAccess, refreshContextMenu, refreshPanel, syncQuickAccess } from './quickAccess';
import {
  alignStorageFormat,
  clearAllData,
  loadProfiles,
  loadSettings,
  persistProfiles,
  persistSettings,
  purgeVault,
  withLock,
} from './storage';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** 顶部横幅需要一点停留时间，之后再刷新页面 */
const BEFORE_RELOAD_DELAY = 900;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_PROFILES = 500;
const MAX_COOKIES_PER_PROFILE = 5000;
const MAX_STORAGE_ENTRIES = 5000;

/** 未解锁状态下也允许调用的消息（本身不暴露数据） */
const PUBLIC_REQUESTS: Request['type'][] = [
  'GET_LOCK_STATE',
  'UNLOCK',
  'SET_PASSWORD',
  'REMOVE_PASSWORD',
  'LOCK_NOW',
  'RESET_LOCK',
  'GET_SETTINGS',
  'UPDATE_SETTINGS',
];

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) return tab;
  const focused = await chrome.windows.getLastFocused({ populate: true });
  return focused.tabs?.find((item) => item.active);
}

/**
 * 右键菜单与悬浮窗都明确知道自己来自哪个标签页，
 * 只有 popup 这类没有来源的场景才回退到当前活动标签页。
 */
async function resolveTab(input?: chrome.tabs.Tab): Promise<chrome.tabs.Tab | undefined> {
  if (!input || input.id === undefined) return getActiveTab();
  if (input.url) return input;
  return (await chrome.tabs.get(input.id).catch(() => undefined)) ?? input;
}

async function buildPopupState(): Promise<PopupState> {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url);
  const site = hostname ? siteKeyFromHostname(hostname) : null;
  const all = await loadProfiles();
  const settings = await loadSettings();

  let liveCookieCount = 0;
  if (site) {
    try {
      liveCookieCount = await countCookies(site, 'subdomains');
    } catch {
      liveCookieCount = 0;
    }
  }

  const context: ActiveContext = {
    tabId: tab?.id ?? null,
    url: tab?.url ?? null,
    hostname,
    site,
    origin: originFromUrl(tab?.url),
    liveCookieCount,
    injectable: Boolean(tab?.id) && Boolean(hostname),
  };

  return {
    context,
    profiles: hostname ? all.filter((profile) => profileCoversHostname(profile, hostname)) : [],
    settings,
  };
}

async function buildPanelState(tabInput?: chrome.tabs.Tab): Promise<PanelState> {
  const tab = await resolveTab(tabInput);
  const hostname = hostnameOf(tab?.url);
  const site = hostname ? siteKeyFromHostname(hostname) : null;
  const all = hostname ? await loadProfiles() : [];
  return {
    hostname,
    site,
    profiles: hostname
      ? all
          .filter((profile) => profileCoversHostname(profile, hostname))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      : [],
  };
}

function uniqueName(existing: Profile[], site: string, scope: Scope, name: string): string {
  const siblings = existing.filter((item) => item.site === site && item.scope === scope);
  if (!siblings.some((item) => item.name === name)) return name;
  let index = 2;
  while (siblings.some((item) => item.name === `${name} (${index})`)) index += 1;
  return `${name} (${index})`;
}

async function saveProfile(input: {
  name: string;
  scope: Scope;
  includeStorage: boolean;
}): Promise<SaveResult> {
  const tab = await getActiveTab();
  const hostname = hostnameOf(tab?.url);
  if (!tab?.id || !hostname) {
    throw new Error(t('err.notWebPageSave'));
  }

  const site = resolveSiteKey(hostname, input.scope);
  const cookies = await collectCookies(site, input.scope);
  const errors: string[] = [];
  let storage: Profile['storage'];
  let storageCount = 0;

  const origin = originFromUrl(tab.url);
  if (input.includeStorage) {
    if (!origin) {
      errors.push(t('warn.noOrigin'));
    } else {
      try {
        const snapshot = await readLocalStorage(tab.id);
        storage = { origin, localStorage: snapshot };
        storageCount = Object.keys(snapshot).length;
      } catch (error) {
        errors.push(t('warn.localStorageRead', { error: errorText(error) }));
      }
    }
  }

  const rawName = input.name.trim() || hostname;
  const now = Date.now();

  const profile = await withLock(async () => {
    const list = await loadProfiles();
    const created: Profile = {
      id: newId(),
      name: uniqueName(list, site, input.scope, rawName),
      site,
      scope: input.scope,
      cookies,
      storage,
      createdAt: now,
      updatedAt: now,
    };
    list.unshift(created);
    await persistProfiles(list);
    return created;
  });

  return { ok: true, profile, cookieCount: cookies.length, storageCount, errors };
}

async function reloadTabs(tabId: number, site: string, allSiteTabs: boolean): Promise<void> {
  const targets = new Set<number>([tabId]);
  if (allSiteTabs) {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      const host = hostnameOf(tab.url);
      if (host && (host === site || host.endsWith('.' + site))) targets.add(tab.id);
    }
  }
  await Promise.all(
    [...targets].map((id) => chrome.tabs.reload(id).catch(() => undefined)),
  );
}

async function switchProfile(id: string, tabInput?: chrome.tabs.Tab): Promise<SwitchResult> {
  const profiles = await loadProfiles();
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error(t('err.profileMissing'));

  const tab = await resolveTab(tabInput);
  const hostname = hostnameOf(tab?.url);
  if (!tab?.id || !hostname) {
    throw new Error(t('err.notWebPageSwitch'));
  }
  if (!profileCoversHostname(profile, hostname)) {
    throw new Error(t('err.siteMismatch', { site: profile.site, host: hostname }));
  }

  const cleared = await clearCookies(profile.site, profile.scope);
  const applied = await applyCookies(profile.cookies);

  const warnings: string[] = [];
  // 精确模式下上级域的 Cookie 不会被清理，可能仍把用户留在旧登录态
  if (profile.scope === 'exact') {
    const parent = siteKeyFromHostname(profile.site);
    if (parent && parent !== profile.site) {
      const inherited = (await chrome.cookies.getAll({ domain: parent })).filter(
        (cookie) => stripLeadingDot(cookie.domain) === parent,
      );
      if (inherited.length > 0) {
        warnings.push(t('warn.parentCookies', { parent, count: inherited.length }));
      }
    }
  }

  let storageWritten = false;
  let storageNote: string | undefined;

  if (profile.storage) {
    const origin = originFromUrl(tab.url);
    if (origin === profile.storage.origin) {
      try {
        await writeLocalStorage(tab.id, profile.storage.localStorage);
        storageWritten = true;
      } catch (error) {
        storageNote = t('warn.localStorageWrite', { error: errorText(error) });
      }
    } else {
      storageNote = t('warn.storageOrigin', {
        origin: profile.storage.origin,
        current: origin ?? '-',
      });
    }
  }

  const errors = [...cleared.errors, ...applied.errors];
  const settings = await loadSettings();

  // 页面顶部横幅：让弹窗 / 右键菜单 / 悬浮窗三条入口都有同一个结果反馈
  await showPageNotice(
    tab.id,
    errors.length > 0
      ? { kind: 'error', text: t('banner.failed', { error: errors[0] }) }
      : {
          kind: 'ok',
          text: settings.reloadAfterSwitch
            ? t('banner.switchedReloading', { name: profile.name })
            : t('banner.switchedManual', { name: profile.name }),
        },
  );

  if (settings.reloadAfterSwitch) {
    // 留一点时间让横幅被看到，再刷新页面
    setTimeout(() => {
      void reloadTabs(tab.id as number, profile.site, settings.reloadAllSiteTabs);
    }, BEFORE_RELOAD_DELAY);
  }

  return {
    ok: errors.length === 0,
    profileName: profile.name,
    cleared: cleared.cleared,
    written: applied.written,
    skippedExpired: applied.skippedExpired,
    storageWritten,
    storageNote,
    warnings,
    errors: errors.slice(0, 12),
  };
}

/** 右键菜单 / 悬浮窗没有 popup 那样的结果面板，用图标角标给出即时反馈 */
async function flashBadge(tabId: number | undefined, text: string): Promise<void> {
  if (typeof tabId !== 'number') return;
  try {
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: text === '!' ? '#dc2626' : '#16a34a',
    });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => {
      void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    }, 2500);
  } catch {
    // 标签页已关闭等情况无需处理
  }
}

async function switchFromMenu(profileId: string, tab: chrome.tabs.Tab): Promise<void> {
  setRuntimeLocale(await resolveCurrentLocale());
  const lock = await getLockState();
  if (lock.enabled && !lock.unlocked) {
    await showPageNotice(tab.id, { kind: 'error', text: t('banner.locked') });
    await flashBadge(tab.id, '!');
    return;
  }
  try {
    const result = await switchProfile(profileId, tab);
    await flashBadge(tab.id, result.ok ? '✓' : '!');
  } catch (error) {
    await showPageNotice(tab.id, {
      kind: 'error',
      text: t('banner.failed', { error: errorText(error) }),
    });
    await flashBadge(tab.id, '!');
  }
}

async function deleteProfile(id: string): Promise<{ id: string }> {
  await withLock(async () => {
    const list = await loadProfiles();
    await persistProfiles(list.filter((item) => item.id !== id));
  });
  return { id };
}

/** 批量删除（按站点清空时用），一次读写完成 */
async function deleteProfiles(ids: string[]): Promise<{ deleted: number }> {
  const remove = new Set(ids);
  if (remove.size === 0) return { deleted: 0 };

  return withLock(async () => {
    const list = await loadProfiles();
    const kept = list.filter((item) => !remove.has(item.id));
    const deleted = list.length - kept.length;
    if (deleted > 0) await persistProfiles(kept);
    return { deleted };
  });
}

async function renameProfile(id: string, name: string): Promise<Profile> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(t('err.emptyName'));
  return withLock(async () => {
    const list = await loadProfiles();
    const target = list.find((item) => item.id === id);
    if (!target) throw new Error(t('err.profileNotFound'));
    target.name = trimmed;
    target.updatedAt = Date.now();
    await persistProfiles(list);
    return target;
  });
}

function readBundle(raw: string): unknown[] {
  if (raw.length > MAX_IMPORT_BYTES) throw new Error(t('err.importTooLarge'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t('err.invalidJson'));
  }
  const container = parsed as { profiles?: unknown } | unknown[];
  const list = Array.isArray(container) ? container : container?.profiles;
  if (!Array.isArray(list)) throw new Error(t('err.invalidBundle'));
  return list;
}

/**
 * 逐字段重建 cookie，而不是直接信任导入内容：
 * 既避免字段类型异常导致后续写入崩溃，也防止被塞进属于其他域的 cookie。
 */
function sanitizeCookies(raw: unknown, site: string, scope: Scope): CookieRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CookieRecord[] = [];

  for (const item of raw.slice(0, MAX_COOKIES_PER_PROFILE)) {
    if (!item || typeof item !== 'object') continue;
    const cookie = item as Partial<CookieRecord>;
    if (typeof cookie.name !== 'string' || !cookie.name) continue;
    if (typeof cookie.value !== 'string') continue;
    if (typeof cookie.domain !== 'string' || !cookie.domain) continue;
    if (!cookieInScope(cookie.domain, site, scope)) continue;

    let sameSite: CookieRecord['sameSite'] = 'unspecified';
    if (
      cookie.sameSite === 'lax' ||
      cookie.sameSite === 'strict' ||
      cookie.sameSite === 'no_restriction'
    ) {
      sameSite = cookie.sameSite;
    }

    out.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/',
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite,
      session: cookie.session !== false,
      expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : undefined,
      storeId: typeof cookie.storeId === 'string' ? cookie.storeId : undefined,
      partitionKey:
        cookie.partitionKey && typeof cookie.partitionKey.topLevelSite === 'string'
          ? { topLevelSite: cookie.partitionKey.topLevelSite }
          : undefined,
    });
  }
  return out;
}

function sanitizeStorage(raw: unknown): StorageSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const snapshot = raw as Partial<StorageSnapshot>;
  if (typeof snapshot.origin !== 'string' || !snapshot.origin.startsWith('http')) return undefined;
  if (!snapshot.localStorage || typeof snapshot.localStorage !== 'object') return undefined;

  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(snapshot.localStorage)) {
    if (count >= MAX_STORAGE_ENTRIES) break;
    if (typeof value !== 'string') continue;
    out[key] = value;
    count += 1;
  }
  return { origin: snapshot.origin, localStorage: out };
}

function sanitizeProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Profile>;
  if (typeof raw.site !== 'string' || !raw.site) return null;

  const site = normalizeHostname(raw.site);
  // 站点过短或没有点会被放大到公共后缀级别，直接拒绝
  if (site !== 'localhost' && (site.length < 3 || !site.includes('.'))) return null;
  if (!Array.isArray(raw.cookies)) return null;

  const scope: Scope = raw.scope === 'exact' ? 'exact' : 'subdomains';
  const cookies = sanitizeCookies(raw.cookies, site, scope);
  if (cookies.length === 0) return null;

  const now = Date.now();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 120) : site,
    site,
    scope,
    cookies,
    storage: sanitizeStorage(raw.storage),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: now,
  };
}

async function importData(
  payload: string,
  mode: 'merge' | 'replace',
): Promise<{ imported: number; total: number }> {
  const bundle = readBundle(payload);
  if (bundle.length > MAX_IMPORT_PROFILES) {
    throw new Error(t('err.tooManyProfiles', { count: MAX_IMPORT_PROFILES }));
  }
  const incoming = bundle
    .map(sanitizeProfile)
    .filter((item): item is Profile => item !== null);
  if (incoming.length === 0) throw new Error(t('err.noProfiles'));

  return withLock(async () => {
    const current = await loadProfiles();
    if (mode === 'replace') {
      await persistProfiles(incoming);
      return { imported: incoming.length, total: incoming.length };
    }
    const byId = new Map(current.map((item) => [item.id, item]));
    let imported = 0;
    for (const profile of incoming) {
      const duplicate = byId.get(profile.id);
      if (duplicate) {
        profile.id = newId();
        profile.name = uniqueName([...byId.values()], profile.site, profile.scope, profile.name);
      }
      byId.set(profile.id, profile);
      imported += 1;
    }
    const merged = [...byId.values()];
    await persistProfiles(merged);
    return { imported, total: merged.length };
  });
}

async function handle(
  request: Request,
  sender?: chrome.runtime.MessageSender,
): Promise<ApiResult<unknown>> {
  setRuntimeLocale(await resolveCurrentLocale());
  const lock = await getLockState();
  if (lock.enabled && !lock.unlocked && !PUBLIC_REQUESTS.includes(request.type)) {
    return { ok: false, error: LOCKED_ERROR };
  }

  switch (request.type) {
    case 'GET_POPUP_STATE':
      return { ok: true, data: await buildPopupState() };

    case 'GET_PANEL_STATE':
      return { ok: true, data: await buildPanelState(sender?.tab) };

    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true, data: { opened: true } };

    case 'SAVE_PROFILE':
      return { ok: true, data: await saveProfile(request) };

    case 'SWITCH_PROFILE': {
      try {
        return { ok: true, data: await switchProfile(request.id, sender?.tab) };
      } catch (error) {
        // 失败时也把原因显示在页面上，而不是只在弹窗里提示
        const target = await resolveTab(sender?.tab);
        await showPageNotice(target?.id, {
          kind: 'error',
          text: t('banner.failed', { error: errorText(error) }),
        });
        throw error;
      }
    }

    case 'DELETE_PROFILE':
      return { ok: true, data: await deleteProfile(request.id) };

    case 'DELETE_PROFILES':
      return { ok: true, data: await deleteProfiles(request.ids) };

    case 'RENAME_PROFILE':
      return { ok: true, data: await renameProfile(request.id, request.name) };

    case 'GET_ALL_PROFILES': {
      const list = await loadProfiles();
      return { ok: true, data: [...list].sort((a, b) => b.updatedAt - a.updatedAt) };
    }

    case 'EXPORT_DATA': {
      const bundle: ExportBundle = {
        app: 'cookie-profile-switcher',
        version: 1,
        exportedAt: Date.now(),
        profiles: await loadProfiles(),
      };
      return { ok: true, data: bundle };
    }

    case 'IMPORT_DATA':
      return { ok: true, data: await importData(request.payload, request.mode) };

    case 'CLEAR_ALL':
      return { ok: true, data: { cleared: await withLock(clearAllData) } };

    case 'CLEAR_SITE_COOKIES': {
      // 相当于「在当前网页登出」：只清浏览器里的 cookie，不动已保存的身份
      const tab = await getActiveTab();
      const hostname = hostnameOf(tab?.url);
      const site = hostname ? siteKeyFromHostname(hostname) : null;
      const tabId = tab?.id;
      if (typeof tabId !== 'number' || !site) {
        return { ok: false, error: t('err.notWebPageClear') };
      }

      const outcome = await clearCookies(site, 'subdomains');
      const errors = [...outcome.errors];
      let storageCleared = 0;

      if (request.includeStorage) {
        try {
          storageCleared = await clearLocalStorage(tabId);
        } catch (error) {
          // 某些页面禁止注入，清不掉 localStorage 不应该让整个操作失败
          errors.push(t('warn.localStorageClear', { error: errorText(error) }));
        }
      }

      const settings = await loadSettings();
      const reloading = settings.reloadAfterSwitch;

      await showPageNotice(
        tabId,
        errors.length > 0
          ? { kind: 'error', text: t('banner.failed', { error: errors[0] }) }
          : {
              kind: 'ok',
              text: reloading
                ? t('banner.clearedReloading', { count: outcome.cleared })
                : t('banner.clearedManual', { count: outcome.cleared }),
            },
      );

      if (reloading) {
        setTimeout(() => {
          void reloadTabs(tabId, site, settings.reloadAllSiteTabs);
        }, BEFORE_RELOAD_DELAY);
      }

      return {
        ok: true,
        data: { cleared: outcome.cleared, storageCleared, errors, reloading },
      };
    }

    case 'GET_SETTINGS':
      return { ok: true, data: await loadSettings() };

    case 'UPDATE_SETTINGS': {
      const settings = await withLock(async () => {
        const next = await persistSettings(request.patch);
        // 加密开关变化时立刻把现有数据转成对应格式，避免读到旧格式后再写造成覆盖
        if (request.patch.encryptStorage !== undefined) {
          await alignStorageFormat();
        }
        return next;
      });
      // 悬浮窗位置改变时清掉手动拖动记录，让已打开的页面回到所选角落
      if (request.patch.panelCorner !== undefined) {
        await chrome.storage.local.remove(PANEL_POS_KEY).catch(() => undefined);
      }
      // 入口开关、站点范围与语言变化都需要立刻重建菜单 / 重新校准悬浮窗
      if (
        request.patch.contextMenuEnabled !== undefined ||
        request.patch.floatingPanelEnabled !== undefined ||
        request.patch.quickAccessScope !== undefined ||
        request.patch.quickAccessSites !== undefined ||
        request.patch.locale !== undefined
      ) {
        // 设置已经落盘，入口同步失败不应该让保存操作报错
        await syncQuickAccess().catch(() => undefined);
      }
      return { ok: true, data: settings };
    }

    case 'GET_LOCK_STATE':
      return { ok: true, data: await getLockState() };

    case 'UNLOCK':
      return { ok: true, data: await unlock(request.password) };

    case 'SET_PASSWORD':
      return { ok: true, data: await setPassword(request.password, request.currentPassword) };

    case 'REMOVE_PASSWORD':
      return { ok: true, data: await removePassword(request.password) };

    case 'LOCK_NOW':
      return { ok: true, data: await lockNow() };

    case 'RESET_LOCK': {
      // 忘记密码的唯一出路：丢弃密文数据，再解除锁定
      await withLock(purgeVault);
      await resetLock();
      const cleared: LockState = { enabled: false, unlocked: true };
      return { ok: true, data: cleared };
    }

    default: {
      const exhaustive: never = request;
      throw new Error(t('err.unknownMessage', { type: JSON.stringify(exhaustive) }));
    }
  }
}

/** 这些操作会改变右键菜单的内容或可用状态，成功后需要重建 */
const MENU_AFFECTING: Request['type'][] = [
  'SAVE_PROFILE',
  'DELETE_PROFILE',
  'RENAME_PROFILE',
  'IMPORT_DATA',
  'CLEAR_ALL',
  'UNLOCK',
  'LOCK_NOW',
  'SET_PASSWORD',
  'REMOVE_PASSWORD',
  'RESET_LOCK',
];

initQuickAccess(switchFromMenu);

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  handle(message, sender)
    .then((result) => {
      sendResponse(result);
      if (result.ok && MENU_AFFECTING.includes(message.type)) {
        void refreshContextMenu().catch(() => undefined);
        void refreshPanel().catch(() => undefined);
      }
    })
    .catch((error: unknown) => sendResponse({ ok: false, error: errorText(error) }));
  // 保持消息通道打开以支持异步 sendResponse
  return true;
});

// 安装、更新或浏览器启动时，把存储格式对齐到当前设置：
// 避免旧版本遗留的明文数据一直不被转换。
chrome.runtime.onInstalled.addListener(() => {
  void withLock(alignStorageFormat).catch(() => undefined);
  void syncQuickAccess().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void withLock(alignStorageFormat).catch(() => undefined);
  void syncQuickAccess().catch(() => undefined);
});
