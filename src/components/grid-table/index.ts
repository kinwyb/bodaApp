/**
 * GridTable 模块统一入口。
 *
 * ⚠️ 这里**只导出组件、基元常量与类型**，是刻意的：该文件含组件导出，会被 Vite 判定为
 * 「含组件的模块」并注入 Fast Refresh 边界，而边界的校验规则是「所有导出值要么是组件、
 * 要么与上次完全相同」，普通函数每次改动引用都变 → 控制台报
 * `Could not Fast Refresh (... export is incompatible)` 并退化成整页刷新。
 *
 * 所以**工具函数一律从子路径导入**：
 *
 * ```ts
 * import { buildColumns } from '@/components/grid-table/columnBuilder';
 * import { toMenuIcon, alignMenuIcons } from '@/components/grid-table/menuIcon';
 * import { registerAntdEditors, ANTD_INPUT_EDITOR } from '@/components/grid-table/editors/register';
 * ```
 *
 * 子路径那些模块不含组件，不会被注入边界，导出普通函数完全合规
 * （先例：`@/components/commands` 的 barrel 只导出 hook 与函数、不含组件）。
 */
export { GridTable, SUMMARY_ROW_KEY } from './GridTable';
export { FilterTable } from './FilterTable';
export { TableFilter } from './TableFilter';

export type { GridTableApi, GridTableProps } from './GridTable';

// 类型按功能域分散在各文件里，这里统一转出，页面只需认模块入口
export type {
  GridTableCellInfo,
  GridTableHeightMode,
  GridTableRowInfo,
  GridTableWidthMode,
} from './types';
export type {
  GridTableCellStyle,
  GridTableCellStyleHook,
  GridTableCellStyleInfo,
  GridTableCellTooltipHook,
} from './cellStyle';
export type {
  GridTableCellSelection,
  GridTableSelectedRowChangeInfo,
  GridTableSelection,
} from './selection';
export type {
  GridTableMenuClickInfo,
  GridTableMenuConfig,
  GridTableMenuContext,
  GridTableMenuItem,
} from './menu';
export type { EditCellTrigger, GridTableCellValueChangeInfo } from './editing';
export type {
  TableExportPluginOptions,
  GridTableExportCsvOptions,
  GridTableExportExcelOptions,
} from './export';
export type { GridTableSortState } from './sorting';
export type { MergeGroupConfig, MergeGroupIndex, MergeGroupRange } from './mergeGroup';
export type {
  GroupAggregate,
  GroupAggregateType,
  GroupSourceRecord,
  GridTableGroupOptions,
} from './group';
export type {
  GridTableExpandableInfo,
  GridTableExpandableOptions,
} from './expandable';
export type { FilterTableProps } from './FilterTable';
export type { FilterCondition, FilterField, FilterModel, TableFilterProps } from './TableFilter';
export type {
  AppColumnCommonDef,
  AppColumnDef,
  AppColumnFieldFormat,
  AppColumnGroupDef,
  AppColumnLeafDef,
  AppColumnStyle,
  ColumnDataType,
  ColumnHeaderAlign,
  ColumnSource,
  ColumnTagItem,
  ColumnTagItemLike,
  FilterType,
  SortableOption,
} from './columnBuilder';
