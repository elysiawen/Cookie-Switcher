import { enUS } from './en-US';
import { jaJP } from './ja-JP';
import { zhCN, type MessageKey } from './zh-CN';

export type { MessageKey };

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP'] as const;
export type ResolvedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = 'auto' | ResolvedLocale;

export const FALLBACK_LOCALE: ResolvedLocale = 'zh-CN';

/** 语言名使用其自身语言书写，不做翻译 */
export const LOCALE_LABELS: Record<ResolvedLocale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
  'ja-JP': '日本語',
};

const DICTIONARIES: Record<ResolvedLocale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
};

export type TParams = Record<string, string | number>;
export type TFunc = (key: MessageKey, params?: TParams) => string;

export function translate(locale: ResolvedLocale, key: MessageKey, params?: TParams): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[FALLBACK_LOCALE];
  let text = dict[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

export function detectBrowserLocale(): ResolvedLocale {
  let ui = '';
  try {
    ui = chrome.i18n.getUILanguage().toLowerCase();
  } catch {
    ui = '';
  }
  if (!ui && typeof navigator !== 'undefined') ui = navigator.language.toLowerCase();
  if (ui.startsWith('zh')) return 'zh-CN';
  if (ui.startsWith('ja')) return 'ja-JP';
  return 'en-US';
}

export function resolveLocale(preference: LocalePreference | undefined | null): ResolvedLocale {
  if (preference && preference !== 'auto') {
    const matched = SUPPORTED_LOCALES.find((item) => item === preference);
    if (matched) return matched;
  }
  return detectBrowserLocale();
}

export const SETTINGS_STORAGE_KEY = 'cps:settings';

export async function readLocalePreference(): Promise<LocalePreference> {
  try {
    const raw = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    const settings = raw[SETTINGS_STORAGE_KEY] as { locale?: LocalePreference } | undefined;
    return settings?.locale ?? 'auto';
  } catch {
    return 'auto';
  }
}

export async function resolveCurrentLocale(): Promise<ResolvedLocale> {
  return resolveLocale(await readLocalePreference());
}

let runtimeLocale: ResolvedLocale = FALLBACK_LOCALE;

export function setRuntimeLocale(locale: ResolvedLocale): void {
  runtimeLocale = locale;
}

export function getRuntimeLocale(): ResolvedLocale {
  return runtimeLocale;
}

/** 供 background / 非 React 环境使用，读取最近一次 setRuntimeLocale 的结果 */
export function t(key: MessageKey, params?: TParams): string {
  return translate(runtimeLocale, key, params);
}

export function createT(locale: ResolvedLocale): TFunc {
  return (key, params) => translate(locale, key, params);
}

export function formatTime(timestamp: number, tFn: TFunc): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return tFn('time.justNow');
  if (diff < 3_600_000) return tFn('time.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return tFn('time.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return tFn('time.daysAgo', { n: Math.floor(diff / 86_400_000) });
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
