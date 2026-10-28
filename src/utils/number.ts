/**
 * 数值归一化。
 *
 * 为什么需要：后端与表格里的「空」有好几种形态（undefined / null / '' / NaN），
 * 直接参与运算就会污染结果 —— 尤其别写 `Number(v) ?? 0`：
 * `Number()` 转失败返回的是 **NaN**（不是 null/undefined），`??` 永远不会兜底，
 * 于是拿着 NaN 一路算下去，最后写回表格或提交给后端。
 */

/** 归一化成 number：不存在、空值、转不成数字的一律当 0（参与计算时用） */
export function toNumberOrZero(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 归一化成 number | null：不存在、空值、转不成数字的一律当 null。
 *
 * 与 toNumberOrZero 是同一件事的两个档位 —— 受控组件（antd InputNumber 等）
 * 用 null 表示「空」，业务计算才用 0。别把两者混用，否则空值会被悄悄算成 0。
 */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 归一化成 number | null，并把 **0 也视作「未填」**给 null。
 *
 * 给「用 0 表示没填」的行数据用（预订单详情行的款式数量 / 克重 / 工时 / 尺码件数）：
 * 让「未填」在数据里真的表现为 null，`isBlank` / `isBlankExcept` 就能直接判出空行，
 * 不必再另搞一套「数值 <= 0 算空」的值语义判空。
 *
 * 与上两个的区别：`toNumberOrNull` 保留 0（0 是有意义的取值），
 * `toNumberOrZero` 则把未填折成 0 —— 那个方向会掩盖「这格到底填没填」。
 */
export function toNumberOrNullIfZero(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  return parsed === 0 ? null : parsed;
}

/* ────────────────────────────── 百分比 ────────────────────────────── */

/**
 * 百分比。
 *
 * 这一组只认**一种**语义：**百分数** —— `95` / `'95%'` 都是「95%」。
 * 小数比例（`0.95` 也等于 95%）是另一种形态，只在**确认拿到的是比例值**时才用
 * `rateToPercent` / `percentToRate` 显式换算，别就地乘除：
 * `0.1 * 100` 在二进制浮点里是 `10.000000000000002`，直接显示会拖一串尾巴，
 * 而 `(0.3).toFixed(2)` 出来的 `"0.30"` 又让人以为没乘过 100 —— 两种错都很难一眼看出。
 *
 * ⚠️ 后端字段到底是百分数还是比例，**以接口/字段自己的约定为准，别猜**：
 * 比如 `BatchRate` 存的就是百分数（`10` = 10%），拿 `rateToPercent` 去乘 100 会变成 1000%。
 */
const PERCENT_BASE = 100;

/** 百分数字面量：可带正负号、小数，末尾可带 `%` / 全角 `％`，中间允许空格 */
const PERCENT_TEXT = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[%％]?$/;

/**
 * 四舍五入到指定小数位（`digits` 为负数时按十位 / 百位取整）。
 *
 * 不走 `value * 10 ** digits` 再除回来：那一步在二进制浮点里先把精度丢了 ——
 * `1.005 * 100` 实际是 `100.49999999999999`，四舍五入成 100，结果是 `1` 而不是 `1.01`。
 * 这里改成「十进制字符串移位」（`Number('1.005e2')` 就是 `100.5`），让 `Math.round`
 * 面对十进制的真实值，算完再移回去。负数按 `Math.round` 的规则（`-1.5` → `-1`），与项目
 * 现有写法一致。
 *
 * 它只管「怎么舍」，不管「空值算什么」—— 入参先自己过 `toNumberOrZero` / `toNumberOrNull`，
 * 别让空值在这一层悄悄变成 0。
 */
export function roundTo(value: number, digits = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const places = Number.isFinite(digits) ? Math.min(Math.trunc(digits), 100) : 0;
  const factor = 10 ** places;
  const shifted = Number(`${value}e${places}`);
  // 拼不出合法字面量时退回乘法（结果仍是数字，不会把 NaN 漏出去）：
  // - value 本身是指数形态（`1e-7` → `'1e-7e2'`）
  // - 移位后大到用指数表示（`1e20` → `'1e+22e-2'`）
  // 移回去时指数要取反：`places` 为负（按十位取整）时是 `e2`，写成 `e-${places}` 会拼出 `e--2`
  const rounded = Number.isFinite(shifted) ? Number(`${Math.round(shifted)}e${-places}`) : Number.NaN;
  return Number.isFinite(rounded) ? rounded : Math.round(value * factor) / factor;
}

/**
 * 百分比 → 数字（百分数语义：`'95%'` → `95`，`95` → `95`，`'0.95'` → `0.95`）。
 *
 * 认的写法：`'95%'` / `'95％'`（全角）/ `' 95 % '` / `'95'` / `'-12.5%'`；
 * 空值、`NaN`、`'abc'`、`'1,234%'` 一律 `null`（不做千分位猜测）。
 *
 * 两点刻意为之：
 * - **带不带 `%` 结果一样**：表格编辑器存的是数字、后端偶尔回字符串，语义都是百分数；
 * - **不在这里取整**：`'33.333%'` 给 `33.333`，要几位小数由 `formatPercent` 的 `digits`
 *   或 `roundTo` 决定 —— 存的时候丢掉的精度，显示时补不回来。
 */
export function toPercentOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const matched = PERCENT_TEXT.exec(value.trim());
  return matched ? Number(matched[1]) : null;
}

/** 百分比字符串 → 数字，空值 / 非法值当 0（参与计算时用；对应 `toNumberOrZero`） */
export function toPercentOrZero(value: unknown): number {
  return toPercentOrNull(value) ?? 0;
}

/**
 * 小数比例 → 百分数（`0.3` → `30`，`0.95` → `95`）—— 拿到的值确实是比例（如 `0.3`）时用。
 *
 * 不传 `digits` 也会收掉浮点尾巴（`0.07` → `7`，而不是 `7.000000000000001`），
 * 但不会截断有效位数；要固定精度就把 `digits` 传进来（`2`：`0.3333` → `33.33`）。
 */
export function rateToPercent(rate: unknown, digits?: number): number | null {
  const value = toNumberOrNull(rate);
  if (value === null) return null;
  return roundTo(value * PERCENT_BASE, digits ?? 10);
}

/** 百分数 → 小数比例（`33.33` / `'33.33%'` → `0.3333`）—— 后端要比例而不是百分数时用 */
export function percentToRate(percent: unknown): number | null {
  const value = toPercentOrNull(percent);
  return value === null ? null : value / PERCENT_BASE;
}

export interface FormatPercentOptions {
  /** 保留的小数位（四舍五入，可为负数按十位取整）；不给就按原值输出，不补零也不截断 */
  digits?: number;
  /** 去掉小数末尾多余的 0（配 `digits` 用）：`12.50%` → `12.5%`，`12.00%` → `12%` */
  trimZeros?: boolean;
  /** 正数带 `+`：涨跌幅这类有方向的数值用，`95` → `'+95%'`（负数本来就有 `-`） */
  withSign?: boolean;
  /** 数值与 `%` 之间留一个空格：`'95 %'`；默认紧贴 `'95%'` */
  space?: boolean;
  /** 空值 / 非法值的输出文本，默认空串 —— 表格里显示空白，而不是 `NaN%` */
  fallback?: string;
}

/**
 * 百分数 → 百分比文本（`95` → `'95%'`，`95.5` → `'95.50%'`）。
 *
 * 入参可以是数字，也可以是 `'95%'` 这类字符串（内部走 `toPercentOrNull`，幂等）。
 * **不做小数比例换算**：`0.95` 会被当成 `0.95%`，拿到比例值时先 `rateToPercent(0.95)`。
 * 表格列渲染常用组合：
 *
 * ```ts
 * fieldFormat: (record) => formatPercent(rateToPercent(record.Ratio), { digits: 2 })
 * ```
 */
export function formatPercent(value: unknown, options: FormatPercentOptions = {}): string {
  const { digits, trimZeros = false, withSign = false, space = false, fallback = '' } = options;
  const percent = toPercentOrNull(value);
  if (percent === null) return fallback;

  let text: string;
  if (digits === undefined) {
    text = String(percent);
  } else {
    // 保留小数位；`digits` 为负时按十位 / 百位取整（与 `roundTo` 一致），`toFixed` 只认 ≥ 0
    const places = Number.isFinite(digits) ? Math.min(Math.trunc(digits), 100) : 0;
    text = roundTo(percent, places).toFixed(Math.max(0, places));
  }
  if (trimZeros && text.includes('.')) text = text.replace(/\.?0+$/, '');
  if (withSign && percent > 0) text = `+${text}`;
  return space ? `${text} %` : `${text}%`;
}

/**
 * 字节数 → 人类可读体积（`1536` → `'1.5 KB'`）。
 *
 * 按 1024 进位而不是 1000：显示的是用户在「文件属性」里看到的那个数，
 * 用 1000 进位会出现「这里 2.1 MB、系统里 2.0 MB」的对不上。
 * 小于 1KB 直接给字节数 —— `0.4 KB` 读不出量级，也没人关心小数。
 *
 * 传入空值 / 负数返回空串（由调用方决定要不要显示），不返回 `'NaN B'` 这种噪音。
 */
export function formatFileSize(bytes: unknown, fractionDigits = 1): string {
  const size = toNumberOrNull(bytes);
  if (size === null || size < 0) return '';
  if (size < 1024) return `${Math.round(size)} B`;

  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const places = Math.min(Math.max(Math.trunc(fractionDigits), 0), 3);
  // 1.0 MB → 1 MB：整数体积不必挂个没意义的 .0
  const text = roundTo(value, places).toFixed(places).replace(/\.0+$/, '');
  return `${text} ${units[unit]}`;
}
