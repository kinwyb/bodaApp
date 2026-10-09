/**
 * 判空。
 *
 * 存在的理由是：**别用 `!value` 判空** —— 它会把 `0` 和 `false` 当成「空」。
 * 表格里 0 往往是合法值（数量、克重、尺码件数、工时），
 * 用 `!value` 判空 → 把「填了 0」当成「没填」；
 * 反过来为了绕开这点各自去写 `value === 0` → 又把「初始值 0」当成「填过」。
 * 两种错都会静默发生，所以统一到这里。
 */

/**
 * 值算不算「空」。
 *
 * 认定的空：`null` / `undefined` / 空白字符串（含 `'   '`）/ `NaN`。
 * **不算空**：`0` / `false` / 空数组 / 空对象（对表格行数据来说，它们都是有意义的取值）。
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  return false;
}

/**
 * 这一行的指定字段是否**全都**为空 —— 用来判断「整行没填过内容」。
 *
 * `fields` 要显式给：行里通常还带着主键、时间戳这类**永远非空**的字段，
 * 不传就会让每一行都「不空」（比如 `YupaiOrderID` 是 `draft-3`）。
 *
 * 如果**要判的字段比不判的还多**（比如「除了主键，其余都算内容」），
 * 用 `isBlankExcept` 从反面数更省事。
 */
export function isBlankFields(row: Record<string, unknown>, fields: string[]): boolean {
  return fields.length === 0 || fields.every((field) => isBlank(row[field]));
}

/**
 * 这一行**除 `ignoreFields` 之外**的字段是否全都没填。
 *
 * 与 `isBlankFields` 只是数法不同：
 * - 要判的字段少 → `isBlankFields(row, fields)`，白名单，一眼看清查了什么
 * - 不判的字段少 → 这个。行里通常只需排除主键、创建时间这类永远非空的
 *
 * 注意它判的是「值空不空」，**不会把数值的 0 当成没填** —— 若某类行的「未填」
 * 是用 0 表示的（比如详情行的初始值），这里有两条路：
 * 要么让未填存成 `null` / `undefined`（`isBlank(null)` 为真，最省事），
 * 要么别用它把 0 视作空（需要值语义的判空，与通用判空不是一回事）。
 *
 * `ignoreFields` 把整行的键都排除掉时返回 true（没有可判的字段 = 没有内容）。
 */
export function isBlankExcept(row: Record<string, unknown>, ignoreFields: string[]): boolean {
  const keys = Object.keys(row).filter((key) => !ignoreFields.includes(key));
  return keys.length === 0 || keys.every((key) => isBlank(row[key]));
}
