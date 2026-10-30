import { t } from '@/shared/i18n';
import { DEFAULT_SETTINGS, type Profile, type Settings } from '@/shared/types';
import { seal, unseal, type SealedPayload } from './crypto';

const VAULT_KEY = 'cps:vault';
const LEGACY_PROFILES_KEY = 'cps:profiles';
const SETTINGS_KEY = 'cps:settings';

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
  return { ...DEFAULT_SETTINGS, ...(value as Partial<Settings> | undefined) };
}

export async function persistSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
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
