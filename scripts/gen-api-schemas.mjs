#!/usr/bin/env node
/**
 * 按 API 路径从 Swagger 2.0 规范生成 zod schema。
 *
 * 用法：
 *   node scripts/gen-api-schemas.mjs --path /nc/bom/packBomMatrix
 *   node scripts/gen-api-schemas.mjs --path /nc/bom/packBomMatrix --out src/api/schemas/nc/packBomMatrix.ts
 *   node scripts/gen-api-schemas.mjs --path /a --path /b --method post
 *   node scripts/gen-api-schemas.mjs --def ncBean.PackBomMatrix   # 直接点 definition 名
 *
 * 规范来源优先级：--spec <文件> > 环境变量 APIDOCS_URL > 内置默认地址。
 * 规范是内网的，所以生成物要入库，构建时不依赖网络。
 *
 * ── 为什么要这样生成（踩过的坑，别改回去）──────────────────────
 * 1. **所有字段 `.nullish()`、对象 `.loose()`**：Swagger 2.0 完全不标 nullable
 *    （全规范 0/7490 个属性有 nullable 标记），但后端实际会返回 `null`、缺字段、
 *    多余字段。实测直译（不加 nullish）在 Employee 上报 56151 处错误。
 * 2. **顶层 schema 不加 `.nullish()`**：响应主体不会是 null，加了会让 data 多出 null。
 * 3. **`$ref` 指向 `XxxSchema` 常量而不是 type**：`z.lazy(() => Xxx)` 会报 TS2693。
 * 4. **递归自引用必须用 `interface` 承载类型**：`type X = { children: X[] }` 报 TS2456
 *    循环引用；`interface X { children: X[] }` 合法。schema 侧用
 *    `as unknown as z.ZodType<X>` 打断循环推断（否则 TS7022）。
 * 5. **`additionalProperties` 是字典**（如 `ColorMatch`/`SizeMatch`）：要生成
 *    `z.record(z.string(), <value>)`；其指向的定义可能是空 `{}`（= 任意值）。
 * 6. **definition 可能没有 `type` 字段**：Swagger 2.0 在有 `properties` 时常省略
 *    `type: 'object'`。判类型必须 `node.type ?? (node.properties ? 'object' : undefined)`，
 *    否则会全部落到 `z.unknown()` —— **校验看着全过，实际什么都没校验**（假阳性）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_SPEC_URL = 'http://boda.bj.company/apidocs.json';

// ─── 参数解析 ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = {paths: [], defs: [], out: null, spec: null, method: null};
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') opts.paths.push(argv[++i]);
    else if (a === '--def') opts.defs.push(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--spec') opts.spec = argv[++i];
    else if (a === '--method') opts.method = argv[++i].toLowerCase();
    else if (a === '--help' || a === '-h') {
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
        process.exit(0);
    } else {
        console.error(`未知参数: ${a}`);
        process.exit(1);
    }
}
if (!opts.paths.length && !opts.defs.length) {
    console.error('至少要给一个 --path 或 --def');
    process.exit(1);
}

// ─── 读取规范 ───────────────────────────────────────────────
async function loadSpec() {
    if (opts.spec) {
        return JSON.parse(fs.readFileSync(path.resolve(ROOT, opts.spec), 'utf8'));
    }
    const url = process.env.APIDOCS_URL || DEFAULT_SPEC_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`拉取规范失败: ${url} → HTTP ${res.status}`);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        // 内网地址常被前端路由兜底成 index.html，返回 200 但内容是 HTML
        throw new Error(
            `规范不是合法 JSON（前 120 字符）：${text.slice(0, 120)}\n` +
            '如果是 HTML，说明这个地址被前端路由兜底了，不是真的规范地址。',
        );
    }
}

const spec = await loadSpec();
const defs = spec.definitions ?? {};
if (!Object.keys(defs).length) {
    throw new Error('规范里没有 definitions，可能不是 Swagger 2.0');
}

// ─── 命名 ───────────────────────────────────────────────────
/** definition 名 → TS 标识符：ncBean.PackBomMatrix → NcBeanPackBomMatrix */
/**
 * definition 名 → TS 标识符，**去掉包名前缀**。
 *
 *   ncBean.PackBomMatrix         → PackBomMatrix
 *   ncBean.PackBomMatrixDetail   → PackBomMatrixDetail
 *   ncBean.PackBomMatrix.ColorMatch → PackBomMatrixColorMatch（保留父名，见下）
 *
 * 规则：去掉第一段（包名，如 `ncBean` / `planBean` / `configBean`），其余段拼成大驼峰。
 *
 * 为什么不只取最后一段：`ncBean.PackBomMatrix.ColorMatch` 的后段是 `ColorMatch`，
 * 太通用 —— 一旦某个接口同时带上 `Xxx.ColorMatch` 与 `Yyy.ColorMatch` 就会撞名。
 * 保留父名（`PackBomMatrixColorMatch`）既满足了「不要包名」，又不会互相顶掉。
 */
function toIdent(name) {
    const parts = name.split('.');
    // 只有一段（没有包名）时原样用；否则丢掉第一段包名
    const body = parts.length > 1 ? parts.slice(1) : parts;
    return body
        .join('.')
        .split(/[.\-_\s]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('');
}

// ─── $ref 收集（递归闭包）────────────────────────────────────
function collectRefs(node, out = new Set()) {
    if (!node || typeof node !== 'object') return out;
    if (node.$ref) {
        const ref = node.$ref.split('/').pop();
        if (!out.has(ref)) {
            out.add(ref);
            collectRefs(defs[ref], out);
        }
        return out;
    }
    if (Array.isArray(node)) {
        node.forEach((n) => collectRefs(n, out));
        return out;
    }
    for (const v of Object.values(node)) collectRefs(v, out);
    return out;
}

/** 是否自引用（直接或间接），决定用 interface 还是 type */
function isSelfRef(name, seen = new Set()) {
    if (seen.has(name)) return false;
    seen.add(name);
    const refs = [...collectRefs(defs[name])];
    if (refs.includes(name)) return true;
    return refs.some((r) => isSelfRef(r, seen));
}

// ─── 节点类型判定 ───────────────────────────────────────────
function nodeType(node) {
    if (!node) return undefined;
    if (node.type) return node.type;
    if (node.properties) return 'object';
    if (node.additionalProperties) return 'object';
    // 空定义 {} = 任意值
    if (Object.keys(node).length === 0) return 'any';
    return undefined;
}

// ─── 生成 zod 代码 ──────────────────────────────────────────
function toZod(node, indent = '  ') {
    if (!node) return 'z.unknown()';
    if (node.$ref) return `z.lazy(() => ${toIdent(node.$ref.split('/').pop())}Schema)`;

    const t = nodeType(node);
    switch (t) {
        case 'string':
            return 'z.string().nullish()';
        case 'integer':
            return 'z.number().int().nullish()';
        case 'number':
            return 'z.number().nullish()';
        case 'boolean':
            return 'z.boolean().nullish()';
        case 'array':
            return `z.array(${toZod(node.items, indent)}).nullish()`;
        case 'object': {
            const props = Object.entries(node.properties ?? {});
            // 有 additionalProperties 而没 properties ⇒ 字典
            if (!props.length && node.additionalProperties) {
                const value = node.additionalProperties === true
                    ? 'z.unknown()'
                    : toZod(node.additionalProperties, indent);
                return `z.record(z.string(), ${value}).nullish()`;
            }
            if (!props.length) return 'z.record(z.string(), z.unknown()).nullish()';
            const lines = props.map(([k, v]) => {
                const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
                const desc = v.description ? ` // ${v.description.replace(/[\r\n]+/g, ' ')}` : '';
                return `${indent}  ${key}: ${toZod(v, indent + '  ')},${desc}`;
            });
            return `z.object({\n${lines.join('\n')}\n${indent}}).loose().nullish()`;
        }
        // 空定义 `{}` = 任意值
        case 'any':
        default:
            return 'z.unknown()';
    }
}

// ─── 生成 TS 类型（自引用时必须用 interface）──────────────────
function toTsType(node, indent = '  ') {
    if (!node) return 'unknown';
    if (node.$ref) return toIdent(node.$ref.split('/').pop());

    const t = nodeType(node);
    const nullable = (s) => `${s} | null`;
    switch (t) {
        case 'string':
            return 'string | null';
        case 'integer':
        case 'number':
            return 'number | null';
        case 'boolean':
            return 'boolean | null';
        case 'array':
            return nullable(`Array<${toTsType(node.items, indent)}>`);
        case 'object': {
            const props = Object.entries(node.properties ?? {});
            if (!props.length && node.additionalProperties) {
                const value = node.additionalProperties === true
                    ? 'unknown'
                    : toTsType(node.additionalProperties, indent);
                return nullable(`Record<string, ${value}>`);
            }
            if (!props.length) return nullable('Record<string, unknown>');
            const lines = props.map(([k, v]) => {
                const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
                return `${indent}  ${key}?: ${toTsType(v, indent + '  ')};`;
            });
            return `{\n${lines.join('\n')}\n${indent}}`;
        }
        default:
            return 'unknown';
    }
}

// ─── 从 API 路径解析出响应 schema 节点 ───────────────────────
function resolvePathNode(apiPath, method) {
    const item = spec.paths?.[apiPath];
    if (!item) {
        const similar = Object.keys(spec.paths ?? {}).filter((k) => k.toLowerCase().includes(apiPath.split('/').pop().toLowerCase()));
        throw new Error(`路径不存在: ${apiPath}\n${similar.length ? '相似路径:\n  ' + similar.join('\n  ') : ''}`);
    }
    const methods = Object.keys(item).filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m));
    const picked = method ? [method] : methods;
    const nodes = [];
    for (const m of picked) {
        const op = item[m];
        if (!op) throw new Error(`路径 ${apiPath} 不支持 ${m.toUpperCase()}`);
        const schema = op.responses?.['200']?.schema;
        if (!schema) {
            throw new Error(`${m.toUpperCase()} ${apiPath} 的 200 响应没有 schema`);
        }
        nodes.push({method: m, schema, summary: op.summary ?? ''});
    }
    return nodes;
}

// ─── 收集所有需要的 definition ───────────────────────────────
const roots = new Set(opts.defs);
const endpoints = [];
for (const p of opts.paths) {
    const list = resolvePathNode(p, opts.method);
    for (const l of list) {
        endpoints.push({path: p, ...l});
        // 响应是数组时，根是 items
        const root = l.schema.type === 'array' ? l.schema.items : l.schema;
        if (root?.$ref) roots.add(root.$ref.split('/').pop());
        else if (!root) throw new Error(`${p} 的响应 schema 无法解析`);
        else {
            // 内联 schema（没有 $ref）：直接收集其中的引用
            collectRefs(root).forEach((r) => roots.add(r));
        }
    }
}
for (const r of opts.defs) {
    if (!defs[r]) throw new Error(`definition 不存在: ${r}`);
}

// 闭包
const all = new Set();
for (const r of roots) {
    all.add(r);
    collectRefs(defs[r], all);
}
// 稳定顺序：先按名字排，避免每次生成 diff 抖动
const ordered = [...all].sort();

// ─── 撞名检查 ───────────────────────────────────────────────
// 去掉包名后，不同包里同名/同尾的 definition 会算出同一个标识符。
// 例：planBean.YupaiOrder 与 qcBean.YupaiOrder 都变成 YupaiOrder —— 必须提前拦下，
// 否则生成的 TS 里会有两个同名 const，报 TS2451 重定义。
const identOwners = new Map();
const clashes = [];
for (const name of ordered) {
    const ident = toIdent(name);
    const prev = identOwners.get(ident);
    if (prev) clashes.push({ident, a: prev, b: name});
    else identOwners.set(ident, name);
}
if (clashes.length) {
    console.error('✗ 去掉包名后有标识符冲突，生成的代码会重复定义：\n');
    for (const c of clashes) {
        console.error(`  ${c.ident}\n    ← ${c.a}\n    ← ${c.b}`);
    }
    console.error(
        '\n处理方式：减少 --path（分批生成到不同文件），或只生成其中一个 definition。',
    );
    process.exit(1);
}

// ─── 拼装输出 ───────────────────────────────────────────────
const blocks = ordered.map((name) => {
    const ident = toIdent(name);
    const body = toZod(defs[name], '').replace(/\.nullish\(\)$/, '');
    if (isSelfRef(name)) {
        return [
            `export interface ${ident} ${toTsType(defs[name], '')}`,
            '',
            `export const ${ident}Schema: z.ZodType<${ident}> = ${body} as unknown as z.ZodType<${ident}>;`,
        ].join('\n');
    }
    return [
        `export const ${ident}Schema = ${body};`,
        `export type ${ident} = z.output<typeof ${ident}Schema>;`,
    ].join('\n');
});

const endpointDoc = endpoints
    .map((e) => `//   ${e.method.toUpperCase()} ${e.path}${e.summary ? ' — ' + e.summary : ''}`)
    .join('\n');

const header = `// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: ${spec.info?.title ?? 'swagger'} v${spec.info?.version ?? '?'} (Swagger ${spec.swagger ?? '?'})
// 生成时间: ${new Date().toISOString()}
//
// 覆盖的接口:
${endpointDoc}
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';
`;

const content = header + '\n' + blocks.join('\n\n') + '\n';

// ─── 输出 ───────────────────────────────────────────────────
const outPath = opts.out
    ? path.resolve(ROOT, opts.out)
    : path.resolve(ROOT, 'src/api/schemas/generated.ts');

fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, content, 'utf8');

console.log(`✓ 已生成 ${path.relative(ROOT, outPath)}`);
console.log(`  接口 ${endpoints.length} 个，schema ${ordered.length} 个（含依赖闭包）`);
console.log(`  根 definition: ${[...roots].sort().join(', ')}`);
const selfRefs = ordered.filter((n) => isSelfRef(n));
if (selfRefs.length) {
    console.log(`  递归自引用（生成 interface）: ${selfRefs.map(toIdent).join(', ')}`);
}
