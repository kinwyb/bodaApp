/**
 * VTable 模块的跨域基础类型。
 *
 * 各功能域专有的类型跟着功能走，不堆在这里：
 * 选择与激活行在 `selection.ts`、右键菜单在 `menu.ts`、单元格样式在 `cellStyle.ts`、
 * 编辑在 `editing.ts`、排序在 `sorting.ts`、导出配置在 `export.ts`。
 */

/** 样式回调参数（VTable 未从包根导出该类型，这里按官方定义声明） */
export interface StyleArgs {
  col: number;
  row: number;
  dataValue?: unknown;
  value?: unknown;
  table: { columnHeaderLevelCount: number };
}

export interface VTableCellInfo {
  col: number;
  row: number;
  field?: string;
  /** 是否底部统计行（统计行的 record 里只有汇总字段，不要当业务数据用） */
  isSummaryRow: boolean;
  /** 单元格对应的原始记录 */
  record?: Record<string, unknown>;
}

/**
 * 某一行在当前表格里的数据（getRowByIndex 的返回值）。
 *
 * 这里的「行号」指**数据行下标**：0 起、不含表头，传 0 就是界面上显示的第一行数据。
 * 下标跟着**显示顺序**走 —— 点列头排序后，传 0 拿到的仍是排序后显示的第一行，
 * 而不是页面 records 里的第一条。
 *
 * 提醒：各单元格回调里的 `row` 是另一套坐标（VTable 行号，**含表头**，0 起），
 * 与本类型差一个表头行数（分组表头会大于 1），换算要用 `table.columnHeaderLevelCount`；
 * 而回调里的 `rowIndex` 与之是同一套，可以直接用。
 */
export interface VTableRowInfo {
  /** 数据行下标（入参原样回传，0 起、不含表头） */
  rowIndex: number;
  /** 行主键值（统计行为 SUMMARY_ROW_KEY） */
  rowKey: string;
  /** 该行当前的数据 */
  record: Record<string, unknown>;
  /** 是否底部统计行（统计行里只有汇总字段，别当业务数据用） */
  isSummaryRow: boolean;
}
