import { isBlank, toNumberOrZero } from '@/utils';

/**
 * 树形分组（组行 + 明细行），支持多层。
 *
 * 为什么不用 VTable 原生的 `groupBy`：原生分组的组行是**整行合并的空壳对象**
 * （`{ vtableMerge: true, vtableMergeName, children }`，见源码 `data/CachedDataSource.js`
 * 的 `dealWithGroup`），组行上没有任何业务字段，其它列取不到值 —— 想在组行显示
 * 「款式数量合计 / 工时合计」这类分列汇总就做不到（`groupTitleFieldFormat` 只能返回
 * 一整段文本，还得塞在合并格子里）。
 *
 * 所以这里走**标准树形表格**：把扁平 records 加工成 `父行(带汇总字段) + children` 的树，
 * 配合 `tree: true` 的列，VTable 会自动画展开箭头、缩进子行。组行就是一普通行，
 * 每列的汇总值都是真实字段值，样式/对齐/格式化全部走列定义那一套。
 *
 * 与 `mergeGroup`（合并单元格）是两条路：那个只做视觉合并、不能收起；这个是真正的层级。
 */

/** 组行标记字段：组行对象上为 true，业务判断用它（不要用字段非空去猜） */
export const GROUP_ROW_FLAG = '__groupRow';

/** 组行主键前缀，保证与业务主键不冲突 */
export const GROUP_ROW_KEY_PREFIX = '__group__:';

/** 组行原始分组值（保留原类型，标题被格式化后仍能拿到真值） */
export const GROUP_VALUE_FIELD = '__groupValue';

/** 组行所属层级（0 = 最外层） */
export const GROUP_LEVEL_FIELD = '__groupLevel';

/** 组行路径分隔符：多层组的 rowKey 由各层组值拼成 */
const PATH_SEPARATOR = '\u0001';

export type GroupAggregateType =
  /** 求和（默认） */
  | 'sum'
  /** 条数（明细行数，忽略字段值） */
  | 'count'
  /** 去重计数（**忽略空值**，`1` 与 `'1'` 视为同一个值） */
  | 'distinct'
  /** 平均（空组返回 0，不四舍五入 —— 小数位交给列定义） */
  | 'avg'
  | 'max'
  | 'min'
  /** 取第一条明细的值（适合「组内都相同」的字段，如客户、业务员） */
  | 'first';

export interface GroupAggregate {
  field: string;
  /** 内置汇总方式，默认 sum；配了 `aggregate` 时忽略它 */
  type?: GroupAggregateType;
  /**
   * 自定义汇总：拿到本组的**明细行**（不含子组行），想怎么算就怎么算。
   *
   * 配了它就完全接管这一项（`type` 不再生效），返回值直接写进组行的同名字段。
   * 典型用法：加权求和、去重后求和、按状态挑值、拼一段文字。
   *
   * ```ts
   * { field: 'Qty', aggregate: (rows) => rows.filter(r => r.Status === 1).reduce((s, r) => s + toNumberOrZero(r.Qty), 0) }
   * ```
   */
  aggregate?: (records: readonly GroupSourceRecord[], field: string) => unknown;
}

export interface VTableGroupOptions {
  /**
   * 单字段分组，等价于 `fields: [field]`。与 `fields` 二选一（`fields` 优先）。
   *
   * **必须有一列绑定该字段**，组件会把那一列设成树形展开列
   * （VTable 要求至少一列 `tree: true` 才会走层级模式），展开箭头就画在它的文字左侧。
   */
  field?: string;
  /**
   * 多字段分组，**数组顺序即层级**（粗 → 细）。
   *
   * 组行只在自己那一层的字段列上取值，其它层字段列留空 —— 视觉上就是
   * 「月份行只有月份、客户行只有客户」，靠缩进与箭头表达从属关系。
   * 例：`['Month', 'Customer']` → 月份组 → 客户组 → 明细行。
   */
  fields?: readonly string[];
  /**
   * 要在**每一层组行**上显示的汇总字段：字符串等价于 `{ field, type: 'sum' }`。
   * 每一层都按该组的**明细行**重新算（不是把子组的汇总再相加），所以多层也不会重复计数。
   *
   * 内置方式：`sum`（默认）/ `count` / `distinct` / `avg` / `max` / `min` / `first`；
   * 都不够用时用 `{ field, aggregate: (rows) => ... }` 自定义，函数里拿到本组明细行。
   *
   * ```ts
   * aggregates: [
   *   'Qty',                                        // 求和
   *   { field: 'OrderCode', type: 'distinct' },     // 订单号去重个数
   *   { field: 'Qty', type: 'avg' },                // 平均单量
   *   { field: 'DoneQty', aggregate: (rows) => rows.filter(r => r.Status === 1).reduce((s, r) => s + toNumberOrZero(r.Qty), 0) },
   * ]
   * ```
   */
  aggregates?: ReadonlyArray<string | GroupAggregate>;
  /**
   * 组行标题，默认取分组值的字符串形式。
   *
   * @param value   本层的分组值（原始类型，未格式化）
   * @param records 本组下的**明细行**（不含子组行）
   * @param field   本层分组字段名（多层时用来区分拼什么前缀）
   * 例：`(value, _rows, field) => (field === 'Month' ? `生产月份: ${value}` : String(value))`
   */
  title?: (
    value: unknown,
    records: readonly GroupSourceRecord[],
    field: string,
  ) => string;
  /**
   * 默认展开层级：1 = 只显示最外层组行（默认）、2 = 展开到第二层、……
   * 传 `Number.MAX_SAFE_INTEGER` 或很大的值即全部展开。对应 VTable 的 `hierarchyExpandLevel`。
   */
  expandLevel?: number;
  /**
   * 每一层的排列顺序：不传时保持「首次出现」的顺序（数据原来怎么排就怎么排）。
   * 传 `asc` / `desc` 则同一层内按组值排序（嵌套的每一层都适用）。
   */
  sort?: 'asc' | 'desc';
  /** 子行相对父行的缩进（像素），默认 12 */
  indent?: number;
  /**
   * 组行是否可被选中（勾选 / 框选），默认 **false**。
   *
   * 默认禁止是出于安全：组行没有业务主键，一旦混进 `getSelection().rows`，
   * 页面那句 `rows.map(r => r.ID)` 就会得到 `undefined`，批量删除 / 批量操作容易出事。
   * 需要「整组一起选」的业务再打开它，并自己按 `isGroupRow` 分流。
   */
  selectable?: boolean;
}

export type GroupSourceRecord = Record<string, unknown>;

/** 取实际生效的分组字段（`fields` 优先，其次 `field`） */
export function resolveGroupFields(options: VTableGroupOptions | undefined): string[] {
  if (!options) return [];
  if (options.fields && options.fields.length > 0) return options.fields.slice();
  return options.field ? [options.field] : [];
}

/**
 * 按 `fields` 把扁平数据聚成组行数组（多层嵌套）。
 *
 * - 分组值空白（`null` / `undefined` / `''`）的行归到同一个「(空)」组，
 *   不会像原生 `dealWithGroup` 那样把 `undefined` 的行**静默丢弃**；
 * - 明细行是原对象引用，不做克隆（编辑、rowKey 全都不变）；
 * - 同一层内组顺序默认按首次出现，`sort` 可改成按组值排序。
 */
export function buildGroupRows(
  records: readonly GroupSourceRecord[],
  options: VTableGroupOptions,
  rowKey = 'id',
): GroupSourceRecord[] {
  const fields = resolveGroupFields(options);
  if (fields.length === 0 || records.length === 0) return records.slice();
  return buildLevel(records, fields, 0, [], options, rowKey);
}

function buildLevel(
  records: readonly GroupSourceRecord[],
  fields: readonly string[],
  level: number,
  parentPath: readonly string[],
  options: VTableGroupOptions,
  rowKey: string,
): GroupSourceRecord[] {
  const field = fields[level];
  const aggregates = normalizeAggregates(options.aggregates);
  const hasNextLevel = level + 1 < fields.length;
  const groups = sortBuckets(groupByValue(records, field), options.sort);

  return groups.map(({ value, rows }) => {
    const path = [...parentPath, valueKey(value)];
    const groupRow: GroupSourceRecord = {};

    // 汇总口径始终是「本组的明细行」，多层时父组也直接对明细求和，不会把子组小计再加一遍
    for (const item of aggregates) {
      groupRow[item.field] = aggregateValue(rows, item);
    }

    // 组值只写进**本层**字段列：月份组的客户列、客户组的月份列都留空，
    // 这样「哪一层是这个组」一眼能看出来（箭头则统一画在 tree 列上）
    groupRow[field] = options.title?.(value, rows, field) ?? defaultTitle(value);
    groupRow[rowKey] = `${GROUP_ROW_KEY_PREFIX}${path.join(PATH_SEPARATOR)}`;
    groupRow[GROUP_ROW_FLAG] = true;
    groupRow[GROUP_VALUE_FIELD] = value;
    groupRow[GROUP_LEVEL_FIELD] = level;
    groupRow.children = hasNextLevel
      ? buildLevel(rows, fields, level + 1, path, options, rowKey)
      : rows;
    return groupRow;
  });
}

/** 按字段值分桶，保留首次出现的顺序 */
function groupByValue(
  records: readonly GroupSourceRecord[],
  field: string,
): Array<{ value: unknown; rows: GroupSourceRecord[] }> {
  const buckets = new Map<string, { value: unknown; rows: GroupSourceRecord[] }>();
  for (const record of records) {
    const value = record[field];
    const key = valueKey(value);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.rows.push(record);
    } else {
      buckets.set(key, { value, rows: [record] });
    }
  }
  return Array.from(buckets.values());
}

/** 空值统一归到一个桶；前缀区分「空组」与字符串 'null' 这类真实取值 */
function valueKey(value: unknown): string {
  return isBlank(value) ? '\u0000blank' : `v:${String(value)}`;
}

function defaultTitle(value: unknown): string {
  return isBlank(value) ? '(空)' : String(value);
}

function sortBuckets(
  groups: Array<{ value: unknown; rows: GroupSourceRecord[] }>,
  sort: VTableGroupOptions['sort'],
): Array<{ value: unknown; rows: GroupSourceRecord[] }> {
  if (!sort) return groups;
  const direction = sort === 'desc' ? -1 : 1;
  return groups.slice().sort((a, b) => {
    // 空值永远排最后，不参与方向翻转
    if (isBlank(a.value) || isBlank(b.value)) return isBlank(a.value) ? 1 : -1;
    if (typeof a.value === 'number' && typeof b.value === 'number') {
      return (a.value - b.value) * direction;
    }
    return String(a.value).localeCompare(String(b.value), 'zh-CN') * direction;
  });
}

function normalizeAggregates(input: VTableGroupOptions['aggregates']): GroupAggregate[] {
  if (!input || input.length === 0) return [];
  return input.map((item) =>
    typeof item === 'string' ? { field: item, type: 'sum' } : { type: 'sum', ...item },
  );
}

function aggregateValue(
  rows: readonly GroupSourceRecord[],
  config: GroupAggregate,
): unknown {
  const { field, type = 'sum', aggregate } = config;
  // 自定义汇总完全接管：拿到的是本组的明细行，返回值直接写进组行
  if (aggregate) return aggregate(rows, field);

  switch (type) {
    case 'count':
      return rows.length;
    case 'distinct':
      return countDistinct(rows, field);
    case 'avg':
      return rows.length === 0
        ? 0
        : rows.reduce((total, row) => total + toNumberOrZero(row[field]), 0) / rows.length;
    case 'first':
      return rows[0]?.[field];
    case 'max':
    case 'min': {
      const numbers = rows.map((row) => toNumberOrZero(row[field]));
      if (numbers.length === 0) return 0;
      return type === 'max' ? Math.max(...numbers) : Math.min(...numbers);
    }
    case 'sum':
    default:
      return rows.reduce((total, row) => total + toNumberOrZero(row[field]), 0);
  }
}

/** 去重计数：空白值不算一个值；`1` 与 `'1'` 按字符串统一后视为同一个 */
function countDistinct(rows: readonly GroupSourceRecord[], field: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (!isBlank(value)) values.add(String(value));
  }
  return values.size;
}

/** 该行是否为组行（组行上不会带业务字段，别当明细用） */
export function isGroupRow(record: unknown): boolean {
  return Boolean(record && (record as GroupSourceRecord)[GROUP_ROW_FLAG]);
}
