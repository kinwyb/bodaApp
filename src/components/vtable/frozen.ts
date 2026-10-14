/**
 * 底部冻结行（统计行固定在表格底部）。
 *
 * VTable 1.26 的 bottomFrozenRowCount 不从构造参数读取，只认 internalProps，
 * 且只能在场景 clear 状态下写入，并且 setRecords 会把它重置为 0。
 * 因此顺序必须是：setRecords → clearCells → 赋值 → createSceneGraph。
 */
import type { ListTable } from '@visactor/vtable';

export function applyBottomFrozen(table: ListTable, count: number): void {
  try {
    const scene = (
      table as unknown as {
        scenegraph?: { clearCells: () => void; createSceneGraph: () => void };
      }
    ).scenegraph;
    if (!scene) return;
    // 冻结行数没变就不用重建场景（重建会替换所有单元格节点，代价大且会打断双击识别）
    if (table.bottomFrozenRowCount === count) return;
    scene.clearCells();
    (table as unknown as { bottomFrozenRowCount: number }).bottomFrozenRowCount = count;
    scene.createSceneGraph();
  } catch {
    // 冻结失败不影响表格基本可用性
  }
}

/** VTable 的内部渲染是异步的，放到下一帧应用，避免被它自己重置 */
export function scheduleBottomFrozen(table: ListTable, count: number): void {
  requestAnimationFrame(() => applyBottomFrozen(table, count));
}
