/**
 * GridTable 模块的跨域基础类型。
 *
 * 各功能域专有的类型跟着功能走，不堆在这里：
 * 选择与激活行在 `selection.ts`、右键菜单在 `menu.ts`、单元格样式在 `cellStyle.ts`、
 * 编辑在 `editing.ts`、排序在 `sorting.ts`、导出配置在 `export.ts`。
 */

import type { GridTableSortState } from './sorting';

/**
 * 列宽模式（`widthMode`），与 `@visactor/vtable` 的取值一致。
 *
 * - `standard`（默认）：按列定义里的 `width` 排布，总宽超出容器就横向滚动；
 * - `adaptive`：表格总宽跟随容器宽度，列宽按比例缩放（与 `autoFillWidth` 不同，
 *   它连「列宽总和大于容器」的情况也会缩回来）；
 * - `autoWidth`：按内容自动算列宽，可配合列上的 `maxWidth` / 全局 `limitMaxAutoWidth` 收敛。
 */
export type GridTableWidthMode = 'standard' | 'adaptive' | 'autoWidth';

/**
 * 行高模式（`heightMode`），与 `@visactor/vtable` 的取值一致。
 *
 * - `standard`（默认）：行高用 `rowHeight` / `headerRowHeight`，内容多就纵向滚动；
 * - `adaptive`：表格高度跟随容器，超出容器的行会被压缩（内容多时会挤在一起）；
 * - `autoHeight`：按内容自适应行高（开了 `autoWrapText` 之类才看得出差异）。
 */
export type GridTableHeightMode = 'standard' | 'adaptive' | 'autoHeight';

/** 样式回调参数（@visactor/vtable 未从包根导出该类型，这里按官方定义声明） */
export interface StyleArgs {
  col: number;
  row: number;
  dataValue?: unknown;
  value?: unknown;
  /**
   * 表格实例（只声明用到的成员，避免把整个 ListTable 拖进类型依赖）。
   * `rowCount` 用于统计行判定 —— 树形分组展开后 `records.length` 不等于界面行数。
   */
  table: {
    columnHeaderLevelCount: number;
    rowCount?: number;
    getCellOriginRecord?: (col: number, row: number) => unknown;
  };
}

export interface GridTableCellInfo {
  col: number;
  row: number;
  field?: string;
  /** 是否底部统计行（统计行的 record 里只有汇总字段，不要当业务数据用） */
  isSummaryRow: boolean;
  /**
   * 是否树形分组的**组行**（配了 `group` 才有意义）。
   *
   * 组行的 record 上没有业务主键，只有 `children`（明细）与配置出来的汇总字段，
   * 页面按 `record.ID` 之类过滤数据时务必排掉它，否则会取到 `undefined`。
   */
  isGroupRow: boolean;
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
 * 提醒：各单元格回调里的 `row` 是另一套坐标（GridTable 行号，**含表头**，0 起），
 * 与本类型差一个表头行数（分组表头会大于 1），换算要用 `table.columnHeaderLevelCount`；
 * 而回调里的 `rowIndex` 与之是同一套，可以直接用。
 */
export interface GridTableRowInfo {
  /** 数据行下标（入参原样回传，0 起、不含表头） */
  rowIndex: number;
  /** 行主键值（统计行为 SUMMARY_ROW_KEY） */
  rowKey: string;
  /** 该行当前的数据 */
  record: Record<string, unknown>;
  /** 是否底部统计行（统计行里只有汇总字段，别当业务数据用） */
  isSummaryRow: boolean;
  /** 是否树形分组的组行（组行没有业务主键，只有 children 与汇总字段） */
  isGroupRow: boolean;
}

/**
 * 显示层状态（getDisplayInfo 的返回值）—— 「用户此刻屏幕上是什么」的最小描述。
 *
 * 三个字段回答的是同一件事的三个侧面：一共几行、按什么排的、有没有分组。
 * 需要它的地方（界面桥的快照、按行号取数据的翻页）都不能只看页面 records：
 * 排序、分组是**表格内部**的显示层，页面 state 里根本没有这些信息。
 */
export interface GridTableDisplayInfo {
  /**
   * 显示行数（0 起算行号的上界，**含底部统计行**、含分组的组行）。
   *
   * 与 `getRowByIndex` 同一套坐标：`0..rowCount-1` 正好覆盖用户在屏幕上能看到的每一行，
   * 所以「用户说的第 5 条」就是 `getRowByIndex(4)`。
   */
  rowCount: number;
  /**
   * 当前排序：**数组**，按优先级从高到低。
   *
   * 为什么是数组而不是单个对象：@visactor/vtable 原生支持多列排序
   * （`multipleSort` + `sortState: SortState[]`），只是本组件目前自己实现排序、
   * 用的是单列 `sortState`，所以这里**现在只会是 0 或 1 项**。将来接多列排序时，
   * 改的是组件内部的比较逻辑，这个结构不用动 —— 消费方（界面桥、快照）也就不必再改一次。
   */
  sorts: GridTableSortState[];
  /** 是否处于树形分组模式（此时 rowCount 里混有组行，行记录要按 isGroupRow 区分） */
  grouped: boolean;
}
