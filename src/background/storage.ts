import { t } from '@/shared/i18n';
import {
  DEFAULT_SETTINGS,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  type Profile,
  type Settings,
} from '@/shared/types';
import { seal, unseal, type SealedPayload } from './crypto';

const VAULT_KEY = 'cps:vault';
const LEGACY_PROFILES_KEY = 'cps:profiles';
const SETTINGS_KEY = 'cps:settings';
/** 「站点 → 当前生效身份 id」，只放进会话存储：浏览器重启即丢弃，不残留隐私数据 */
const ACTIVE_KEY = 'cps:active';

/** 串行化所有写操作，避免多个消息交错导致覆盖 */
let queue: Promise<unknown> = Promise.resolve();

export function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** 按指定模式落盘，并清掉另一种模式的残留，保证同一时刻只有一种格式 */
async function writeProfiles(profiles: Profile[], encrypted: boolean): Promise<void> {
  if (encrypted) {
    const sealed = await seal(profiles);
    await chrome.storage.local.set({ [VAULT_KEY]: sealed });
    await chrome.storage.local.remove(LEGACY_PROFILES_KEY);
    return;
  }
  await chrome.storage.local.set({ [LEGACY_PROFILES_KEY]: profiles });
  await chrome.storage.local.remove(VAULT_KEY);
}

/** 纯读，不产生任何写副作用，可安全地在任意位置调用 */
async function readStored(): Promise<{ list: Profile[]; storedEncrypted: boolean }> {
  const raw = await chrome.storage.local.get([VAULT_KEY, LEGACY_PROFILES_KEY]);
  const sealed = raw[VAULT_KEY] as SealedPayload | undefined;
  const legacy = raw[LEGACY_PROFILES_KEY];

  if (sealed) {
    try {
      const value = await unseal<unknown>(sealed);
      return {
        list: Array.isArray(value) ? (value as Profile[]) : [],
        storedEncrypted: true,
      };
    } catch {
      throw new Error(t('err.decryptFailed'));
    }
  }
  if (Array.isArray(legacy)) {
    return { list: legacy as Profile[], storedEncrypted: false };
  }
  return { list: [], storedEncrypted: false };
}

export async function loadProfiles(): Promise<Profile[]> {
  return (await readStored()).list;
}

/**
 * 把磁盘上的存储格式对齐到当前设置。
 * 会写存储，因此必须在 withLock 内调用，避免与并发写互相覆盖。
 */
export async function alignStorageFormat(): Promise<void> {
  const { list, storedEncrypted } = await readStored();
  if (list.length === 0) return;
  const settings = await loadSettings();
  if (storedEncrypted !== settings.encryptStorage) {
    await writeProfiles(list, settings.encryptStorage);
  }
}

export async function persistProfiles(profiles: Profile[]): Promise<void> {
  const settings = await loadSettings();
  await writeProfiles(profiles, settings.encryptStorage);
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const value = raw[SETTINGS_KEY];
  const settings = { ...DEFAULT_SETTINGS, ...(value as Partial<Settings> | undefined) };
  // 站点列表可能来自旧版本或被手工改坏，这里兜一下底
  if (!Array.isArray(settings.quickAccessSites)) settings.quickAccessSites = [];

  // 悬浮窗尺寸早期是三档枚举（small / medium / large），统一迁移成百分比
  const scale = settings.panelScale as unknown;
  if (typeof scale === 'string') {
    const legacy: Record<string, number> = { small: 86, medium: 100, large: 116 };
    settings.panelScale = legacy[scale] ?? 100;
  } else if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    settings.panelScale = 100;
  }
  settings.panelScale = Math.min(150, Math.max(50, Math.round(settings.panelScale)));

  // 悬浮窗角落只认四个合法值，其余（含旧版本缺失）回落到默认
  const corners: Settings['panelCorner'][] = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ];
  if (!corners.includes(settings.panelCorner)) settings.panelCorner = 'bottom-right';

  // 历史快照数量来自旧版本或手工修改时，统一收敛到 1~10
  const history = Math.round(settings.historyLimit as unknown as number);
  settings.historyLimit = Number.isFinite(history)
    ? Math.min(MAX_HISTORY_LIMIT, Math.max(1, history))
    : DEFAULT_HISTORY_LIMIT;
  return settings;
}

export async function persistSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function readSession<T>(key: string): Promise<T | undefined> {
  const raw = await chrome.storage.session.get(key);
  return raw[key] as T | undefined;
}

/**
 * 切换回写必须先知道「现在浏览器里生效的是哪个身份」。
 * 这个关系只存在会话存储里，扩展重载或浏览器重启后失效，
 * 之后的切换就会因为查不到而跳过回写，不会拿旧数据去猜。
 */
export async function getActiveProfileId(site: string): Promise<string | null> {
  const map = (await readSession<Record<string, string>>(ACTIVE_KEY)) ?? {};
  return map[site] ?? null;
}

export async function rememberActiveProfile(site: string, profileId: string): Promise<void> {
  const map = (await readSession<Record<string, string>>(ACTIVE_KEY)) ?? {};
  map[site] = profileId;
  await chrome.storage.session.set({ [ACTIVE_KEY]: map });
}

/** 在网页上登出后调用：浏览器里已不再是这个身份，回写必须跳过 */
export async function forgetActiveProfile(site: string): Promise<void> {
  const map = (await readSession<Record<string, string>>(ACTIVE_KEY)) ?? {};
  if (!(site in map)) return;
  delete map[site];
  await chrome.storage.session.set({ [ACTIVE_KEY]: map });
}

export async function clearAllData(): Promise<number> {
  const profiles = await loadProfiles();
  await chrome.storage.local.remove([VAULT_KEY, LEGACY_PROFILES_KEY]);
  return profiles.length;
}

/** 直接丢弃密文，不做解密，用于忘记密码后的重置 */
export async function purgeVault(): Promise<void> {
  await chrome.storage.local.remove([VAULT_KEY, LEGACY_PROFILES_KEY]);
}
