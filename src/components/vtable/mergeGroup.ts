import { isBlank } from '@/utils';

/**
 * 分组合并（表级）配置。
 *
 * 与列级 `mergeCell`（boolean / 回调，VTable 原生）是两条路：
 * 这里的分组会预扫描数据、建出「每行属于哪一块」的索引，最终以 `customMergeCell` 交给 VTable。
 * 好处是一次 O(rows) 扫描、每格 O(1) 查询；代价是索引要自己跟着数据重建（由 VTable 组件负责）。
 */
export interface MergeGroupConfig {
  /**
   * 前置门槛列 / 上级分组列：这些列的值必须**全部相同**，才允许继续考虑后面的合并。
   *
   * 不参与顺序判断，是所有合并动作之前的强制条件。
   * 典型用法：一张表里无论合并哪一列，都要求「同一个订单」——把 `OrderCode` 放这里。
   */
  topMergeColumn?: readonly string[];

  /**
   * 真正按顺序合并的列，**数组顺序即层级**（粗 → 细）。只有这里列出的列才会被合并。
   *
   * 当前列能否合并，取决于它在这个数组里**（含自身）之前**的列是否都相同：
   *
   * ```ts
   * mergeColumnSort: ['WorkPlace', 'StyleCode', 'SizeName']
   * // WorkPlace 列：WorkPlace 相同即可合并
   * // StyleCode 列：WorkPlace + StyleCode 都相同
   * // SizeName  列：WorkPlace + StyleCode + SizeName 都相同
   * ```
   */
  mergeColumnSort?: readonly string[];
}

/** 一个合并块覆盖的数据行区间（下标不含表头、从 0 起） */
export interface MergeGroupRange {
  start: number;
  end: number;
}

/** 字段名 -> 下标为数据行号、值为该行所属合并块的稀疏数组 */
export type MergeGroupIndex = Map<string, Array<MergeGroupRange | undefined>>;

/** 两行在给定字段上是否全部相等（字段必须存在，写错字段名一律判不等） */
function sameGroup(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) =>
    field in a && field in b ? sameValue(a[field], b[field]) : false,
  );
}

/**
 * 值相等语义：
 * - 两边都为空（`null` / `undefined` / `''`）算相等；一边空一边有值不算；
 * - 非空按字符串比，避开 SQL 直查时 number / string 漂移（`1` 与 `'1'` 视为同值）。
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  return String(a) === String(b);
}

/**
 * 预扫描数据，算出每一列（`mergeColumnSort` 里声明的）每一行所属的合并块。
 *
 * 复杂度 O(列数 × 行数 × 字段数)，只跑一次；之后每格判断只是一次 Map + 数组下标。
 *
 * @param records 只传真实数据行（不要把统计行/补足行混进来，它们会被并进最后一块）
 * @returns 没有任何要合并的列时返回 `null`（调用方据此跳过合并）
 */
export function buildMergeGroupIndex(
  records: readonly Record<string, unknown>[],
  config: MergeGroupConfig,
): MergeGroupIndex | null {
  const gate = config.topMergeColumn ?? [];
  const ordered = config.mergeColumnSort ?? [];
  if (ordered.length === 0 || records.length === 0) return null;

  const index: MergeGroupIndex = new Map();

  ordered.forEach((field, level) => {
    // 本列参与比较的就是「门槛列 + 顺序列从头到本列」，顺带保证本列值相同
    const fields = gate.length === 0 ? ordered.slice(0, level + 1) : [...gate, ...ordered.slice(0, level + 1)];
    const slots: Array<MergeGroupRange | undefined> = new Array(records.length);

    let start = 0;
    for (let row = 1; row <= records.length; row++) {
      const boundary = row === records.length || !sameGroup(records[row - 1], records[row], fields);
      if (!boundary) continue;
      // 单行块不值得合并（VTable 对单格 range 也会走一遍合并逻辑）
      if (row - 1 > start) {
        const range: MergeGroupRange = { start, end: row - 1 };
        for (let r = start; r <= range.end; r++) slots[r] = range;
      }
      start = row;
    }

    index.set(field, slots);
  });

  return index;
}
