/**
 * VTable 模块统一入口。
 *
 * ⚠️ 这里**只导出组件、基元常量与类型**，是刻意的：该文件含组件导出，会被 Vite 判定为
 * 「含组件的模块」并注入 Fast Refresh 边界，而边界的校验规则是「所有导出值要么是组件、
 * 要么与上次完全相同」，普通函数每次改动引用都变 → 控制台报
 * `Could not Fast Refresh (... export is incompatible)` 并退化成整页刷新。
 *
 * 所以**工具函数一律从子路径导入**：
 *
 * ```ts
 * import { buildColumns } from '@/components/vtable/columnBuilder';
 * import { toMenuIcon, alignMenuIcons } from '@/components/vtable/menuIcon';
 * import { registerAntdEditors, ANTD_INPUT_EDITOR } from '@/components/vtable/editors/register';
 * ```
 *
 * 子路径那些模块不含组件，不会被注入边界，导出普通函数完全合规
 * （先例：`@/components/commands` 的 barrel 只导出 hook 与函数、不含组件）。
 */
export { VTable, SUMMARY_ROW_KEY } from './VTable';
export { FilterTable } from './FilterTable';
export { TableFilter } from './TableFilter';

export type { VTableApi, VTableProps } from './VTable';

// 类型按功能域分散在各文件里，这里统一转出，页面只需认模块入口
export type { VTableCellInfo, VTableRowInfo } from './types';
export type {
  VTableCellStyle,
  VTableCellStyleHook,
  VTableCellStyleInfo,
  VTableCellTooltipHook,
} from './cellStyle';
export type {
  VTableCellSelection,
  VTableSelectedRowChangeInfo,
  VTableSelection,
} from './selection';
export type {
  VTableMenuClickInfo,
  VTableMenuConfig,
  VTableMenuContext,
  VTableMenuItem,
} from './menu';
export type { EditCellTrigger, VTableCellValueChangeInfo } from './editing';
export type {
  TableExportPluginOptions,
  VTableExportCsvOptions,
  VTableExportExcelOptions,
} from './export';
export type { VTableSortState } from './sorting';
export type {
  VTableExpandableInfo,
  VTableExpandableOptions,
} from './expandable';
export type { FilterTableProps } from './FilterTable';
export type { FilterCondition, FilterField, FilterModel, TableFilterProps } from './TableFilter';
