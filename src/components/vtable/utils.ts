/** VTable 模块的通用小工具（纯函数，无 React 依赖） */

/** 浅比较两条记录（统计行的值都是原始类型，浅比较足够） */
export function shallowEqualRecord(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}
