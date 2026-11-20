#!/usr/bin/env node
/**
 * 将业务页面中真实展示给用户的字符串包成 t()。
 *
 * 目标与 extract-page-i18n.mjs 保持一致：
 * - JSX 文本
 * - label / title / placeholder / description / emptyTip / exportName 等显示属性
 * - message / notification / Modal 的反馈文案
 *
 * 不处理 bridged.ts、*Bridge.ts、测试、字段名和接口参数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VIEWS_ROOT = path.join(ROOT, 'src/pages/views');
const HAN = /[\u3400-\u9fff]/;

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

function textOf(node) {
  return node.replace(/\s+/g, ' ').trim();
}

function literal(text) {
  return JSON.stringify(textOf(text));
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

function shouldReplaceLiteral(node) {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 't') {
    return false;
  }
  return (
    (ts.isJsxAttribute(parent) && DISPLAY_KEY.has(parent.name.text)) ||
    isDisplayProperty(parent) ||
    (ts.isCallExpression(parent) && isFeedbackCall(parent) && parent.arguments.includes(node))
  );
}

function hasFunctionAncestor(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function rewrite(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('createPageTranslator(')) return 0;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];

  const add = (start, end, replacement) => edits.push({ start, end, replacement });

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const value = textOf(node.text);
      if (value && HAN.test(value) && hasFunctionAncestor(node)) {
        add(node.getStart(sourceFile), node.getEnd(), `{t(${literal(value)})}`);
      }
    } else if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = textOf(node.text);
      if (value && HAN.test(value) && shouldReplaceLiteral(node) && hasFunctionAncestor(node)) {
        const replacement = `t(${literal(value)})`;
        add(
          node.getStart(sourceFile),
          node.getEnd(),
          ts.isJsxAttribute(node.parent) ? `{${replacement}}` : replacement,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!edits.length) return 0;
  const code = viewCodeOf(file);
  if (!code) return 0;

  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }

  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const insertAt = imports.length
    ? imports[imports.length - 1].getEnd()
    : 0;
  const footer =
    `\n\nimport { createPageTranslator } from '@/i18n';\n\n` +
    `const t = createPageTranslator(${JSON.stringify(code)});\n`;
  output = `${output.slice(0, insertAt)}${footer}${output.slice(insertAt)}`;
  fs.writeFileSync(file, output);
  return edits.length;
}

let files = 0;
let replacements = 0;
for (const file of walk(VIEWS_ROOT)) {
  const count = rewrite(file);
  if (count) {
    files += 1;
    replacements += count;
    console.log(`${path.relative(ROOT, file)}: ${count}`);
  }
}
console.log(`[page-i18n] files=${files} replacements=${replacements}`);
