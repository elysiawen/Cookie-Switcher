import { cookieInScope, cookieUrl, stripLeadingDot } from '@/shared/domain';
import type { CookiePartitionKey, CookieRecord, Scope } from '@/shared/types';

type RawCookie = chrome.cookies.Cookie & { partitionKey?: CookiePartitionKey };

export interface ApplyOutcome {
  written: number;
  skippedExpired: number;
  errors: string[];
}

export interface ClearOutcome {
  cleared: number;
  errors: string[];
}

function toRecord(cookie: RawCookie): CookieRecord {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    session: cookie.session,
    expirationDate: cookie.expirationDate,
    storeId: cookie.storeId,
    partitionKey: cookie.partitionKey,
  };
}

function describe(cookie: { name: string; domain: string }): string {
  return `${cookie.name}@${cookie.domain}`;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 读取站点范围内的全部 cookie（httpOnly 也能读到） */
export async function collectCookies(site: string, scope: Scope): Promise<CookieRecord[]> {
  const all = (await chrome.cookies.getAll({ domain: site })) as RawCookie[];
  return all.filter((cookie) => cookieInScope(cookie.domain, site, scope)).map(toRecord);
}

export async function countCookies(site: string, scope: Scope): Promise<number> {
  return (await collectCookies(site, scope)).length;
}

function buildSetDetails(record: CookieRecord): chrome.cookies.SetDetails {
  const details: chrome.cookies.SetDetails = {
    url: cookieUrl(record),
    name: record.name,
    value: record.value,
    domain: record.domain,
    path: record.path,
    secure: record.secure,
    httpOnly: record.httpOnly,
    storeId: record.storeId,
  };
  if (record.sameSite && record.sameSite !== 'unspecified') {
    details.sameSite = record.sameSite;
  }
  if (!record.session && typeof record.expirationDate === 'number') {
    details.expirationDate = record.expirationDate;
  }
  if (record.partitionKey) {
    (details as chrome.cookies.SetDetails & { partitionKey?: CookiePartitionKey }).partitionKey =
      record.partitionKey;
  }
  // __Host- 前缀的 cookie 不允许带 domain，必须 host-only + path=/ + secure
  if (record.name.startsWith('__Host-')) {
    delete details.domain;
    details.path = '/';
    details.secure = true;
    details.url = `https://${stripLeadingDot(record.domain)}/`;
  }
  return details;
}

async function writeCookie(record: CookieRecord): Promise<void> {
  const details = buildSetDetails(record);
  try {
    await chrome.cookies.set(details);
  } catch (error) {
    // 分区信息不被支持时降级为标准 cookie，避免整条失败
    if (record.partitionKey) {
      const fallback = { ...details } as chrome.cookies.SetDetails & { partitionKey?: unknown };
      delete fallback.partitionKey;
      await chrome.cookies.set(fallback);
      return;
    }
    throw error;
  }
}

export async function applyCookies(records: CookieRecord[]): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { written: 0, skippedExpired: 0, errors: [] };
  const nowSeconds = Date.now() / 1000;

  for (const record of records) {
    if (!record.session && typeof record.expirationDate === 'number' && record.expirationDate <= nowSeconds) {
      outcome.skippedExpired += 1;
      continue;
    }
    try {
      await writeCookie(record);
      outcome.written += 1;
    } catch (error) {
      outcome.errors.push(`${describe(record)}: ${errorText(error)}`);
    }
  }
  return outcome;
}

export async function clearCookies(site: string, scope: Scope): Promise<ClearOutcome> {
  const all = (await chrome.cookies.getAll({ domain: site })) as RawCookie[];
  const targets = all.filter((cookie) => cookieInScope(cookie.domain, site, scope));
  const outcome: ClearOutcome = { cleared: 0, errors: [] };

  for (const cookie of targets) {
    try {
      const details = {
        url: cookieUrl(toRecord(cookie)),
        name: cookie.name,
        storeId: cookie.storeId,
        ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
      } as Parameters<typeof chrome.cookies.remove>[0] & { partitionKey?: CookiePartitionKey };
      await chrome.cookies.remove(details);
      outcome.cleared += 1;
    } catch (error) {
      outcome.errors.push(`${describe(cookie)}: ${errorText(error)}`);
    }
  }
  return outcome;
}

/** 站点当前 cookie 概览，用于 UI 提示 */
export async function summarizeSite(site: string, scope: Scope): Promise<{ total: number; httpOnly: number }> {
  const list = await collectCookies(site, scope);
  return { total: list.length, httpOnly: list.filter((c) => c.httpOnly).length };
}
