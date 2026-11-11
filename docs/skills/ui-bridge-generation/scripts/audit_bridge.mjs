#!/usr/bin/env node
/**
 * 界面桥结构审计：检查“文件存在但没真正接入”的常见问题。
 *
 * 用法：
 *   node <skill>/scripts/audit_bridge.mjs V0189_V0279_V0280
 *   node <skill>/scripts/audit_bridge.mjs src/pages/views/V0277/V0354
 *   node <skill>/scripts/audit_bridge.mjs          # 扫描全部 bridged.ts
 *
 * 只做静态结构检查；业务语义、回执文案、真实交互仍按 references/checklist.md 人工验证。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const VIEWS_ROOT = path.join(ROOT, 'src/pages/views');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

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

function inspectBridge(file) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const summaries = [];
  const hookCalls = [];
  const properties = new Set();

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (/^use[A-Z]/.test(node.expression.text)) hookCalls.push(node.expression.text);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
        ? node.name.text
        : '';
      if (name) properties.add(name);
      if (name === 'summary') summaries.push(staticString(node.initializer));
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      properties.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    source,
    summary: summaries.length === 1 ? summaries[0]?.replace(/\s+/g, ' ').trim() : null,
    summaryCount: summaries.length,
    hookCalls,
    hasSnapshot: properties.has('snapshot'),
    hasHandlers: properties.has('handlers'),
    importsReact: /from\s+['"]react(?:-dom)?['"]/.test(source),
  };
}

function resolveTarget(arg) {
  if (!arg) return null;
  const direct = path.resolve(ROOT, arg);
  if (fs.existsSync(direct)) {
    return fs.statSync(direct).isDirectory() ? direct : path.dirname(direct);
  }
  if (/^V[0-9A-Z_]+$/i.test(arg)) {
    return path.join(VIEWS_ROOT, ...arg.split('_'));
  }
  throw new Error(`找不到目标：${arg}`);
}

function targetDirs(arg) {
  const direct = resolveTarget(arg);
  if (direct) return [direct];
  return [
    ...new Set(
      walk(VIEWS_ROOT)
        .filter((file) => path.basename(file) === 'bridged.ts')
        .map((file) => path.dirname(file)),
    ),
  ].sort();
}

const errors = [];
const warnings = [];
const dirs = targetDirs(process.argv[2]);

if (dirs.length === 0) {
  errors.push('没有找到任何 bridged.ts');
}

for (const dir of dirs) {
  const relative = path.relative(ROOT, dir);
  const indexFile = path.join(dir, 'index.tsx');
  const bridgeFile = path.join(dir, 'bridged.ts');
  const descriptionFile = path.join(dir, 'description.md');
  if (!fs.existsSync(indexFile)) errors.push(`${relative}: 缺少 index.tsx`);
  if (!fs.existsSync(bridgeFile)) {
    errors.push(`${relative}: 缺少 bridged.ts，页面不会进入 agent 导航`);
    continue;
  }

  const indexSource = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
  if (indexSource && !/\buseUIBridgeHost\s*\(/.test(indexSource)) {
    errors.push(`${relative}/index.tsx: 没有调用 useUIBridgeHost(view, bridge)`);
  }

  const bridge = inspectBridge(bridgeFile);
  if (bridge.summaryCount !== 1) {
    errors.push(`${relative}/bridged.ts: 必须恰好有一个可静态求值的 guide.summary`);
  } else if (!bridge.summary) {
    errors.push(`${relative}/bridged.ts: guide.summary 为空`);
  }
  if (bridge.hookCalls.length > 0) {
    errors.push(`${relative}/bridged.ts: 不应调用 React hook（发现 ${bridge.hookCalls.join(', ')}）`);
  }
  if (bridge.importsReact) {
    errors.push(`${relative}/bridged.ts: 不应 import React`);
  }
  if (!bridge.hasSnapshot) {
    errors.push(`${relative}/bridged.ts: 没有 snapshot`);
  }
  if (!bridge.hasHandlers) {
    errors.push(`${relative}/bridged.ts: 没有 handlers；有 actions 的页面必须能执行`);
  }

  if (!fs.existsSync(descriptionFile)) {
    errors.push(`${relative}: 缺少 description.md；运行 npm run menu:descriptions`);
  } else if (bridge.summary) {
    const actual = fs.readFileSync(descriptionFile, 'utf8').trim();
    if (actual !== bridge.summary) {
      errors.push(`${relative}/description.md: 与 guide.summary 不一致；运行 npm run menu:descriptions`);
    }
  }

  if (indexSource.includes('useUIBridgeDialog') && !walk(dir).some((file) => /Bridge\.ts$/.test(file) && path.basename(file) !== 'bridged.ts')) {
    warnings.push(`${relative}: 页面使用 useUIBridgeDialog，但没有找到独立的 *Bridge.ts`);
  }
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);

if (errors.length > 0) {
  console.error(`\n界面桥审计失败：${errors.length} 个 error，${warnings.length} 个 warning`);
  process.exit(1);
}
console.log(`界面桥审计通过：${dirs.length} 个页面，${warnings.length} 个 warning`);
