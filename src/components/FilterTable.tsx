import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Input, Pagination } from 'antd';
import type { ColumnsDefine } from '@visactor/vtable';
import { SearchComponent } from '@visactor/vtable-search';
import { TableFilter, type FilterField, type FilterModel } from './TableFilter';
import {
  VTable,
  type TableExportPluginOptions,
  type VTableApi,
  type VTableCellInfo,
  type VTableCellStyleHook,
  type VTableMenuConfig,
} from './VTable';

const DEFAULT_PAGE_SIZE = 30;

export interface FilterTableProps {
  /** 筛选字段定义；不传则不渲染筛选条 */
  filterFields?: FilterField[];

  /** VTable 列定义 */
  columns: ColumnsDefine;
  /** 原始数据 */
  records: Array<Record<string, unknown>>;
  /** 行主键字段 */
  rowKey: string;
  /** 勾选列字段名 */
  selectField?: string;
  /** 左侧冻结列数（不含行号列与勾选列，那两个由内部自动加上） */
  frozenColCount?: number;
  /** 最左侧行号顺序列，默认启用；传 false 关闭 */
  rowNumber?: boolean | { title?: string; width?: number };
  /** 冻结区允许的最大宽度，默认 '80%'；冻结列多时需要放宽 */
  maxFrozenWidth?: number | string;
  /** 冻结区超宽时是否取消全部冻结，默认 false（只裁减超出的列） */
  unfreezeAllOnExceedsMaxWidth?: boolean;
  /**
   * 统计行：静态对象或根据过滤后数据计算的函数。
   * 主键不用自己填，VTable 会自动补成 SUMMARY_ROW_KEY。
   */
  summary?: Record<string, unknown> | ((records: Array<Record<string, unknown>>) => Record<string, unknown>);
  /** 单元格样式回调 */
  cellStyle?: VTableCellStyleHook;
  /** 列宽总和不足容器宽度时，是否自动拉宽各列来填满容器；默认 false（右侧留白） */
  autoFillWidth?: boolean;
  /** 可编辑列 */
  editableFields?: Record<string, string>;
  /** 行高 */
  rowHeight?: number;
  /** 表头行高 */
  headerRowHeight?: number;
  /** 空数据提示 */
  emptyTip?: string;
  /** 右键菜单 / 表头菜单配置 */
  menu?: VTableMenuConfig;
  /** 是否加载中，透传给 VTable 的加载遮罩 */
  loading?: boolean;
  /** 加载遮罩文案，默认「数据加载中…」；不传则用 VTable 的默认值 */
  loadingTip?: string;
  /** 导出配置，透传给 VTable 的 TableExportPlugin（不传也能导出） */
  exportOptions?: TableExportPluginOptions;

  /** 分页总数（后端返回） */
  total: number;
  /** 当前页码 */
  page?: number;
  /** 每页条数 */
  pageSize?: number;
  /** 可选页码 */
  pageSizeOptions?: number[];

  /** 是否显示底部计数，默认 true */
  showCount?: boolean;
  /** 是否显示底部分页，默认 true；关闭时计数也一并隐藏 */
  showPagination?: boolean;
  /** 是否显示汇总行，默认 true */
  showSummary?: boolean;

  /** 搜索框占位符 */
  searchPlaceholder?: string;
  /** 搜索框宽度 */
  searchWidth?: number;

  /** 筛选变化回调 */
  onFilterChange?: (filters: FilterModel) => void;
  /** 页码变化回调 */
  onPageChange?: (page: number, pageSize: number) => void;
  /** 勾选变化回调 */
  onSelectionChange?: (keys: string[]) => void;
  /** 原生单元格选中变化（点击/框选），回传选中行数 */
  onActiveSelectionChange?: (info: { rowCount: number }) => void;
  /** 单元格点击 */
  onCellClick?: (info: VTableCellInfo) => void;
  /** 单元格双击 */
  onCellDblClick?: (info: VTableCellInfo) => void;
}

/**
 * 复合表格组件：CommandBar + TableFilter + Search + VTable + Pagination。
 *
 * 搜索使用 VTable 官方 SearchComponent，只高亮匹配单元格，不过滤数据行。
 * 通过 ref 可访问 VTable 实例方法（autoFitColumns / repaint / getSelection）。
 */
export const FilterTable = React.forwardRef<VTableApi, FilterTableProps>(
  (
    {
      filterFields,
      columns,
      records,
      rowKey,
      selectField,
      frozenColCount,
      rowNumber,
      maxFrozenWidth,
      unfreezeAllOnExceedsMaxWidth,
      summary,
      cellStyle,
      autoFillWidth,
      editableFields,
      rowHeight,
      headerRowHeight,
      emptyTip,
      menu,
      loading,
      loadingTip,
      exportOptions,
      total,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
      pageSizeOptions = [10, 30, 50, 100],
      showCount = true,
      showPagination = true,
      showSummary = true,
      searchPlaceholder = '搜索关键字',
      searchWidth = 200,
      onFilterChange,
      onPageChange,
      onSelectionChange,
      onActiveSelectionChange,
      onCellClick,
      onCellDblClick,
    },
    ref,
  ) => {
    const tableRef = useRef<VTableApi | null>(null);
    const searchRef = useRef<SearchComponent | null>(null);
    const [filters, setFilters] = useState<FilterModel>({});
    /**
     * 选中的行数，只用于底部计数。
     * 取原生选中回传的行数而不是勾选 keys：勾选与点选/框选在表格里已同步成同一套状态，
     * 行数这一路是全覆盖的（勾选会同步成整行选中并回调）。
     */
    const [activeRowCount, setActiveRowCount] = useState(0);

    // 从当前 records 自动构建 enum 类型的筛选候选项
    const autoOptions = useMemo(() => {
      if (!filterFields) return {};
      const enumFields = filterFields.filter((f) => f.type === 'enum');
      if (enumFields.length === 0) return {};

      const result: Record<string, Set<string | number>> = {};
      enumFields.forEach((field) => {
        result[field.field] = new Set();
      });

      records.forEach((record) => {
        enumFields.forEach((field) => {
          const value = record[field.field];
          if (value != null && value !== '') {
            result[field.field].add(value as string | number);
          }
        });
      });

      const options: Record<string, Array<string | number>> = {};
      Object.entries(result).forEach(([field, set]) => {
        options[field] = Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
      });

      return options;
    }, [filterFields, records]);

    const handleFilterChange = useCallback(
      (next: FilterModel) => {
        setFilters(next);
        onFilterChange?.(next);
      },
      [onFilterChange],
    );

    // 客户端筛选：根据 FilterModel 过滤 records
    const filteredRecords = useMemo(() => {
      const activeFilters = Object.entries(filters);
      if (activeFilters.length === 0 || !filterFields) return records;
      const fieldMap = new Map(filterFields.map((f) => [f.field, f.type]));
      return records.filter((record) =>
        activeFilters.every(([field, condition]) => {
          const type = fieldMap.get(field);
          const value = record[field];
          if (type === 'enum') {
            if (!condition.values?.length) return true;
            return condition.values.includes(String(value));
          }
          if (type === 'text') {
            if (!condition.text) return true;
            return value != null && String(value).toLowerCase().includes(condition.text.toLowerCase());
          }
          // date / number: range filter
          if (condition.min !== undefined && value != null) {
            if (type === 'date') {
              if (String(value) < String(condition.min)) return false;
            } else if (Number(value) < Number(condition.min)) return false;
          }
          if (condition.max !== undefined && value != null) {
            if (type === 'date') {
              if (String(value) > String(condition.max)) return false;
            } else if (Number(value) > Number(condition.max)) return false;
          }
          return true;
        }),
      );
    }, [filters, filterFields, records]);

    // 根据过滤后的数据计算汇总
    const resolvedSummary = useMemo(() => {
      if (!showSummary || !summary || filteredRecords.length < 1 ) return undefined;
      if (typeof summary === 'function') return summary(filteredRecords);
      return summary;
    }, [summary, filteredRecords, showSummary]);

    // 懒初始化 SearchComponent：首次搜索时才创建，确保 table 已就绪
    const ensureSearchComponent = useCallback(() => {
      if (searchRef.current) return searchRef.current;
      const table = tableRef.current?.getTable();
      if (!table) return null;
      searchRef.current = new SearchComponent({ table });
      return searchRef.current;
    }, []);

    const handleSearch = useCallback(
      (value: string) => {
        const trimmed = value.trim();
        const sc = ensureSearchComponent();
        if (!sc) return;
        if (!trimmed) {
          sc.clear();
        } else {
          sc.search(trimmed);
        }
      },
      [ensureSearchComponent],
    );

    const handleSelectionChange = useCallback(
      (keys: string[]) => {
        onSelectionChange?.(keys);
      },
      [onSelectionChange],
    );

    const handleActiveSelectionChange = useCallback(
      (info: { rowCount: number }) => {
        setActiveRowCount(info.rowCount);
        onActiveSelectionChange?.(info);
      },
      [onActiveSelectionChange],
    );

    const handlePageChange = useCallback(
      (nextPage: number, nextPageSize: number) => {
        setActiveRowCount(0);
        onPageChange?.(nextPage, nextPageSize);
      },
      [onPageChange],
    );

    // 向外暴露 VTable 实例方法
    useImperativeHandle(
      ref,
      () =>
        ({
          autoFitColumns: () => tableRef.current?.autoFitColumns(),
          repaint: () => tableRef.current?.repaint(),
          getSelection: () =>
            tableRef.current?.getSelection() ?? { rows: [], cells: [], activeCell: null },
          getTable: () => tableRef.current?.getTable() ?? null,
          // 导出是 VTable 内部 TableExportPlugin 的能力，这里一并转发出去
          exportExcel: (fileName?: string) => tableRef.current?.exportExcel(fileName),
          exportCsv: (fileName?: string) => tableRef.current?.exportCsv(fileName),
          clearSelection: () => tableRef.current?.clearSelection(),
        }) as VTableApi,
      [],
    );

    const hasFilter = filterFields && filterFields.length > 0;

    return (
      <div className="filter-table">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8 }}>
          {hasFilter && (
            <div style={{ marginTop: 2 }}>
              <TableFilter
                fields={filterFields}
                options={autoOptions}
                value={filters}
                onChange={handleFilterChange}
              />
            </div>
          )}
          <Input.Search
            placeholder={searchPlaceholder}
            onSearch={handleSearch}
            allowClear
            style={{ width: searchWidth, marginLeft: 'auto' }}
          />
        </div>

        <div className="vtable-host">
          <VTable
            ref={tableRef}
            columns={columns}
            records={filteredRecords}
            rowKey={rowKey}
            selectField={selectField}
            frozenColCount={frozenColCount}
            rowNumber={rowNumber}
            maxFrozenWidth={maxFrozenWidth}
            unfreezeAllOnExceedsMaxWidth={unfreezeAllOnExceedsMaxWidth}
            summary={resolvedSummary}
            cellStyle={cellStyle}
            autoFillWidth={autoFillWidth}
            editableFields={editableFields}
            rowHeight={rowHeight}
            headerRowHeight={headerRowHeight}
            emptyTip={emptyTip ?? '暂无数据'}
            loading={loading}
            loadingTip={loadingTip}
            exportOptions={exportOptions}
            menu={menu}
            onSelectionChange={handleSelectionChange}
            onActiveSelectionChange={handleActiveSelectionChange}
            onCellClick={onCellClick}
            onCellDblClick={onCellDblClick}
          />
        </div>

        {showPagination && total > 0 && (
          <div className="grid-footer">
            {showCount && <span>计数 = {activeRowCount}</span>}
            <Pagination
              size="small"
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={pageSizeOptions}
              showTotal={(count) => `共 ${count} 条`}
              onChange={handlePageChange}
            />
          </div>
        )}
      </div>
    );
  },
);

FilterTable.displayName = 'FilterTable';
