import dayjs, { type Dayjs } from 'dayjs';

/**
 * 日期处理。
 *
 * 后端用 `0001-01-01`（SQL Server datetime 的最小值）表示「空日期」，
 * 页面侧统一转成 undefined / 空串，别把这个值直接显示出来或拿去比较大小。
 */

/** 后端表示「空日期」的占位值前缀 */
export const EMPTY_DATE_PREFIX = '0001-01-01';

/** 项目统一的日期格式（精确到日） */
export const DATE_FORMAT = 'YYYY-MM-DD';

/** 是不是「空日期」：空值、后端占位值（0001-01-01 开头）都算 */
export function isEmptyDate(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return String(value).startsWith(EMPTY_DATE_PREFIX);
}

/**
 * 后端值 → dayjs：空值、空日期占位、非法日期一律给 undefined。
 * 给 DatePicker 这类受控组件用（它要 undefined 才是「没选」）。
 */
export function toDayjs(value: unknown): Dayjs | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const text = String(value);
  if (text.startsWith(EMPTY_DATE_PREFIX)) return undefined;
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed : undefined;
}

/** dayjs → 日期字符串；空值给空串（提交给后端时用，与「空日期」占位对齐） */
export function toDateString(value: Dayjs | undefined | null): string {
  return value && dayjs.isDayjs(value) ? value.format(DATE_FORMAT) : '';
}

/** 后端值 → 日期字符串，一步到位（toDayjs + toDateString 的组合） */
export function formatDate(value: unknown): string {
  return toDateString(toDayjs(value));
}

/**
 * 后端日期值 → 可直接显示的文本：空日期占位洗成空串，其余**原样保留**。
 * 与 formatDate 的区别：这个不重新格式化，只把「空」处理掉（表格列渲染用，
 * 后端给的可能是 `2026-10-09T00:00:00` 这种带时间的串，原样显示才对）。
 */
export function cleanDateText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return text.startsWith(EMPTY_DATE_PREFIX) ? '' : text;
}
