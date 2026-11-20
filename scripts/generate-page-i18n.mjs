#!/usr/bin/env node
/**
 * 根据页面提取结果生成 locale/pages/<ViewCode>.ts。
 *
 * 优先级：
 * 1. 已有页面文件
 * 2. 本次补充词条
 * 3. 旧客户端 Message / Tr.resx
 * 4. common.ts（已有公共翻译时不重复写进页面文件）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOCALES_ROOT = path.join(ROOT, 'src/i18n/locales');
const LEGACY_BODA_ROOT =
  process.env.LEGACY_BODA_ROOT ?? path.join(os.homedir(), 'Downloads/Boda');
const LEGACY_LANGUAGE_ROOT =
  process.env.LEGACY_LANGUAGE_ROOT ?? path.join(os.homedir(), 'Downloads/BodaLanguage');

const extracted = JSON.parse(
  execFileSync(process.execPath, [path.join(HERE, 'extract-page-i18n.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }),
);

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readResx(file) {
  if (!fs.existsSync(file)) return {};
  const xml = fs.readFileSync(file, 'utf8');
  const result = {};
  for (const match of xml.matchAll(/<data\s+([^>]*?)>([\s\S]*?)<\/data>/g)) {
    const name = match[1].match(/\bname="([^"]+)"/)?.[1];
    const value = match[2].match(/<value>([\s\S]*?)<\/value>/)?.[1];
    if (name && value !== undefined) result[decodeXml(name)] = decodeXml(value).trim();
  }
  return result;
}

function objectStrings(file) {
  if (!fs.existsSync(file)) return {};
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result = {};
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : undefined;
      const value = ts.isStringLiteralLike(node.initializer) ? node.initializer.text : undefined;
      if (key !== undefined && value !== undefined) result[key] = value;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

function valid(value, source) {
  return typeof value === 'string' && value.trim() && value.trim() !== source;
}

const oldCommon = {
  'en-US': {
    ...readResx(path.join(LEGACY_LANGUAGE_ROOT, 'Message.en-US.resx')),
    ...readResx(path.join(LEGACY_BODA_ROOT, 'bin/Debug/en-US/Tr.resx')),
  },
  'vi-VN': {
    ...readResx(path.join(LEGACY_LANGUAGE_ROOT, 'Message.vi-VN.resx')),
    ...readResx(path.join(LEGACY_BODA_ROOT, 'bin/Debug/vi-VN/Tr.resx')),
  },
};

const supplement = {
  'en-US': JSON.parse(fs.readFileSync(path.join(HERE, 'page-i18n-supplement-en.json'), 'utf8')),
  'vi-VN': JSON.parse(fs.readFileSync(path.join(HERE, 'page-i18n-supplement-vi.json'), 'utf8')),
};

function parentCodes(code) {
  const parts = code.split('_');
  const result = [];
  for (let length = parts.length - 1; length > 0; length -= 1) {
    result.push(parts.slice(0, length).join('_'));
  }
  return result;
}

const existingByLocale = Object.fromEntries(
  ['en-US', 'vi-VN'].map((locale) => [
    locale,
    Object.fromEntries(
      Object.keys(extracted.pages).map((code) => [
        code,
        objectStrings(path.join(LOCALES_ROOT, locale, 'pages', `${code}.ts`)),
      ]),
    ),
  ]),
);

const missing = {};
for (const locale of ['en-US', 'vi-VN']) {
  const common = objectStrings(path.join(LOCALES_ROOT, locale, 'common.ts'));
  missing[locale] = [];
  for (const [code, keys] of Object.entries(extracted.pages)) {
    const file = path.join(LOCALES_ROOT, locale, 'pages', `${code}.ts`);
    const existing = objectStrings(file);
    const merged = { ...existing };
    for (const key of keys) {
      if (existing[key]) continue;
      const inherited = parentCodes(code)
        .map((parent) => existingByLocale[locale][parent]?.[key])
        .find((value) => valid(value, key));
      const candidates = [supplement[locale][key], inherited, oldCommon[locale][key]];
      const found = candidates.find((value) => valid(value, key));
      if (found) merged[key] = found.trim();
      else if (!common[key]) missing[locale].push(`${code}: ${key}`);
    }
    const keysToWrite = [...new Set([...keys, ...Object.keys(existing)])];
    const entries = keysToWrite
      .filter((key) => merged[key])
      .map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(merged[key])},`);
    if (!entries.length) continue;
    const output = [
      "import type { LocaleMessages } from '../../../types';",
      '',
      'export default {',
      ...entries,
      '} satisfies LocaleMessages;',
      '',
    ].join('\n');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, output);
  }
}

for (const [locale, keys] of Object.entries(missing)) {
  console.log(`[page-i18n] ${locale}: missing=${keys.length}`);
  if (keys.length) console.log(keys.slice(0, 40).join('\n'));
}

if (Object.values(missing).some((keys) => keys.length)) {
  fs.writeFileSync(path.join(HERE, 'page-i18n-missing.json'), `${JSON.stringify(missing, null, 2)}\n`);
}
