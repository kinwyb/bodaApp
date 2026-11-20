#!/usr/bin/env node
/**
 * 扫描业务页面里真正会展示给用户的文案，输出按 View code 分组的 key 清单。
 *
 * 只收：
 * - JSX 文本
 * - 常见显示属性：label / title / placeholder / description / emptyTip / exportName ...
 * - message / notification / modal 等反馈文案
 * - message、content、okText、cancelText 等已知反馈属性
 *
 * 不收注释、字段名、接口参数、action id 和业务数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VIEWS_ROOT = path.join(ROOT, 'src/pages/views');

const DISPLAY_KEY = new Set([
  'label',
  'title',
  'placeholder',
  'description',
  'okText',
  'cancelText',
  'emptyTip',
  'loadingTip',
  'exportName',
  'tooltip',
  'hint',
  'content',
  'message',
]);

const HAN = /[\u3400-\u9fff]/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(target);
    else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/Bridge\.tsx?$/.test(entry.name) &&
      entry.name !== 'bridged.ts' &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      yield target;
    }
  }
}

function viewCodeOf(file) {
  const relative = path.relative(VIEWS_ROOT, file);
  const parts = relative.split(path.sep);
  const code = [];
  for (const part of parts.slice(0, -1)) {
    if (!/^V\d+$/.test(part)) break;
    code.push(part);
  }
  return code.join('_');
}

function normalizedText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function isDisplayProperty(node) {
  if (!ts.isPropertyAssignment(node)) return false;
  const name = propertyName(node.name);
  return name !== undefined && DISPLAY_KEY.has(name);
}

function isFeedbackCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;
  const owner = ts.isIdentifier(expression.expression) ? expression.expression.text : '';
  const method = expression.name.text;
  return (
    (owner === 'message' && ['success', 'error', 'warning', 'info', 'loading'].includes(method)) ||
    (owner === 'notification' && ['success', 'error', 'warning', 'info'].includes(method)) ||
    (owner === 'Modal' && ['confirm', 'info', 'success', 'error', 'warning'].includes(method))
  );
}

function collect(file) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const keys = new Set();
  const raw = new Set();

  const add = (value) => {
    const text = normalizedText(value);
    if (text && HAN.test(text)) keys.add(text);
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      add(node.text);
      const text = normalizedText(node.text);
      if (text && HAN.test(text)) raw.add(text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments.length > 0
    ) {
      const first = node.arguments[0];
      if (ts.isStringLiteralLike(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
        add(first.text);
      }
    }
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      const display =
        (ts.isJsxAttribute(parent) && DISPLAY_KEY.has(parent.name.text)) ||
        isDisplayProperty(parent) ||
        (ts.isCallExpression(parent) && isFeedbackCall(parent) && parent.arguments.includes(node)) ||
        (ts.isNewExpression(parent) && isFeedbackCall(parent) && parent.arguments?.includes(node));
      if (display) {
        add(node.text);
        const text = normalizedText(node.text);
        if (text && HAN.test(text)) raw.add(text);
      }
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if (
        (ts.isJsxAttribute(parent) && DISPLAY_KEY.has(parent.name.text)) ||
        isDisplayProperty(parent) ||
        (ts.isCallExpression(parent) && isFeedbackCall(parent) && parent.arguments.includes(node))
      ) {
        add(node.text);
        const text = normalizedText(node.text);
        if (text && HAN.test(text)) raw.add(text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { keys, raw };
}

const pages = {};
const untranslated = {};
const all = new Set();
for (const file of walk(VIEWS_ROOT)) {
  const code = viewCodeOf(file);
  if (!code) continue;
  const { keys, raw } = collect(file);
  if (!keys.size) continue;
  pages[code] ??= new Set();
  untranslated[code] ??= new Set();
  for (const key of keys) {
    pages[code].add(key);
    all.add(key);
  }
  for (const key of raw) untranslated[code].add(key);
}

const output = {
  total: all.size,
  pages: Object.fromEntries(
    Object.entries(pages)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, keys]) => [code, [...keys].sort()]),
  ),
  untranslated: Object.fromEntries(
    Object.entries(untranslated)
      .filter(([, keys]) => keys.size)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, keys]) => [code, [...keys].sort()]),
  ),
};

const target = process.argv[2];
const json = JSON.stringify(output, null, 2);
if (target) fs.writeFileSync(path.resolve(ROOT, target), `${json}\n`);
else console.log(json);
