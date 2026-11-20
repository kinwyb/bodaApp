import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/vi';
import 'dayjs/locale/zh-cn';

import enUS from 'antd/locale/en_US';
import viVN from 'antd/locale/vi_VN';
import zhCN from 'antd/locale/zh_CN';
import enUSX from '@ant-design/x/locale/en_US';
import zhCNX from '@ant-design/x/locale/zh_CN';

import { APP_LOCALES, type AppLocale } from './types';

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: AppLocale; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' },
  { value: 'vi-VN', label: 'Tiếng Việt' },
];

const DAYJS_LOCALES: Record<AppLocale, string> = {
  'zh-CN': 'zh-cn',
  'en-US': 'en',
  'vi-VN': 'vi',
};

export function getComponentLocale(locale: AppLocale) {
  if (locale === 'zh-CN') return { ...zhCN, ...zhCNX };
  if (locale === 'vi-VN') {
    // @ant-design/x 当前未提供 vi_VN，组件文案用 en_US 兜底；业务文案仍走 vi-VN。
    return { ...viVN, ...enUSX };
  }
  return { ...enUS, ...enUSX };
}

export function applyLocaleSideEffects(locale: AppLocale): void {
  dayjs.locale(DAYJS_LOCALES[locale]);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function languageLabel(locale: AppLocale): string {
  return LANGUAGE_OPTIONS.find((item) => item.value === locale)?.label ?? locale;
}

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}
