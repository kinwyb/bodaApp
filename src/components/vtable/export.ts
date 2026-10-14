/** 导出 Excel / CSV 的配置类型（走 @visactor/vtable-plugins 的 TableExportPlugin） */
import type { TableExportPluginOptions } from '@visactor/vtable-plugins';

/**
 * 插件包只从根导出了 TableExportPluginOptions，没导出下面这两个子类型
 * （它们在 es/table-export/index 里，而 package.json 的 exports 字段只放开了 "." 和 "./gantt-extensions"，
 * 深路径导入会被拦），所以从 TableExportPluginOptions 上取。
 */
export type VTableExportExcelOptions = NonNullable<TableExportPluginOptions['exportExcelOptions']>;
export type VTableExportCsvOptions = NonNullable<TableExportPluginOptions['exportCsvOptions']>;
export type { TableExportPluginOptions };
