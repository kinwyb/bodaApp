/**
 * 底部冻结行（统计行固定在表格底部）。
 *
 * @visactor/vtable 1.26 的 bottomFrozenRowCount 不从构造参数读取，只认 internalProps，
 * 且只能在场景 clear 状态下写入。
 * 因此顺序必须是：clearCells → 赋值 → createSceneGraph。
 */
import type { ListTable } from '@visactor/vtable';

/**
 * setRecords 之前同步生效底部冻结（治闪屏）。
 *
 * 要同时写两个地方，缺一不可：
 * 1. `options.bottomFrozenRowCount` —— ListTable.refreshRowColCount()（setRecords 内部会调）
 *    把它同步回这个配置值，只写 internalProps 会被它打回 0（实测调用栈确认，
 *    这也是「setRecords 会重置底部冻结」的真相）。
 * 2. `internalProps.bottomFrozenRowCount` —— createSceneGraph 实际读的是它；
 *    构造参数没传时它是 undefined，getter 兜底成 0。
 *
 * 两处都写好之后，setRecords 内部的 refreshRowColCount 同步的是新值（无变化），
 * createSceneGraph 直接按冻结行建场景，一次画对。放到 setRecords 之后（哪怕同帧）
 * 都会闪一帧 —— 它结尾的 render() 是同步的，返回时 canvas 已按旧值画出
 * 「汇总行在数据末尾」，下一帧补偿再重建才会贴底，这一跳肉眼可见。
 */
export function prepareBottomFrozen(table: ListTable, count: number): void {
  try {
    const internals = table as unknown as {
      options?: { bottomFrozenRowCount?: number };
      internalProps?: { bottomFrozenRowCount?: number };
    };
    if (internals.options) internals.options.bottomFrozenRowCount = count;
    if (internals.internalProps) internals.internalProps.bottomFrozenRowCount = count;
  } catch {
    // 写失败不影响表格基本可用性，rAF 兜底还会再试
  }
}

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

/** @visactor/vtable 的内部渲染是异步的，放到下一帧应用，避免被它自己重置 */
export function scheduleBottomFrozen(table: ListTable, count: number): void {
  requestAnimationFrame(() => applyBottomFrozen(table, count));
}
