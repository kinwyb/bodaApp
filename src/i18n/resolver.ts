import type { AppLocale, LocaleMessages, TranslateOptions } from './types';

const PLACEHOLDER = /\{(\w+)\}/g;

export function pageScopes(pageCode: string | undefined): string[] {
  if (!pageCode) return [];
  const segments = pageCode.split('_').filter(Boolean);
  const scopes: string[] = [];
  for (let length = segments.length; length > 0; length -= 1) {
    scopes.push(segments.slice(0, length).join('_'));
  }
  return scopes;
}

function interpolate(source: string, vars: TranslateOptions['vars']): string {
  if (!vars) return source;
  return source.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

function lookup(messages: LocaleMessages | undefined, source: string): string | undefined {
  const value = messages?.[source];
  return value && value.trim() ? value : undefined;
}

export function resolveTranslation(args: {
  locale: AppLocale;
  source: string;
  pageCode?: string;
  options?: TranslateOptions;
  common: Partial<Record<AppLocale, LocaleMessages>>;
  menu: Partial<Record<AppLocale, LocaleMessages>>;
  pages: Partial<Record<AppLocale, PageLocaleMessages>>;
}): string {
  const { locale, source, options } = args;
  const pageCode = options?.pageCode ?? args.pageCode;
  const scopes =
    options?.scope === 'common'
      ? []
      : pageScopes(options?.scope ?? pageCode);
  const localePages = args.pages[locale];

  if (options?.scope === 'menu') {
    const menu = lookup(args.menu[locale], source);
    return interpolate(menu ?? lookup(args.common[locale], source) ?? source, options.vars);
  }

  for (const scope of scopes) {
    const translated = lookup(localePages?.[scope], source);
    if (translated) return interpolate(translated, options?.vars);
  }

  const common = lookup(args.common[locale], source);
  return interpolate(common ?? source, options?.vars);
}

type PageLocaleMessages = Readonly<Record<string, LocaleMessages>>;
