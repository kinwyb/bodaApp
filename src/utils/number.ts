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
