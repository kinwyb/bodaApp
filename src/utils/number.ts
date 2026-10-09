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
