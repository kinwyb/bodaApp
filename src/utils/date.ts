import dayjs, { type Dayjs } from 'dayjs';

/**
 * 日期处理。
 *
 * 后端用 `0001-01-01`（SQL Server datetime 的最小值）表示「空日期」，
 * 页面侧统一转成 undefined / 空串，别把这个值直接显示出来或拿去比较大小。
 *
 * **值可能是两种形态**，下面每个函数都要认：
 * - `string`：后端原样串（如 `'2026-10-09T00:00:00'`、`'2025-09-01 16:37:50'`）。
 *   HTTP 直返给的是它，SQL 路径也保持原样 —— `api` 层不转日期；
 * - `Dayjs`：业务模型转好的形态（services 层的 `toYupaiOrder`），空日期是 `null`。
 *   别用 `String(dayjsObj)` 去处理它 —— 那得到的是 `'Sun, 01 Mar 2026 …'`，
 *   解析不可靠。
 */

/** 后端表示「空日期」的占位值前缀 */
export const EMPTY_DATE_PREFIX = '0001-01-01';

/** 项目统一的日期格式（精确到日） */
export const DATE_FORMAT = 'YYYY-MM-DD';

/** 项目统一的日期时间格式（精确到秒）—— 表格列渲染 `Dayjs` 时用 */
export const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * 当前时间（`Dayjs`）。
 *
 * 取「现在」统一走它，别各处直接 `dayjs()` / `new Date()` —— 集中一个入口，
 * 将来要统一时区、或者在测试里冻结时间，只改这一处。
 *
 * 需要字符串就套 `formatDate(now())` / `formatDateTime(now())`。
 */
export function now(): Dayjs {
  return dayjs();
}

/**
 * 是不是「空日期」：空值、后端占位值（0001-01-01）都算。
 *
 * 已经是 `Dayjs` 的（业务模型转好的）只看它是否有效 —— 那边空日期统一给 `null`，
 * 不会把占位值带过来。
 */
export function isEmptyDate(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (dayjs.isDayjs(value)) return !value.isValid();
  return String(value).startsWith(EMPTY_DATE_PREFIX);
}

/**
 * 值 → dayjs：空值、空日期占位、非法日期一律给 undefined。
 * 给 DatePicker 这类受控组件用（它要 undefined 才是「没选」）。
 */
export function toDayjs(value: unknown): Dayjs | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  // 已经是 Dayjs 直接用，别再过一遍 String() —— 那是 `'Sun, 01 Mar 2026 …'`，解析不可靠
  if (dayjs.isDayjs(value)) return value.isValid() ? value : undefined;
  const text = String(value);
  if (text.startsWith(EMPTY_DATE_PREFIX)) return undefined;
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed : undefined;
}

/** dayjs → 日期字符串；空值给空串（提交给后端时用，与「空日期」占位对齐） */
export function toDateString(value: Dayjs | undefined | null): string {
  return value && dayjs.isDayjs(value) ? value.format(DATE_FORMAT) : '';
}

/**
 * 值 → `YYYY-MM-DD` 文本；空值 / 无效日期给空串。
 * 表格列渲染「只到日」的日期用它（对应列定义的 `dataType: 'date'`）。
 */
export function formatDate(value: unknown): string {
  return toDateString(toDayjs(value));
}

/**
 * 值 → `YYYY-MM-DD HH:mm:ss` 文本；空值 / 无效日期给空串。
 * 表格列渲染「到秒」的日期时间用它（对应列定义的 `dataType: 'datetime'`）。
 *
 * 与 `formatDate` 成对：**显示到什么精度由列定义决定**，不靠数据本身猜 ——
 * 业务模型里的日期一律是 `Dayjs`，它不记得「这一列原本有没有时间」。
 */
export function formatDateTime(value: unknown): string {
  return toDayjs(value)?.format(DATETIME_FORMAT) ?? '';
}
