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

/**
 * 稳定序列化：对象的键按字典序排序后再拼，**键的插入顺序不影响结果**。
 *
 * 用途：给「同一份数据算一个稳定标识」用 —— 比如页签 key
 * （`{a:1,b:2}` 与 `{b:2,a:1}` 必须算成同一个，否则用户会莫名其妙多出一个页签）。
 *
 * 与 JSON.stringify 的差别：
 * - 键排序（JSON.stringify 保持插入顺序）
 * - undefined 归一成 null（JSON.stringify 会**整个键丢掉**，
 *   那样 `{a: undefined}` 与 `{}` 就成了两个不同的东西）
 *
 * 数组保序（数组的顺序是有意义的，不能排序）。
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${parts.join(',')}}`;
}

/**
 * 转成十六进制字符串（UTF-8 字节 → 小写 hex）。
 *
 * 用途：本项目后端约定登录的 password 必须传 hex 而不是明文 ——
 * 实测传明文会被判成「password参数缺失」，传 `admin` 的 hex `61646d696e` 才继续往下校验账号。
 *
 * 走 `TextEncoder` 而不是 `charCodeAt` 逐字符取码元：后者在非 ASCII 字符上给出的是
 * UTF-16 码元（可能 > 255，转出来不是字节），密码里出现中文就会编错。
 */
export function toHexString(value: string): string {
    return Array.from(new TextEncoder().encode(value))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
