/** 表头排序：状态类型与本地比较规则（排序在组件内完成，统计行不参与） */

import dayjs from 'dayjs';
import {toDayjs} from '@/utils';

export interface GridTableSortState {
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
  // 日期列的记录值是 Dayjs：String(Dayjs) 是 'Wed, 05 Nov 2026 …' 这种 UTC 串，
  // 按字典序排会先比星期几，完全不是时间顺序 —— 统一转成时间戳再比。
  // 只在值确实是 Dayjs 时走这条，文本列里恰好长得像日期的字符串仍按字典序。
  if (dayjs.isDayjs(a) || dayjs.isDayjs(b)) {
    const av = toDayjs(a)?.valueOf() ?? 0;
    const bv = toDayjs(b)?.valueOf() ?? 0;
    return av === bv ? 0 : av < bv ? -1 : 1;
  }
  return String(a) > String(b) ? 1 : -1;
}
