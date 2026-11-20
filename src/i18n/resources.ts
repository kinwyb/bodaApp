import type { AppLocale, LocaleMessages } from './types';

const commonModules = import.meta.glob<LocaleMessages>('./locales/*/common.ts', {
  eager: true,
  import: 'default',
});

const pageModules = import.meta.glob<LocaleMessages>('./locales/*/pages/*.ts', {
  eager: true,
  import: 'default',
});

const menuModules = import.meta.glob<LocaleMessages>('./locales/*/menu.ts', {
  eager: true,
  import: 'default',
});

const EMPTY_COMMON: Record<AppLocale, LocaleMessages> = {
  'zh-CN': {},
  'en-US': {},
  'vi-VN': {},
};

type MutablePageMessages = Record<AppLocale, Record<string, LocaleMessages>>;

const EMPTY_PAGES: MutablePageMessages = {
  'zh-CN': {},
  'en-US': {},
  'vi-VN': {},
};

function localeOf(path: string): AppLocale | undefined {
  const match = path.match(/\.\/locales\/([^/]+)\//);
  return match?.[1] as AppLocale | undefined;
}

export const COMMON_MESSAGES: Record<AppLocale, LocaleMessages> = { ...EMPTY_COMMON };
export const MENU_MESSAGES: Record<AppLocale, LocaleMessages> = { ...EMPTY_COMMON };
export const PAGE_MESSAGES: MutablePageMessages = {
  'zh-CN': { ...EMPTY_PAGES['zh-CN'] },
  'en-US': { ...EMPTY_PAGES['en-US'] },
  'vi-VN': { ...EMPTY_PAGES['vi-VN'] },
};

for (const [path, messages] of Object.entries(commonModules)) {
  const locale = localeOf(path);
  if (locale) COMMON_MESSAGES[locale] = messages;
}

for (const [path, messages] of Object.entries(menuModules)) {
  const locale = localeOf(path);
  if (locale) MENU_MESSAGES[locale] = messages;
}

for (const [path, messages] of Object.entries(pageModules)) {
  const locale = localeOf(path);
  const code = path.match(/\/pages\/([^/]+)\.ts$/)?.[1];
  if (locale && code) {
    PAGE_MESSAGES[locale][code] = messages;
  }
}
