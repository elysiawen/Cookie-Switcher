/**
 * 快捷入口（右键菜单 / 页面悬浮窗）的站点范围判断。
 * 规则里的域名同时覆盖它自己的子域，例如 example.com 覆盖 www.example.com。
 */

import { normalizeHostname } from './domain';
import type { QuickAccessScope } from './types';

export interface QuickAccessRule {
  quickAccessScope?: QuickAccessScope;
  quickAccessSites?: string[];
}

/** 把用户输入的站点整理成纯域名，允许带协议、路径、端口与前导点 */
export function normalizeSiteRule(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  let host = raw;
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    host = raw.split('/')[0];
  }

  host = normalizeHostname(host.replace(/^\./, ''));
  if (!host || /\s/.test(host) || host === '.') return null;
  return host;
}

export function siteRuleMatches(hostname: string, rule: string): boolean {
  const host = normalizeHostname(hostname);
  const target = normalizeHostname(rule.replace(/^\./, ''));
  if (!host || !target) return false;
  return host === target || host.endsWith('.' + target);
}

/** 当前 hostname 是否允许展示快捷入口 */
export function isQuickAccessAllowed(
  hostname: string | null | undefined,
  rule: QuickAccessRule,
): boolean {
  if (!hostname) return false;
  const scope = rule.quickAccessScope ?? 'all';
  if (scope === 'all') return true;

  const sites = rule.quickAccessSites ?? [];
  const listed = sites.some((item) => siteRuleMatches(hostname, item));
  return scope === 'whitelist' ? listed : !listed;
}

/** 把文本框内容解析成去重后的域名列表 */
export function parseSiteRules(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/[\r\n,;]+/)) {
    const rule = normalizeSiteRule(line);
    if (rule && !out.includes(rule)) out.push(rule);
  }
  return out;
}
