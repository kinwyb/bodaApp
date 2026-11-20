export const APP_LOCALES = ['zh-CN', 'en-US', 'vi-VN'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export type LocaleMessages = Readonly<Record<string, string>>;

export type TranslateOptions = {
  /** 页面 View code；不传时使用当前 PageLocaleProvider。 */
  pageCode?: string;
  /** 显式指定作用域，`common` 表示只查公共翻译。 */
  scope?: string;
  vars?: Record<string, string | number>;
};

export type Translate = (source: string, options?: TranslateOptions) => string;

export type PageLocaleMessages = Readonly<Record<string, LocaleMessages>>;

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}
