import { applyLocaleSideEffects, isSupportedLocale } from './config';
import { COMMON_MESSAGES, MENU_MESSAGES, PAGE_MESSAGES } from './resources';
import { resolveTranslation } from './resolver';
import type { AppLocale, Translate, TranslateOptions } from './types';

export const LOCALE_STORAGE_KEY = 'bodaway.locale';

function detectInitialLocale(): AppLocale {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isSupportedLocale(saved)) return saved;
    } catch {
      // 隐私模式下 localStorage 不可用，继续用浏览器语言。
    }
    const browser = window.navigator.language;
    if (isSupportedLocale(browser)) return browser;
    if (browser.startsWith('zh')) return 'zh-CN';
    if (browser.startsWith('vi')) return 'vi-VN';
    if (browser.startsWith('en')) return 'en-US';
  }
  return 'zh-CN';
}

let currentLocale: AppLocale = detectInitialLocale();

export function getCurrentLocale(): AppLocale {
  return currentLocale;
}

export function setCurrentLocale(locale: AppLocale): void {
  currentLocale = locale;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // 不能持久化时仍让本次运行切到目标语言。
    }
  }
  applyLocaleSideEffects(locale);
}

export function initializeLocale(): AppLocale {
  applyLocaleSideEffects(currentLocale);
  return currentLocale;
}

export function translateForLocale(
  locale: AppLocale,
  source: string,
  options: TranslateOptions = {},
): string {
  return resolveTranslation({
    locale,
    source,
    pageCode: options.pageCode,
    options,
    common: COMMON_MESSAGES,
    menu: MENU_MESSAGES,
    pages: PAGE_MESSAGES,
  });
}

export function translate(source: string, options: TranslateOptions = {}): string {
  return translateForLocale(currentLocale, source, options);
}

export const t: Translate = translate;

export type { AppLocale, Translate, TranslateOptions } from './types';
export { APP_LOCALES, isAppLocale } from './types';
export { LANGUAGE_OPTIONS, getComponentLocale, languageLabel } from './config';
