/**
 * 数据加密层（始终启用，与启动密码无关）。
 *
 * 密钥是随机生成的 AES-GCM 256 位 CryptoKey，以 non-extractable 形式持久化在
 * IndexedDB 里：密钥无法被导出成字节，磁盘上也不会出现可用于解密的明文密钥。
 * 因此存储中的 Profile 始终是密文，任何人直接读取扩展存储目录都拿不到 cookie。
 */

import { t } from '@/shared/i18n';

const DB_NAME = 'cps-vault';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'vault-key';
const IV_BYTES = 12;

export interface SealedPayload {
  v: 1;
  iv: string;
  ct: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(t('err.keyStoreUnavailable')));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

let keyPromise: Promise<CryptoKey> | null = null;

async function loadOrCreateKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(KEY_ID);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await idbPut(KEY_ID, key);
  return key;
}

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch((error) => {
      keyPromise = null;
      throw error;
    });
  }
  return keyPromise;
}

export async function seal(value: unknown): Promise<SealedPayload> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    v: 1,
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(cipher)),
  };
}

export async function unseal<T>(payload: SealedPayload): Promise<T> {
  if (!payload || payload.v !== 1 || typeof payload.ct !== 'string') {
    throw new Error(t('err.decryptFailed'));
  }
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ct),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export { toBase64, fromBase64 };
