/** 表头排序：状态类型与本地比较规则（排序在组件内完成，统计行不参与） */

export interface VTableSortState {
  field: string;
  order: 'asc' | 'desc';
}

/** 默认比较：数值按大小、字符串按字典序，空值排最后 */
export function defaultCompare(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) > String(b) ? 1 : -1;
}
