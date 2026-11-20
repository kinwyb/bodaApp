#!/usr/bin/env node
/**
 * 检查按 View code 组织的页面翻译文件是否仍对应真实页面目录。
 *
 * 允许父级 code，例如 V0018.ts，因为它服务 V0018 下的多个页面；
 * 不允许指向不存在的目录，避免页面改名后留下永远查不到的翻译。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOCALES_ROOT = path.join(ROOT, 'src/i18n/locales');
const VIEWS_ROOT = path.join(ROOT, 'src/pages/views');
const MENU_FILE = path.join(ROOT, 'src/api/mock/data/power/desktopMenu.json');

function pageCodeFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'pages') {
        for (const file of fs.readdirSync(target)) {
          if (file.endsWith('.ts')) result.push(path.join(target, file));
        }
      } else {
        pageCodeFiles(target, result);
      }
    }
  }
  return result;
}

function viewDirectoryOf(code) {
  return path.join(VIEWS_ROOT, ...code.split('_'));
}

const errors = [];
for (const file of fs.readdirSync(LOCALES_ROOT, { withFileTypes: true })) {
  if (!file.isDirectory()) continue;
  for (const codeFile of pageCodeFiles(path.join(LOCALES_ROOT, file.name))) {
    const code = path.basename(codeFile, '.ts');
    if (!fs.existsSync(viewDirectoryOf(code))) {
      errors.push(
        `${path.relative(ROOT, codeFile)}: page code ${code} 对应的目录不存在`,
      );
    }
  }
}

function currentMenuNames() {
  const parsed = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
  const roots = Array.isArray(parsed) ? parsed : parsed.data ?? [];
  const names = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (!node.IsAction && node.MenuName) names.push(node.MenuName.trim());
      walk(node.Children ?? []);
    }
  };
  walk(roots);
  return [...new Set(names)];
}

function stringValue(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function menuTranslations(file) {
  if (!fs.existsSync(file)) return new Map();
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result = new Map();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const key = stringValue(node.name);
      const value = stringValue(node.initializer);
      if (key !== undefined && value !== undefined) result.set(key, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

const menuNames = currentMenuNames();
const menuNameSet = new Set(menuNames);
for (const locale of ['en-US', 'vi-VN']) {
  const file = path.join(LOCALES_ROOT, locale, 'menu.ts');
  const translations = menuTranslations(file);
  for (const name of menuNames) {
    if (!translations.has(name)) {
      errors.push(`${path.relative(ROOT, file)}: 缺少菜单 ${name}`);
    }
  }
  for (const [name, value] of translations) {
    if (!menuNameSet.has(name)) {
      errors.push(`${path.relative(ROOT, file)}: 菜单 ${name} 不在当前菜单树中`);
    }
    if (value === name && /[\u3400-\u9fff]/.test(name)) {
      errors.push(`${path.relative(ROOT, file)}: 菜单 ${name} 仍然回退中文`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('[i18n] 页面 code 与菜单资源检查通过');
