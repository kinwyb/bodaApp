/**
 * UI 快照紧凑编码（ui-snap-c）。
 *
 * 将 UISnapshot / UISnapshotPatch 编码为行式紧凑文本，替代原始 JSON 传输。
 *
 * 压缩原理：
 * 1. 行式文本替代 JSON → 消除 37% 的结构开销（引号、花括号、冒号）
 * 2. 列目录 TSV 化 → 对象数组变表头+数据行，消除键名重复
 * 3. 参数混合编码 → name:type:options 内联（模型直接看到），hint 按结构去重
 * 4. 默认值省略 → false / 空数组不出现（sorts 空时用 srt:- 显式标记）
 *
 * hint 去重策略：参数名+类型+required+options 相同即共享一个 hint 定义。
 * hint 中的表特定信息（关键列名、rowKey）与 ## tables 段重复，
 * action ID 前缀（list.page / items.page）已经区分了表，hint 只需说明参数用途。
 *
 * 零丢失字段：active 行数据、sorts、activeRowIndex、selection、filters、
 * readable/visible、grouped、summaryRow、rows/window、query、form、options。
 *
 * 格式规范见 `docs/skills/ui-operation/SKILL.md`（agent 侧就是照它读的）；
 * 字段口径以 `../protocol/ui.ts` 为准 —— 两边都要改：这里加标记、那边补说明，
 * 否则模型会看到一个没有解释的字段（`waitConfirm` 就是这么补上的）。
 */

import type {
  UIAction,
  UIActionParam,
  UIColumn,
  UIDataSummary,
  UIField,
  UIFieldPatch,
  UIForm,
  UIFormPatch,
  UIGuide,
  UISelection,
  UISnapshot,
  UISnapshotPatch,
  UITableFilter,
  UITablePatch,
} from '../protocol';

// ── 安全编码辅助 ─────────────────────────────────────────

/**
 * 转义行式文本中的危险字符。
 *
 * 换行符会破坏「一行一条记录」的约定，制表符会破坏 TSV 列对齐。
 * 值本身含反斜杠时先转义反斜杠，避免 `\\n` 被误解为换行。
 */
function escLine(value: unknown): string {
  const str = String(value);
  if (!str.includes('\n') && !str.includes('\t') && !str.includes('\\')) return str;
  return str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

/** 值含 | 或 = 时用双引号包裹，同时转义换行/制表符 */
function pipeVal(value: unknown): string {
  const str = escLine(value);
  if (str.includes('|') || str.includes('=') || str.includes('"')) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

/**
 * 转义 hint 里的结构字符。
 *
 * hint 的容器是 `name(hint)`、参数之间用 `,` 分隔，所以 hint 内部出现的
 * `)` `(` `,` 必须转义，否则会提前闭合或破坏参数分隔。
 */
function encHintBody(hint: string): string {
  return escLine(hint)
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/,/g, '\\,');
}

/** 筛选值：含 ; = , | " 时用双引号包裹（flt 段以 ; 分隔、= 赋值、, 分隔数组） */
function encFilterValue(value: string): string {
  const str = escLine(value);
  if (/[;=,|"]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

// ── 参数词典构建（按结构去重） ────────────────────────────

/**
 * 参数的结构签名：name + type + required + options。
 *
 * 不含 hint：hint 中的表特定信息（关键列名、rowKey）与 ## tables 段重复，
 * action ID 前缀已经区分了表。结构相同 → hint 用途相同 → 共享一个定义。
 */
function paramStructSig(params: UIActionParam[]): string {
  return params
    .map((p) => `${p.name}:${p.type}:${p.required ?? false}:${(p.options ?? []).join(',')}`)
    .join('|');
}

/**
 * 为结构签名生成可读的模板 ID。
 * 模型看到 p.page / p.row / p.rowIds 就能猜到用途。
 */
function readableTemplateId(params: UIActionParam[]): string | null {
  if (params.length === 0) return null;
  const first = params[0].name;
  if (params.length === 3 && first === 'offset' && params[1].name === 'limit') return 'p.page';
  if (params.length === 2 && first === 'rowId' && params[1].name === 'fields') return 'p.row';
  if (params.length === 1 && first === 'rowIds') return 'p.rowIds';
  if (params.length === 2 && first === 'field' && params[1].name === 'value') return 'p.fv';
  if (params.length === 1 && first === 'field') return 'p.field';
  if (params.length === 2 && first === 'field' && params[1].name === 'match') return 'p.fm';
  return null;
}

function buildHintDict(actions: UIAction[]): {
  defs: Map<string, UIActionParam[]>;
  refs: Map<string, string>;
} {
  const defs = new Map<string, UIActionParam[]>();
  const refs = new Map<string, string>();
  const sigToId = new Map<string, string>();

  for (const action of actions) {
    if (!action.params?.length) continue;
    const sig = paramStructSig(action.params);

    if (sigToId.has(sig)) {
      refs.set(action.id, sigToId.get(sig)!);
      continue;
    }

    const id = readableTemplateId(action.params) ?? `p.${action.id}`;
    sigToId.set(sig, id);
    refs.set(action.id, id);
    defs.set(id, action.params);
  }

  return { defs, refs };
}

// ── Guide 编码 ───────────────────────────────────────────

function encGuide(guide: UIGuide): string[] {
  const lines: string[] = [];
  if (guide.summary) lines.push(`@sum ${escLine(guide.summary)}`);
  if (guide.steps) for (const step of guide.steps) lines.push(`@step ${escLine(step)}`);
  if (guide.terms) {
    for (const [key, value] of Object.entries(guide.terms)) {
      lines.push(`@term ${escLine(key)} = ${escLine(value)}`);
    }
  }
  if (guide.cautions) for (const caution of guide.cautions) lines.push(`@caut ${escLine(caution)}`);
  return lines;
}

// ── Action 编码（name:type:options 内联 + hint 引用） ────

function encAction(action: UIAction, refs: Map<string, string>): string {
  const parts = [`a|${action.id}|${pipeVal(action.label)}`];

  if (action.group && action.group !== 'toolbar') parts.push(`g=${action.group}`);
  if (action.danger) parts.push('danger');
  /*
   * 执行后停在用户确认（回执里的 result 只是「已触发」）。
   * 写全名而不是 `wait`：这里没有图例字典，孤零零一个词模型得猜，
   * 而看错的代价是它把「弹了个框」当成「删完了」。
   */
  if (action.waitConfirm) parts.push('waitConfirm');
  if (action.disabled) parts.push('dis');
  if (action.disabledReason) parts.push(`disR=${pipeVal(action.disabledReason)}`);
  if (action.returns) parts.push(`ret=${action.returns}`);

  if (action.params?.length) {
    const inline = action.params
      .map((p) => {
        let s = `${p.name}:${p.type}${p.required ? '!' : ''}`;
        if (p.options?.length) s += `{${p.options.join(',')}}`;
        return s;
      })
      .join(',');
    const ref = refs.get(action.id);
    parts.push(`pm=[${inline}]${ref ? `→${ref}` : ''}`);
  }

  return parts.join('|');
}

function encHintDef(id: string, params: UIActionParam[]): string {
  const hints = params.map((p) => `${p.name}(${encHintBody(p.hint ?? '')})`).join(',');
  return `P|${id}|${hints}`;
}

// ── Query 编码（页面级查询条件） ─────────────────────────

function encQueryFields(fields: UIField[]): string[] {
  return fields.map((f) => {
    const parts = [`q|${f.id}|${pipeVal(f.label)}|${f.type}`];
    if (f.value !== undefined && f.value !== null) parts.push(`val=${pipeVal(f.value)}`);
    if (f.required) parts.push('rq');
    if (f.readOnly) parts.push('ro');
    if (f.options?.length) parts.push(`opts=[${f.options.join(',')}]`);
    if (f.hint) parts.push(`h=${pipeVal(f.hint)}`);
    if (f.errors?.length) parts.push(`err=${f.errors.map(escLine).join(';')}`);
    return parts.join('|');
  });
}

function encQueryPatch(patches: UIFieldPatch[]): string[] {
  return patches.map((p) => {
    const parts = [`q|${p.id}`];
    if (p.value !== undefined) parts.push(`val=${pipeVal(p.value)}`);
    if (p.readOnly !== undefined) parts.push(`ro=${p.readOnly}`);
    if (p.errors?.length) parts.push(`err=${p.errors.map(escLine).join(';')}`);
    return parts.join('|');
  });
}

// ── Form 编码（完整快照 mode=form 时） ───────────────────

function encForm(form: UIForm): string[] {
  const lines: string[] = [];
  const parts = [`form|id=${form.id}|t=${pipeVal(form.title)}|m=${form.mode}`];
  if (form.recordId) parts.push(`rec=${pipeVal(form.recordId)}`);
  if (form.dirty !== undefined) parts.push(`dirty=${form.dirty}`);
  if (form.errors?.length) parts.push(`err=${form.errors.map(escLine).join(';')}`);
  lines.push(parts.join('|'));

  for (const f of form.fields) {
    const fp = [`  fld|${f.id}|${pipeVal(f.label)}|${f.type}`];
    if (f.value !== undefined && f.value !== null) fp.push(`val=${pipeVal(f.value)}`);
    if (f.required) fp.push('rq');
    if (f.readOnly) fp.push('ro');
    if (f.options?.length) fp.push(`opts=[${f.options.join(',')}]`);
    if (f.hint) fp.push(`h=${pipeVal(f.hint)}`);
    if (f.errors?.length) fp.push(`err=${f.errors.map(escLine).join(';')}`);
    lines.push(fp.join('|'));
  }
  return lines;
}

// ── 列目录 TSV ──────────────────────────────────────────

function encColumnsTSV(columns: UIColumn[]): string[] {
  if (columns.length === 0) return [];
  const lines = ['f\tt\ty\tfi\th'];
  for (const col of columns) {
    const parts = [escLine(col.field), escLine(col.title)];
    if (col.type || col.filter || col.hint) parts.push(col.type ?? '');
    if (col.filter || col.hint) parts.push(col.filter ?? '');
    if (col.hint) parts.push(escLine(col.hint));
    while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
    lines.push(parts.join('\t'));
  }
  return lines;
}

// ── 表元数据 + active + 数据行 ──────────────────────────

function encSel(sel: UISelection): string {
  // 三段式才能消歧：count, activeRowId(无则 -), rowIds。只在有选中集合时才带后两段，
  // 否则 `sel:2,A,B` 会被误读成 activeRowId=A、rowIds=[B]。
  const count = String(sel.count);
  if (sel.rowIds.length > 0) {
    return `sel:${count},${sel.activeRowId ?? '-'},${sel.rowIds.join(',')}`;
  }
  if (sel.activeRowId) return `sel:${count},${sel.activeRowId}`;
  return `sel:${count}`;
}

function encFilters(filters: UITableFilter[]): string {
  return `flt:${filters
    .map((f) => {
      const value = Array.isArray(f.value)
        ? f.value.map(encFilterValue).join(',')
        : encFilterValue(f.value);
      return `${f.field}=${value}`;
    })
    .join(';')}`;
}

function encSorts(sorts: { field: string; order: 'asc' | 'desc' }[]): string {
  if (sorts.length === 0) return 'srt:-';
  return `srt:${sorts.map((s) => `${s.field}:${s.order}`).join(',')}`;
}

function encActiveRow(active: Record<string, unknown>): string {
  return `act|${Object.entries(active).map(([k, v]) => `${k}=${pipeVal(v)}`).join('|')}`;
}

function encDataRows(
  rows: Record<string, unknown>[],
  win: { offset: number; limit: number },
  columns: UIColumn[],
): string[] {
  const lines = [`win|off=${win.offset}|lim=${win.limit}|n=${rows.length}`];
  if (rows.length > 0) {
    const fields = columns.map((c) => c.field);
    for (const row of rows) {
      lines.push(fields.map((f) => (row[f] == null ? '' : escLine(row[f]))).join('\t'));
    }
  }
  return lines;
}

/** 编码完整快照中的单张表（UIDataSummary：含 rowKey、columns、active、rows） */
function encTableFull(table: UIDataSummary): string[] {
  const lines: string[] = [];
  const flags: string[] = [];

  const meta = [`tbl|${table.name}|${table.rowKey}|${table.total}|${table.loaded}`];

  if (table.sorts) flags.push(encSorts(table.sorts));
  if (table.grouped) flags.push('grp');
  if (table.selection) flags.push(encSel(table.selection));
  if (table.filters?.length) flags.push(encFilters(table.filters));
  if (table.readable === false) flags.push('rd-');
  if (table.readableReason) flags.push(`rdR=${pipeVal(table.readableReason)}`);
  if (table.visible === false) flags.push('vis-');
  if (table.activeRowIndex != null) flags.push(`arIdx=${table.activeRowIndex}`);
  if (table.summaryRow != null) flags.push(`sumR=${table.summaryRow}`);

  if (flags.length) meta.push(flags.join('|'));
  lines.push(meta.join('|'));

  if (table.columns?.length) lines.push(...encColumnsTSV(table.columns));
  if (table.active) lines.push(encActiveRow(table.active));
  if (table.rows?.length && table.window) {
    lines.push(...encDataRows(table.rows, table.window, table.columns));
  }

  return lines;
}

/** 编码补丁中的单张表（UITablePatch：只有变化的字段，无 rowKey/columns/active/rows） */
function encTablePatch(table: UITablePatch): string[] {
  const lines: string[] = [];
  const flags: string[] = [];

  const parts = [`tbl|${table.name}`];
  if (table.total != null) flags.push(`tot=${table.total}`);
  if (table.loaded != null) flags.push(`ld=${table.loaded}`);
  if (table.sorts) flags.push(encSorts(table.sorts));
  if (table.grouped) flags.push('grp');
  if (table.selection) flags.push(encSel(table.selection));
  if (table.filters?.length) flags.push(encFilters(table.filters));
  if (table.readable === false) flags.push('rd-');
  if (table.readableReason) flags.push(`rdR=${pipeVal(table.readableReason)}`);
  if (table.visible === false) flags.push('vis-');
  if (table.activeRowIndex != null) flags.push(`arIdx=${table.activeRowIndex}`);
  if (table.summaryRow != null) flags.push(`sumR=${table.summaryRow}`);

  if (flags.length) parts.push(flags.join('|'));
  lines.push(parts.join('|'));

  return lines;
}

// ── 表单补丁编码 ────────────────────────────────────────

function encFormPatch(form: UIFormPatch): string[] {
  const lines: string[] = [];
  const parts = [`form|id=${form.id}`];
  if (form.title) parts.push(`t=${pipeVal(form.title)}`);
  if (form.mode) parts.push(`m=${form.mode}`);
  if (form.recordId !== undefined) parts.push(`rec=${form.recordId ?? ''}`);
  if (form.dirty !== undefined) parts.push(`dirty=${form.dirty}`);
  if (form.errors?.length) parts.push(`err=${form.errors.map(escLine).join(';')}`);
  lines.push(parts.join('|'));

  if (form.fields) {
    for (const field of form.fields) {
      const fp = [`  fld|id=${field.id}`];
      if (field.value !== undefined) fp.push(`val=${pipeVal(field.value)}`);
      if (field.errors?.length) fp.push(`err=${field.errors.map(escLine).join(';')}`);
      if (field.readOnly !== undefined) fp.push(`ro=${field.readOnly}`);
      lines.push(fp.join('|'));
    }
  }
  return lines;
}

// ── 公开 API ─────────────────────────────────────────────

/**
 * 编码完整快照为紧凑文本（ui-snap-c 格式）。
 *
 * 零丢失：active 行数据、sorts、activeRowIndex、selection、filters、
 * readable/visible、grouped、summaryRow、rows/window、query、form、options 全部编码。
 *
 * @returns 行式文本字符串，约比原始 JSON 小 40%
 */
export function encodeSnapshot(snapshot: UISnapshot): string {
  const { defs, refs } = buildHintDict(snapshot.actions ?? []);
  const lines: string[] = [];

  lines.push(
    `!v=${snapshot.v} rev=${snapshot.rev} view=${snapshot.view} t="${escLine(snapshot.title ?? '')}" m=${snapshot.mode} fp=${snapshot.fp}`,
  );
  lines.push('');

  if (snapshot.guide) {
    lines.push('## guide');
    lines.push(...encGuide(snapshot.guide));
    lines.push('');
  }

  if (snapshot.actions?.length) {
    lines.push('## actions');
    for (const action of snapshot.actions) {
      lines.push(encAction(action, refs));
    }
    lines.push('');
  }

  if (defs.size > 0) {
    lines.push('## param-hints');
    for (const [id, params] of defs) {
      lines.push(encHintDef(id, params));
    }
    lines.push('');
  }

  if (snapshot.query?.length) {
    lines.push('## query');
    lines.push(...encQueryFields(snapshot.query));
    lines.push('');
  }

  if (snapshot.form) {
    lines.push('## form');
    lines.push(...encForm(snapshot.form));
    lines.push('');
  }

  if (snapshot.tables?.length) {
    lines.push('## tables');
    for (const table of snapshot.tables) {
      lines.push(...encTableFull(table));
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 编码快照补丁为紧凑文本。
 *
 * 与完整快照使用同一套编码规则，模型只需学一套格式。
 *
 * @returns 行式文本字符串
 */
export function encodePatch(patch: UISnapshotPatch): string {
  const lines: string[] = [];

  const headerParts = [`patch|view=${patch.view}|basedOn=${patch.basedOn}`];
  if (patch.mode) headerParts.push(`m=${patch.mode}`);
  lines.push(headerParts.join('|'));

  if (patch.query?.length) {
    lines.push(...encQueryPatch(patch.query));
  }

  if (patch.tables) {
    for (const table of patch.tables) {
      lines.push(...encTablePatch(table));
    }
  }

  if (patch.form) {
    lines.push(...encFormPatch(patch.form));
  }

  if (patch.enabled) {
    lines.push(`en=${patch.enabled.join(',')}`);
  }

  return lines.join('\n');
}
