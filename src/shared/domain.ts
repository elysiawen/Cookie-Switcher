import { MAX_HISTORY_LIMIT, type CookieRecord, type HistorySnapshot, type Profile, type Scope } from './types';

/** 常见的二级公共后缀，用于把 www.a.co.uk 归并到 a.co.uk */
const SECOND_LEVEL = new Set([
  'co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'mil', 'sch', 'info', 'biz',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/\.$/, '').toLowerCase();
}

/** 从 hostname 推导注册主域；IP 与 localhost 原样返回 */
export function siteKeyFromHostname(hostname: string): string {
  const host = normalizeHostname(hostname);
  if (!host) return host;
  if (IPV4.test(host) || host.includes(':') || host.startsWith('[')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const secondLevel = parts[parts.length - 2];
  if (tld.length === 2 && SECOND_LEVEL.has(secondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function stripLeadingDot(domain: string): string {
  return normalizeHostname(domain.replace(/^\./, ''));
}

/** 某个 Profile 的 site/scope 是否覆盖当前 hostname */
export function profileCoversHostname(
  profile: { site: string; scope: Scope },
  hostname: string,
): boolean {
  const host = normalizeHostname(hostname);
  if (profile.scope === 'exact') return host === profile.site;
  return host === profile.site || host.endsWith('.' + profile.site);
}

/** cookie 的 domain 是否落在给定 site + scope 范围内 */
export function cookieInScope(cookieDomain: string, site: string, scope: Scope): boolean {
  const domain = stripLeadingDot(cookieDomain);
  if (scope === 'exact') return domain === site;
  return domain === site || domain.endsWith('.' + site);
}

/** 依据 scope 计算保存时的 site 字段 */
export function resolveSiteKey(hostname: string, scope: Scope): string {
  const host = normalizeHostname(hostname);
  return scope === 'exact' ? host : siteKeyFromHostname(host);
}

/** 重建 cookies.set 需要的 url */
export function cookieUrl(cookie: CookieRecord): string {
  const host = stripLeadingDot(cookie.domain);
  const scheme = cookie.secure ? 'https' : 'http';
  const path = cookie.path.startsWith('/') ? cookie.path : '/' + cookie.path;
  return `${scheme}://${host}${path}`;
}

export function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

export function originFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** 新快照插到最前面，并按上限裁剪掉最旧的几份 */
export function appendHistory(
  history: HistorySnapshot[] | undefined,
  snapshot: HistorySnapshot,
  limit: number,
): HistorySnapshot[] {
  const max = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.round(limit)));
  return [snapshot, ...(history ?? [])].slice(0, max);
}

/**
 * 按给定顺序调整一组身份的位置：它们原先占用的槽位不变，其余身份原位不动。
 * 因此在一处拖动排序（弹窗、设置页的某个站点分组）不会打乱其他身份的排列。
 */
export function reorderProfiles(list: Profile[], ids: string[]): Profile[] {
  const byId = new Map(list.map((item) => [item.id, item]));
  const queue = [...new Set(ids)]
    .map((id) => byId.get(id))
    .filter((item): item is Profile => item !== undefined);
  if (queue.length < 2) return list;

  const moving = new Set(queue.map((item) => item.id));
  const rest = list.filter((item) => !moving.has(item.id));
  const next: Profile[] = [];
  let moved = 0;
  let kept = 0;
  for (const item of list) {
    next.push(moving.has(item.id) ? queue[moved++] : rest[kept++]);
  }
  return next;
}


