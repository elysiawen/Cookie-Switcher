import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createT,
  detectBrowserLocale,
  readLocalePreference,
  resolveLocale,
  SETTINGS_STORAGE_KEY,
  type LocalePreference,
  type ResolvedLocale,
  type TFunc,
} from './index';

interface I18nValue {
  locale: ResolvedLocale;
  t: TFunc;
}

const I18nContext = createContext<I18nValue>({
  locale: 'zh-CN',
  t: createT('zh-CN'),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<ResolvedLocale>(() => detectBrowserLocale());

  useEffect(() => {
    let alive = true;

    const apply = (preference: LocalePreference | undefined) => {
      if (alive) setLocale(resolveLocale(preference));
    };

    void readLocalePreference().then(apply);

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
      const next = changes[SETTINGS_STORAGE_KEY].newValue as
        | { locale?: LocalePreference }
        | undefined;
      apply(next?.locale);
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const value = useMemo<I18nValue>(() => ({ locale, t: createT(locale) }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
