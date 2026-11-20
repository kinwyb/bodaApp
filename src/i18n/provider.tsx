import React, { useCallback, useMemo, useState } from 'react';
import { getComponentLocale, getCurrentLocale, setCurrentLocale } from './index';
import { LocaleContext, PageCodeContext, type LocaleContextValue } from './context';
import type { AppLocale } from './types';

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<AppLocale>(getCurrentLocale);
  const setLocale = useCallback((next: AppLocale) => {
    setCurrentLocale(next);
    setLocaleState(next);
  }, []);
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, componentLocale: getComponentLocale(locale), setLocale }),
    [locale, setLocale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const PageLocaleProvider: React.FC<{
  code?: string;
  children: React.ReactNode;
}> = ({ code, children }) => (
  <PageCodeContext.Provider value={code}>{children}</PageCodeContext.Provider>
);
