/**
 * 表格 → 界面桥的**通用适配层**。
 *
 * 解决的问题：页面想把表格交给 agent 时，得自己写「有哪些列、一共几行、按什么排序、
 * 怎么按行号取数据」—— 每页抄一遍，且很容易抄错（尤其是排序：它在表格内部，
 * 页面 state 里根本没有）。
 *
 * 现在页面只给**列定义**和**表格 ref**，其余全在这里：
 *
 * ```ts
 * const table = createTableBridge({
 *   columns: COLUMNS,                       // AppColumnDef[] 或 ColumnsDefine 都行
 *   readTable: () => tableRef.current,      // 取值函数，不持有实例
 * });
 * // 快照里 data: table.data()；动作拼 table.actions()；处理函数拼 table.handlers
 * ```
 *
 * 两条关键语义（用户与 agent 之间最容易对不上的地方）：
 *
 * 1. **行号 = 用户屏幕上的第几行**。`data.page({offset: 4, limit: 1})` 取到的就是用户说的
 *    「第 5 条」，因为 `getRowByIndex` 跟随表格的显示顺序（排序、分组都在表格里）。
 * 2. **快照不带数据行**。只给列目录 + 行数 + 排序，数据按需取：
 *    一次全塞进去既占上下文，又必然与用户屏幕上的顺序不一致。
 */

import type { ColumnSource, FilterTableApi } from '@/components/grid-table';
import { isBlank, toNumberOrZero, toStringOrEmpty } from '@/utils';
import type { UIAction, UIColumn, UIDataSummary } from '@/pages/agent/protocol';
import type { UIBridgeHandler } from './types';

/** 一次取多少行。默认小、上限也小：单条 ui_act 的结果不适合塞满上下文 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/** 列定义里可能出现的形状（原生列与项目列定义都覆盖） */
type ColumnLike = {
  field?: unknown;
  title?: unknown;
  dataType?: unknown;
  hint?: unknown;
  children?: unknown;
  columns?: unknown;
};

/**
 * 列的 `dataType` → 给模型的类型提示。
 *
 * 只做「够用」的映射：模型需要知道这一列能不能按大小比、是不是日期，
 * 不需要知道渲染成复选框还是标签。
 */
function toColumnType(dataType: unknown): UIColumn['type'] | undefined {
  if (dataType === 'int' || dataType === 'double' || dataType === 'number') return 'number';
  if (dataType === 'date') return 'date';
  if (dataType === 'boolean') return 'boolean';
  if (dataType === 'text') return 'text';
  return undefined;
}

/**
 * 列定义 → 列目录（**全部叶子列**，顺序与表格一致）。
 *
 * 两种写法都要认：`AppColumnDef[]` 的分组用 `children`，原生 `ColumnsDefine` 用 `columns`。
 * 只看叶子（有 `field` 的），分组表头本身不是一列。
 */
function collectColumns(columns: ColumnSource): UIColumn[] {
  const result: UIColumn[] = [];
  const seen = new Set<string>();
  const walk = (cols: unknown) => {
    if (!Array.isArray(cols)) return;
    for (const raw of cols) {
      if (typeof raw === 'string') {
        if (!seen.has(raw)) {
          seen.add(raw);
          result.push({ field: raw, title: raw });
        }
        continue;
      }
      if (!raw || typeof raw !== 'object') continue;
      const col = raw as ColumnLike;
      const nested = Array.isArray(col.children) ? col.children : col.columns;
      if (nested) {
        walk(nested);
        continue;
      }
      if (typeof col.field !== 'string' || !col.field || seen.has(col.field)) continue;
      seen.add(col.field);
      const rawTitle = col.title;
      const title =
        typeof rawTitle === 'function'
          ? String((rawTitle as () => string)())
          : String(rawTitle ?? col.field);
      const spec: UIColumn = { field: col.field, title };
      const type = toColumnType(col.dataType);
      if (type) spec.type = type;
      if (typeof col.hint === 'string' && col.hint) spec.hint = col.hint;
      result.push(spec);
    }
  };
  walk(columns);
  return result;
}

/** 解析 fields：数组 / JSON 字符串 / 逗号分隔都收；返回 null 表示「全部列」 */
function toFieldList(value: unknown): string[] | null {
  const pick = (item: unknown): string => toStringOrEmpty(item).trim();
  if (isBlank(value)) return null;
  if (Array.isArray(value)) {
    const list = value.map(pick).filter(Boolean);
    return list.length > 0 ? list : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    // 模型常先把数组序列化一遍（服务端只透传，不校验形状）
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
          const list = parsed.map(pick).filter(Boolean);
          return list.length > 0 ? list : null;
        }
      } catch {
        // 不是合法 JSON 就按分隔符处理，下面接着走
      }
    }
    const list = text.split(/[,，;；\s]+/).map(pick).filter(Boolean);
    return list.length > 0 ? list : null;
  }
  const one = pick(value);
  return one ? [one] : null;
}

/** 取整并夹到区间内（模型给 1e9 或 -5 都不该让页面去算半天） */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (isBlank(value)) return fallback;
  const num = Math.floor(toNumberOrZero(value));
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

/** 解析 rowIds：数组 / JSON 字符串 / 逗号分隔都收（模型常先序列化，服务端只透传不校验） */
function toRowIdList(value: unknown): string[] {
  const single = (item: unknown): string => (item == null ? '' : String(item).trim());
  if (Array.isArray(value)) return value.map(single).filter(Boolean);
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.map(single).filter(Boolean);
      } catch {
        // 不是合法 JSON 就按分隔符处理，下面接着走
      }
    }
    return text.split(/[,，;；\s]+/).map(single).filter(Boolean);
  }
  const one = single(value);
  return one ? [one] : [];
}

/**
 * 裁剪字段时**永远带上主键**。
 *
 * 行必须能自证身份：只给「数量、日期」却不给主键，模型拿到的是一堆认不出是谁的数字，
 * 想再查整行 / 选中 / 删改都得回头重取。所以主键不是可选项，其余列才是。
 * 主键本来就在列表里时不重复（有的表会把主键也当一列显示）。
 */
function withRowKey(fields: string[], rowKeyField: string): string[] {
  return fields.includes(rowKeyField) ? fields : [rowKeyField, ...fields];
}

/** 按列白名单裁剪一条记录（record 里可能有 Batchs 这类整棵子树，不能原样吐出去） */
function pickRecord(
  record: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  fields.forEach((field) => {
    picked[field] = record[field];
  });
  return picked;
}

export type TableBridgeOptions = {
  /**
   * 这张表的对象名，也是命令前缀：`order` → 取数 `order.page`、选中 `order.select`。
   *
   * **一页两表时必须给不同的名字**，否则命令 ID 撞在一起，模型分不清在读哪张表。
   * 单表页面不用管（默认 `data`，命令就是 `data.page`）。
   */
  name?: string;
  /**
   * 表格的列定义。给**原始定义**（`AppColumnDef[]`）能多拿到类型与提示；
   * 给 `buildColumns()` 的产物（`ColumnsDefine`）也能用，只是类型信息会少一些。
   */
  columns: ColumnSource;
  /**
   * 取表格实例的取值函数 —— 桥在「被调用的那一刻」才读，所以表格重建、页面刷新都不用重新装配。
   * 传 `() => tableRef.current` 即可。
   */
  readTable: () => FilterTableApi | null;
  /** 列上的业务提示（可选）：field → 说明。用于补 `hint` 字段里页面的私货 */
  columnHints?: Record<string, string>;
  /**
   * 行主键字段名（默认 `ID`），与表格的 `rowKey` 属性保持一致。
   *
   * 会作为 `data.rowKey` 告诉模型「rowId 的值来自哪个字段」—— 主键一般不显示在表格列里，
   * 所以这份信息在列目录里查不到。`<name>.row` 也用它反查整行。
   */
  rowKey?: string;
  /**
   * 选中行之后等页面把选中态落回 state（可选）。
   *
   * 表格那边的选中是**立刻**生效的（`selectRowsByKeys` 会写 ranges + cellPos），
   * 但页面工具栏的 disabled 通常读自己的 `activeRow` state，那要等下一次渲染。
   * 不等的话回执里的快照 `selection` 还是空的，模型会以为没选中、再点一次。
   *
   * 页面实现一般是「轮询自己的 activeRow 直到命中」（`waitForActiveRow`）。
   * 不填就表示页面不依赖回传的选中态，桥立刻回执。
   */
  waitSelected?: (rowId: string) => Promise<boolean>;
};

export type TableBridge = {
  /** 这张表的对象名（命令前缀）；页面拼 `tables` 段或写 guide 时要用 */
  name: string;
  /**
   * 快照里的 data 段：**目录**（列 + 行数 + 排序），不含数据行。
   *
   * `override.active` 给页面一个「换掉激活行」的口子：表格判定的激活行未必等于业务认可的
   * （点到底部统计行时，页面通常会把它当成「没有选中任何单据」）。不传就用表格自己的判定。
   * 无论哪来的，都会按列白名单裁剪，且补上 rowId。
   */
  data: (override?: { active?: Record<string, unknown> | null }) => UIDataSummary;
  /** 数据读取 + 选中行两条命令。拼进页面的 actions */
  actions: () => UIAction[];
  /** 对应处理函数。拼进页面的 handlers */
  handlers: Record<string, UIBridgeHandler>;
};

/**
 * 装配表格的通用桥能力。
 *
 * 只做「读」：选中、筛选、命令按钮属于页面业务，仍在页面自己的 bridged.ts 里。
 * 这样拆的理由是「读」有硬性要求（顺序必须等于用户屏幕），适合统一实现；
 * 「写」各有各的语义（改完要不要重新查库、要不要校验），不能一概而论。
 */
export function createTableBridge(options: TableBridgeOptions): TableBridge {
  const name = options.name?.trim() || 'data';
  const rowKeyField = options.rowKey?.trim() || 'ID';
  const pageCmd = `${name}.page`;
  const rowCmd = `${name}.row`;
  const selectCmd = `${name}.select`;
  const columns = collectColumns(options.columns);
  const hints = options.columnHints ?? {};
  if (Object.keys(hints).length > 0) {
    columns.forEach((column) => {
      const hint = hints[column.field];
      if (hint) column.hint = hint;
    });
  }
  /** 允许取的列（白名单）：record 里可能有 Batchs 这类整棵子树，不能原样吐出去 */
  const columnFields = columns.map((column) => column.field);

  const readTable = (): FilterTableApi | null => options.readTable();
  const displayInfo = () =>
    readTable()?.getDisplayInfo() ?? { rowCount: 0, sorts: [], grouped: false };

  const data = (
    override?: { active?: Record<string, unknown> | null },
  ): UIDataSummary => {
    const info = displayInfo();
    const table = readTable();
    const tableActive = table?.getActiveRow();
    const summary: UIDataSummary = {
      name,
      rowKey: rowKeyField,
      total: info.rowCount,
      loaded: info.rowCount,
      columns,
      sorts: info.sorts,
      grouped: info.grouped,
      activeRowIndex: tableActive?.record ? tableActive.rowIndex : null,
    };

    /*
     * 最后一行的性质要说清楚：统计行确实占一个行号（用户屏幕上看得见），
     * 但它是合计不是单据 —— 不说的话模型会把「共 3281 条」当成业务条数，多算一行。
     */
    const last = info.rowCount > 0 ? table?.getRowByIndex(info.rowCount - 1) : undefined;
    if (last?.isSummaryRow) summary.summaryRow = last.rowIndex;

    const hasOverride = override !== undefined && 'active' in override;
    const activeRecord = hasOverride ? override.active : tableActive?.record;
    if (activeRecord) {
      const picked = pickRecord(activeRecord, columnFields);
      // 行标识统一叫 rowId（与 data.page 的行一致），后续命令直接拿去用
      if (tableActive?.record) picked.rowId = tableActive.rowKey;
      summary.active = picked;
    }
    return summary;
  };

  const actions = (): UIAction[] => [
    {
      /*
       * 数据不在快照里，所以「取数据」必须是一条显式命令：
       * 只发 data 目录而不发读取入口，模型就只能猜「用户说的第 5 条到底是哪一条」。
       */
      id: pageCmd,
      label: '按显示行号取数据',
      group: 'row',
      readOnly: true,
      params: [
        {
          name: 'offset',
          type: 'number',
          required: true,
          hint: '起始显示行号，0 = 用户屏幕第 1 行（用户说「第 5 条」就传 4）',
        },
        {
          name: 'limit',
          type: 'number',
          hint: `取多少行，默认 ${DEFAULT_LIMIT}，上限 ${MAX_LIMIT}`,
        },
        {
          name: 'fields',
          type: 'text',
          hint: `只取这些列（逗号分隔，取值见 columns[].field）；不给 = 全部列。主键（${rowKeyField}）总是附带`,
        },
      ],
    },
    {
      /*
       * 「按主键取完整一行」——与取数分开的理由：
       *
       * `data.page` 只回列目录里的字段（轻量扫描用），而编辑 / 核对往往要看表格**没显示**的
       * 字段（主键、批量明细、状态位、内部备注）。两者的返回体量差一个量级，
       * 合成一条命令只会让模型在「顺手多给点」和「别把上下文塞爆」之间反复试。
       *
       * 主键而不是行号：行号随排序失效，主键不会。
       */
      id: rowCmd,
      label: '按主键取完整一行',
      group: 'row',
      readOnly: true,
      params: [
        {
          name: 'rowId',
          type: 'text',
          required: true,
          hint: `行主键值（就是 ${rowKeyField} 字段的值，取 ${pageCmd} 的 rowId）`,
        },
        {
          name: 'fields',
          type: 'text',
          hint: `只取这些字段（逗号分隔）；不给 = 整行全部字段，含表格未显示的列。主键（${rowKeyField}）总是附带`,
        },
      ],
    },
    {
      /*
       * 选中行也属于「表格的操作」，跟取数一样与业务无关：主键 → 显示行号的换算只有表格知道。
       * 绑在表名上是因为多表页面里「选中哪张表」必须明确，全局一个 selection.set 会有歧义。
       */
      id: selectCmd,
      label: '选中行',
      group: 'row',
      // 选中只改 selection 与激活行，列表数据、列目录、guide 都没变 —— 回整页快照是重复计费
      lightweight: true,
      params: [
        {
          name: 'rowIds',
          type: 'text',
          required: true,
          hint: `要选中的行 rowId，多个用逗号分隔（取 ${pageCmd} 或 ${name} 段 active.rowId）`,
        },
      ],
    },
  ];

  const handlers: Record<string, UIBridgeHandler> = {
    [pageCmd]: (params) => {
      const table = readTable();
      if (!table) {
        throw new Error('表格还没建好（页面可能仍在加载或已经切走），稍后重试或重新 ui_observe');
      }
      const info = table.getDisplayInfo();
      const total = info.rowCount;
      // 上界放到 total（而不是 total-1）：越界要**如实返回空**，模型才知道「没有第 101 行」，
      // 夹到 total-1 会凭空给它一行真实数据，反而像「第 101 行就是这条」
      const offset = clampInt(params.offset, 0, 0, Math.max(0, total));
      const limit = clampInt(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
      const wanted = toFieldList(params.fields);
      // 主键永远合法（它一般不显示在表格里，但就是一个可取的字段）
      const unknown =
        wanted?.filter((field) => field !== rowKeyField && !columnFields.includes(field)) ?? [];
      if (unknown.length > 0) {
        throw new Error(
          `没有这些列：${unknown.join('、')}。可用的列见快照 data.columns[].field`,
        );
      }
      // 主键必带（见 withRowKey）：不给 fields 时是全列 + 主键，给了就只给这些列 + 主键
      const fields = withRowKey(wanted ?? columnFields, rowKeyField);

      const rows: Array<Record<string, unknown>> = [];
      for (let index = offset; index < Math.min(offset + limit, total); index += 1) {
        const row = table.getRowByIndex(index);
        if (!row) continue;
        const record = row.record;
        // index 让模型能把结果对回「用户说的第几条」；rowId 是后续命令用的统一行标识，
        // 主键字段本身也在（withRowKey 必带）—— 一个是桥的名字、一个是业务字段名，值相同
        const picked: Record<string, unknown> = { index, rowId: row.rowKey };
        fields.forEach((field) => {
          picked[field] = record[field];
        });
        if (row.isGroupRow) picked.isGroupRow = true;
        if (row.isSummaryRow) picked.isSummaryRow = true;
        rows.push(picked);
      }

      return {
        name,
        offset,
        limit,
        total,
        count: rows.length,
        hasMore: offset + rows.length < total,
        sorts: info.sorts,
        rows,
      };
    },

    /*
     * 按主键取整行：**不做列白名单**（record 原样给，表格没显示的字段也在里面）。
     *
     * 传 `fields` 才裁剪；裁剪时不校验字段名 —— 完整记录里有什么字段模型事先并不知道，
     * 校验只会把它挡在门外。拼错的字段名会出现在返回的 `unknownFields` 里，让它自己发现。
     */
    [rowCmd]: (params) => {
      const table = readTable();
      if (!table) {
        throw new Error('表格还没建好（页面可能仍在加载或已经切走），稍后重试或重新 ui_observe');
      }
      const rowId = toStringOrEmpty(params.rowId).trim();
      if (!rowId) {
        throw new Error(
          `${rowCmd} 需要 rowId：从 ${pageCmd} 的 rows[].rowId 或 ${name} 段的 active.rowId 里取`,
        );
      }
      const row = table.getRowByKey(rowId);
      if (!row) {
        throw new Error(
          `没找到 ${rowKeyField}=${rowId} 的行：它可能已被筛掉、在收起的组里，或主键值写错。` +
          `先用 ${pageCmd} 按显示行号重新取一次`,
        );
      }
      const source = row.record;
      const wanted = toFieldList(params.fields);
      const result: Record<string, unknown> = {
        rowId: row.rowKey,
        index: row.rowIndex,
      };
      if (wanted) {
        result.record = pickRecord(source, withRowKey(wanted, rowKeyField));
        const unknownFields = wanted.filter((field) => !(field in source));
        if (unknownFields.length > 0) result.unknownFields = unknownFields;
      } else {
        result.record = {...source};
      }
      if (row.isGroupRow) result.isGroupRow = true;
      if (row.isSummaryRow) result.isSummaryRow = true;
      return result;
    },

    /*
     * 选中行：整份替换（不是追加），与表格自身的选中语义一致。
     *
     * 有效性判断交给表格：`selectRowsByKeys` 返回**实际命中数**，不在当前显示里的 rowId
     * （被筛掉、被收起的组里、主键写错）会被忽略。桥只负责把「命中数 < 请求数」翻译成人话 ——
     * 页面不必再自己维护一份「可见行集合」，那份复算很容易和表格真实显示不一致。
     */
    [selectCmd]: async (params) => {
      const table = readTable();
      if (!table) {
        throw new Error('表格还没建好（页面可能仍在加载或已经切走），稍后重试或重新 ui_observe');
      }
      const rowIds = toRowIdList(params.rowIds ?? params.rowId);
      if (rowIds.length === 0) {
        throw new Error(
          `${selectCmd} 需要 rowIds：从 ${pageCmd} 或 ${name} 段的 active.rowId 里取，多个用逗号分隔`,
        );
      }
      const selected = table.selectRowsByKeys(rowIds);
      if (selected === 0) {
        throw new Error(
          `rowId 都不在当前表格里（${rowIds.join('、')}）：可能被筛选掉了、在收起的组里，或主键写错。` +
          `先用 ${pageCmd} 重新取一次 rowId`,
        );
      }
      // 等页面把选中态落回 state：回执 patch 里的 enabled 清单才是按钮的真实可用状态
      const landed = options.waitSelected ? await options.waitSelected(rowIds[0]) : true;
      const parts = [`已选中 ${selected} 行（rowId：${rowIds.join('、')}）`];
      if (selected < rowIds.length) {
        parts.push(`其中 ${rowIds.length - selected} 行没选中（不在当前显示里，可能在收起的组里）`);
      }
      /*
       * 这一句只在「页面按钮还没解除禁用」时补，措辞刻意不说「稍后 observe 再确认」：
       *
       * 选中是否成功，上面的命中数已经回答了（表格里确实亮着）。observe 一次既改变不了
       * 按钮状态、又要重发一整页快照（5.5 KB），还会让模型以为选中失败而去重试。
       * 真正要提醒的只有一件事：**接下来那条依赖选中的命令可能仍被拒**。
       */
      if (!landed) parts.push('（页面按钮尚未解除禁用；若下条命令被拒，再选中一次）');
      return parts.join('；');
    },
  };

  return { name, data, actions, handlers };
}
