#!/usr/bin/env node
/**
 * 从每个页面的 bridged.ts 提取 guide.summary，生成同目录 description.md。
 *
 * 单一事实来源是 bridged.ts 中给 agent 看的 summary，description.md 只是导航阶段
 * 的预生成产物：菜单还没打开时，模型读不到页面桥，但需要一段功能描述来选菜单。
 *
 * npm run dev / npm run build 会自动执行本脚本。也可以手动：
 *   npm run menu:descriptions
 *   npm run menu:descriptions:check   # CI 检查生成物是否最新
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

/** 只认 TypeScript 里可静态求值的字符串（含相邻字面量用 + 拼接） */
function staticString(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function summaryOf(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const summaries = [];

  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'summary') ||
        (ts.isStringLiteralLike(node.name) && node.name.text === 'summary'))
    ) {
      const value = staticString(node.initializer);
      if (value === null) {
        throw new Error(`${file}: guide.summary 必须是可静态求值的字符串`);
      }
      summaries.push(value.replace(/\s+/g, ' ').trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (summaries.length === 0) {
    throw new Error(`${file}: 没有找到 guide.summary，无法生成菜单描述`);
  }
  if (summaries.length > 1) {
    throw new Error(`${file}: 找到 ${summaries.length} 个 summary，无法判断哪个是菜单描述`);
  }
  if (!summaries[0]) {
    throw new Error(`${file}: guide.summary 为空`);
  }
  return summaries[0];
}

export function syncMenuDescriptions({root = ROOT, check = false} = {}) {
  const viewsRoot = path.join(root, 'src/pages/views');
  const bridgeFiles = walk(viewsRoot).filter((file) => path.basename(file) === 'bridged.ts');
  const descriptionFiles = walk(viewsRoot).filter((file) => path.basename(file) === 'description.md');
  const errors = [];
  let written = 0;
  let unchanged = 0;
  let removed = 0;

  for (const bridgeFile of bridgeFiles) {
    try {
      const summary = summaryOf(fs.readFileSync(bridgeFile, 'utf8'), bridgeFile);
      const output = path.join(path.dirname(bridgeFile), 'description.md');
      const next = `${summary}\n`;
      const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
      if (current === next) {
        unchanged += 1;
      } else if (check) {
        errors.push(`${path.relative(root, output)} 不是最新内容，请运行 npm run menu:descriptions`);
      } else {
        fs.writeFileSync(output, next);
        written += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const descriptionFile of descriptionFiles) {
    const bridgeFile = path.join(path.dirname(descriptionFile), 'bridged.ts');
    if (fs.existsSync(bridgeFile)) continue;
    if (check) {
      errors.push(
        `${path.relative(root, descriptionFile)} 没有对应的 bridged.ts，请运行 npm run menu:descriptions`,
      );
    } else {
      fs.unlinkSync(descriptionFile);
      removed += 1;
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  return {bridges: bridgeFiles.length, written, unchanged, removed};
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = syncMenuDescriptions({check: process.argv.includes('--check')});
    console.log(
      `[menu-descriptions] bridged=${result.bridges} written=${result.written} ` +
        `unchanged=${result.unchanged} removed=${result.removed}`,
    );
  } catch (error) {
    console.error(`[menu-descriptions] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
