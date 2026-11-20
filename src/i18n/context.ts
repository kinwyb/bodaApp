import { createContext, useContext, useMemo } from 'react';
import { getComponentLocale, translateForLocale } from './index';
import type { AppLocale, Translate, TranslateOptions } from './types';

export type LocaleContextValue = {
  locale: AppLocale;
  componentLocale: ReturnType<typeof getComponentLocale>;
  setLocale: (locale: AppLocale) => void;
};

export const LocaleContext = createContext<LocaleContextValue | null>(null);
export const PageCodeContext = createContext<string | undefined>(undefined);

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale 必须在 LocaleProvider 内使用');
  return value;
}

export function useI18n(): { locale: AppLocale; t: Translate } {
  const { locale } = useLocale();
  const translator = useMemo<Translate>(
    () => (source, options) => translateForLocale(locale, source, options),
    [locale],
  );
  return { locale, t: translator };
}

export function usePageI18n(code?: string): {
  locale: AppLocale;
  pageCode?: string;
  t: Translate;
} {
  const contextCode = useContext(PageCodeContext);
  const { locale } = useLocale();
  const pageCode = code ?? contextCode;
  const translator = useMemo<Translate>(
    () => (source: string, options: TranslateOptions = {}) =>
      translateForLocale(locale, source, {
        ...options,
        pageCode: options.pageCode ?? pageCode,
      }),
    [locale, pageCode],
  );
  return { locale, pageCode, t: translator };
}
