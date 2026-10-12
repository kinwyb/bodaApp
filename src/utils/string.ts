/**
 * 字符串归一化。
 *
 * 为什么需要：表格显示与拼提交数据时到处是 `String(x ?? '')` ——
 * 少写一次 `?? ''` 就会把 `null` 变成 `"null"` 显示到界面上，
 * 而 `x` 还可能是数字、布尔或 `NaN`。与 number.ts 的 `toNumberOrZero` 是同一层的东西：
 * 那边管「怎么变成数字」，这边管「怎么变成文本」。
 */

/**
 * 归一化成字符串：不存在 / 空值 / `NaN` 一律给空串，其余 `String(value)`。
 *
 * - `null` / `undefined` → `''`（这是它相比 `String(x ?? '')` 唯一多做的一件事，但省得到处写）
 * - `NaN` → `''`：它多半是「算不出来」的产物，直接 String 会在界面上显示成 "NaN"
 * - `0` / `false` → `'0'` / `'false'`：**它们是有意义的取值，不当空**（与 isBlank 一致）
 *
 * 注意两个别用它的地方：
 * - **日期**用 `toDateString` / `cleanDateText`（dayjs 走 `String()` 出来的是 ISO 串，不是给人看的）
 * - **对象 / 数组**会得到 `"[object Object]"` / `"1,2"` 这种，通常说明数据本身不对，
 *   该在数据来源处解决，而不是指望这个函数兜底
 */
export function toStringOrEmpty(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isNaN(value)) return '';
    return String(value);
}
