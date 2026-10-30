/**
 * 启动密码（可选）。它与数据加密完全独立：
 * Cookie 始终由 crypto.ts 的随机密钥加密，这里只决定「界面是否允许操作」。
 * 解锁状态只记录在 chrome.storage.session（内存），浏览器重启后自动失效。
 */

import { t } from '@/shared/i18n';
import type { LockState } from '@/shared/types';
import { fromBase64, toBase64 } from './crypto';

const LOCK_KEY = 'cps:lock';
const SESSION_FLAG = 'cps:unlocked';
const ITERATIONS = 210_000;
export const MIN_PASSWORD_LENGTH = 6;

interface LockConfig {
  v: 1;
  salt: string;
  hash: string;
  iterations: number;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base,
    256,
  );
  return new Uint8Array(bits);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 连续失败后的冷却，缓解对启动密码的暴力尝试 */
const MAX_ATTEMPTS = 5;
let failures = 0;
let cooldownUntil = 0;

function assertNotCoolingDown(): void {
  const wait = cooldownUntil - Date.now();
  if (wait > 0) {
    throw new Error(t('err.tooManyAttempts', { seconds: Math.ceil(wait / 1000) }));
  }
}

function recordFailure(): void {
  failures += 1;
  if (failures >= MAX_ATTEMPTS) {
    cooldownUntil = Date.now() + Math.min(30_000, 1000 * (failures - MAX_ATTEMPTS + 1));
  }
}

async function loadConfig(): Promise<LockConfig | null> {
  const raw = await chrome.storage.local.get(LOCK_KEY);
  const value = raw[LOCK_KEY] as LockConfig | undefined;
  if (!value || typeof value.hash !== 'string' || typeof value.salt !== 'string') return null;
  return value;
}

async function markUnlocked(unlocked: boolean): Promise<void> {
  if (unlocked) {
    await chrome.storage.session.set({ [SESSION_FLAG]: true });
  } else {
    await chrome.storage.session.remove(SESSION_FLAG);
  }
}

export async function getLockState(): Promise<LockState> {
  const config = await loadConfig();
  if (!config) return { enabled: false, unlocked: true };
  const session = await chrome.storage.session.get(SESSION_FLAG);
  return { enabled: true, unlocked: session[SESSION_FLAG] === true };
}

export async function unlock(password: string): Promise<LockState> {
  const config = await loadConfig();
  if (!config) return { enabled: false, unlocked: true };

  assertNotCoolingDown();
  const hash = await derive(password, fromBase64(config.salt), config.iterations);
  if (!equal(hash, fromBase64(config.hash))) {
    recordFailure();
    throw new Error(t('err.badPassword'));
  }
  failures = 0;
  cooldownUntil = 0;
  await markUnlocked(true);
  return { enabled: true, unlocked: true };
}

export async function setPassword(password: string, currentPassword?: string): Promise<LockState> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(t('err.passwordTooShort', { count: MIN_PASSWORD_LENGTH }));
  }
  const existing = await loadConfig();
  if (existing) {
    if (!currentPassword) throw new Error(t('err.currentPasswordRequired'));
    const current = await derive(currentPassword, fromBase64(existing.salt), existing.iterations);
    if (!equal(current, fromBase64(existing.hash))) throw new Error(t('err.currentPasswordWrong'));
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  const config: LockConfig = {
    v: 1,
    salt: toBase64(salt),
    hash: toBase64(hash),
    iterations: ITERATIONS,
  };
  await chrome.storage.local.set({ [LOCK_KEY]: config });
  await markUnlocked(true);
  return { enabled: true, unlocked: true };
}

export async function removePassword(password: string): Promise<LockState> {
  const config = await loadConfig();
  if (!config) return { enabled: false, unlocked: true };

  assertNotCoolingDown();
  const hash = await derive(password, fromBase64(config.salt), config.iterations);
  if (!equal(hash, fromBase64(config.hash))) {
    recordFailure();
    throw new Error(t('err.badPassword'));
  }

  await chrome.storage.local.remove(LOCK_KEY);
  await markUnlocked(true);
  return { enabled: false, unlocked: true };
}

export async function lockNow(): Promise<LockState> {
  const config = await loadConfig();
  if (!config) return { enabled: false, unlocked: true };
  await markUnlocked(false);
  return { enabled: true, unlocked: false };
}

/** 忘记密码时使用：直接丢弃锁定配置（数据仍受独立密钥保护） */
export async function resetLock(): Promise<void> {
  await chrome.storage.local.remove(LOCK_KEY);
  await markUnlocked(true);
}
