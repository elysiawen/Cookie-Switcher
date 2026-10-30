/**
 * 两个可选入口：页面右键菜单与页面悬浮窗。
 * 两者都由设置控制，关闭时不只是隐藏 UI：菜单会被真正移除，脚本会被注销并清理。
 *
 * 关于右键菜单的填充时机：菜单内容取决于「当前是哪个站点」。
 * contextMenus.onShown / onHidden / refresh 并非所有 Chromium 内核版本都提供，
 * 在顶层对不存在的成员调用 addListener 会让 service worker 直接启动失败，
 * 因此这里不使用它们，改为在标签页切换、窗口切换、页面加载完成以及数据变更时重建菜单，
 * 这些时机都发生在右键菜单弹出之前。
 */

import { hostnameFromUrl, profileCoversHostname } from '@/shared/domain';
import { resolveCurrentLocale, setRuntimeLocale, t } from '@/shared/i18n';
import type { Profile } from '@/shared/types';
import { getLockState } from './lock';
import { loadProfiles, loadSettings } from './storage';

const ROOT_MENU_ID = 'cps-switch-root';
const ITEM_PREFIX = 'cps-switch:profile:';
/** 子菜单过多会很难用，超出部分引导到管理页 */
const MAX_MENU_ITEMS = 15;
/** 页面可能在短时间内连续触发多个事件，合并成一次重建 */
const REBUILD_DELAY = 120;

const PANEL_SCRIPT_ID = 'cps-floating-panel';
const PANEL_SCRIPT_FILE = 'content-panel.js';
const PANEL_HOST_ID = 'cps-panel-root';

const PAGE_MATCHES = ['http://*/*', 'https://*/*'];

export type MenuSwitchHandler = (profileId: string, tab: chrome.tabs.Tab) => Promise<void>;

let childIds: string[] = [];
let queue: Promise<unknown> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function createMenu(props: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      // 重复 id 之类的错误只影响这一项，读取 lastError 避免控制台噪音
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function removeAllMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function currentHostname(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) return hostnameFromUrl(tab.url);
    const focused = await chrome.windows.getLastFocused({ populate: true });
    return hostnameFromUrl(focused.tabs?.find((item) => item.active)?.url);
  } catch {
    return null;
  }
}

function matchProfiles(profiles: Profile[], hostname: string): Profile[] {
  return profiles
    .filter((profile) => profileCoversHostname(profile, hostname))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 按设置与当前页面重建菜单；关闭设置时只有「移除」这一步 */
async function rebuildMenu(hostOverride?: string | null): Promise<void> {
  const settings = await loadSettings();
  setRuntimeLocale(await resolveCurrentLocale());

  childIds = [];
  await removeAllMenus();
  if (!settings.contextMenuEnabled) return;

  const hostname = hostOverride === undefined ? await currentHostname() : hostOverride;

  await createMenu({
    id: ROOT_MENU_ID,
    title: t('menu.root'),
    contexts: ['page'],
    // 扩展无法在 chrome:// 等页面操作 Cookie，这些页面不显示菜单
    documentUrlPatterns: PAGE_MATCHES,
  });

  const lock = await getLockState();
  const locked = lock.enabled && !lock.unlocked;
  const profiles = locked || !hostname ? [] : matchProfiles(await loadProfiles(), hostname);

  const items: chrome.contextMenus.CreateProperties[] = [];
  if (locked) {
    items.push({ id: `${ITEM_PREFIX}locked`, title: t('menu.locked'), enabled: false });
  } else if (profiles.length === 0) {
    items.push({ id: `${ITEM_PREFIX}empty`, title: t('menu.empty'), enabled: false });
  } else {
    for (const profile of profiles.slice(0, MAX_MENU_ITEMS)) {
      items.push({ id: ITEM_PREFIX + profile.id, title: profile.name });
    }
  }

  for (const item of items) {
    await createMenu({ ...item, parentId: ROOT_MENU_ID });
    if (typeof item.id === 'string') childIds.push(item.id);
  }
}

async function injectPanel(tabId: number): Promise<void> {
  await chrome.scripting
    .executeScript({ target: { tabId }, files: [PANEL_SCRIPT_FILE] })
    .catch(() => undefined);
}

async function removePanel(tabId: number): Promise<void> {
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: (hostId: string) => {
        const host = document.getElementById(hostId);
        if (host) host.remove();
      },
      args: [PANEL_HOST_ID],
    })
    .catch(() => undefined);
}

/** 让已打开的页面立刻获得 / 失去悬浮窗，未打开的页面由注册状态决定 */
async function applyPanelToOpenTabs(enabled: boolean): Promise<void> {
  const tabs = await chrome.tabs.query({ url: PAGE_MATCHES });
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === 'number')
      .map((tab) => (enabled ? injectPanel(tab.id as number) : removePanel(tab.id as number))),
  );
}

/** 按设置注册 / 注销悬浮窗脚本，变更即时生效 */
async function syncPanelRegistration(): Promise<void> {
  const settings = await loadSettings();
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [PANEL_SCRIPT_ID],
  });
  const isOn = registered.some((script) => script.id === PANEL_SCRIPT_ID);

  if (settings.floatingPanelEnabled && !isOn) {
    await chrome.scripting.registerContentScripts([
      {
        id: PANEL_SCRIPT_ID,
        matches: PAGE_MATCHES,
        js: [PANEL_SCRIPT_FILE],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    await applyPanelToOpenTabs(true);
    return;
  }

  if (!settings.floatingPanelEnabled && isOn) {
    await chrome.scripting.unregisterContentScripts({ ids: [PANEL_SCRIPT_ID] });
    await applyPanelToOpenTabs(false);
  }
}

/** 只重建菜单，用于标签页切换、数据变更等高频场景 */
export function refreshContextMenu(hostOverride?: string | null): Promise<void> {
  return enqueue(async () => {
    await rebuildMenu(hostOverride);
  });
}

/** 安装、启动、设置变更时把两个入口同步到最新状态 */
export function syncQuickAccess(): Promise<void> {
  return enqueue(async () => {
    await rebuildMenu();
    await syncPanelRegistration();
  });
}

/**
 * 顶层注册事件时，只要有一个 API 在某个 Chromium 分支上缺失，
 * 整个 service worker 都会启动失败（Status code 15），
 * 所以这里逐条兜住：缺哪个就只是少一个刷新时机，不影响扩展其余功能。
 */
function safeRegister(register: () => void): void {
  try {
    register();
  } catch {
    // 该事件在当前内核不可用，忽略
  }
}

export function initQuickAccess(onSwitch: MenuSwitchHandler): void {
  safeRegister(() => {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      const id = String(info.menuItemId);
      if (!tab || !id.startsWith(ITEM_PREFIX)) return;
      const profileId = id.slice(ITEM_PREFIX.length);
      if (!profileId || profileId === 'empty' || profileId === 'locked') return;
      void onSwitch(profileId, tab);
    });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refreshContextMenu().catch(() => undefined);
    }, REBUILD_DELAY);
  };

  safeRegister(() => chrome.tabs.onActivated.addListener(() => schedule()));
  safeRegister(() => chrome.windows.onFocusChanged.addListener(() => schedule()));
  safeRegister(() =>
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete' || !tab.active) return;
      schedule();
    }),
  );
}
