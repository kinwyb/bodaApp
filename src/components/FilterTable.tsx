import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Breadcrumb, Input, Pagination } from 'antd';
import type { ColumnsDefine } from '@visactor/vtable';
import { SearchComponent } from '@visactor/vtable-search';
import { CommandBar, type CommandItem } from './CommandBar';
import { TableFilter, type FilterField, type FilterModel } from './TableFilter';
import {
  VTable,
  type VTableApi,
  type VTableCellInfo,
  type VTableCellStyleHook,
} from './VTable';

const DEFAULT_PAGE_SIZE = 20;

export interface FilterTableProps {
  /** 面包屑导航 */
  trail?: Array<{ name: string }>;
  /** 命令条按钮；不传则不渲染命令条 */
  commands?: CommandItem[];
  /** 命令条权限 View */
  view?: string;

  /** 筛选字段定义；不传则不渲染筛选条 */
  filterFields?: FilterField[];
  /** 筛选候选项 */
  filterOptions?: Record<string, Array<string | number>>;

  /** VTable 列定义 */
  columns: ColumnsDefine;
  /** 原始数据 */
  records: Array<Record<string, unknown>>;
  /** 行主键字段 */
  rowKey: string;
  /** 勾选列字段名 */
  selectField?: string;
  /** 左侧冻结列数 */
  frozenColCount?: number;
  /** 统计行：静态对象或根据过滤后数据计算的函数 */
  summary?: Record<string, unknown> | ((records: Array<Record<string, unknown>>) => Record<string, unknown>);
  /** 单元格样式回调 */
  cellStyle?: VTableCellStyleHook;
  /** 可编辑列 */
  editableFields?: Record<string, string>;
  /** 行高 */
  rowHeight?: number;
  /** 表头行高 */
  headerRowHeight?: number;
  /** 空数据提示 */
  emptyTip?: string;
  /** 是否加载中 */
  loading?: boolean;

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
      trail,
      commands,
      view,
      filterFields,
      filterOptions,
      columns,
      records,
      rowKey,
      selectField,
      frozenColCount,
      summary,
      cellStyle,
      editableFields,
      rowHeight,
      headerRowHeight,
      emptyTip,
      loading,
      total,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
      pageSizeOptions = [10, 20, 50, 100],
      showCount = true,
      showPagination = true,
      showSummary = true,
      searchPlaceholder = '搜索关键字',
      searchWidth = 200,
      onFilterChange,
      onPageChange,
      onSelectionChange,
      onCellClick,
      onCellDblClick,
    },
    ref,
  ) => {
    const tableRef = useRef<VTableApi | null>(null);
    const searchRef = useRef<SearchComponent | null>(null);
    const [filters, setFilters] = useState<FilterModel>({});
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

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
      if (!showSummary || !summary) return undefined;
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
        setSelectedKeys(keys);
        onSelectionChange?.(keys);
      },
      [onSelectionChange],
    );

    const handlePageChange = useCallback(
      (nextPage: number, nextPageSize: number) => {
        setSelectedKeys([]);
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
        }) as VTableApi,
      [],
    );

    const hasFilter = filterFields && filterFields.length > 0;

    return (
      <div className="page-container page-fill">
        {trail && trail.length > 0 && (
          <Breadcrumb
            style={{ marginBottom: 12 }}
            items={trail.map((item) => ({ title: item.name }))}
          />
        )}

        {commands && commands.length > 0 && <CommandBar view={view} items={commands} />}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8 }}>
          {hasFilter && (
            <div style={{ marginTop: 2 }}>
              <TableFilter
                fields={filterFields}
                options={filterOptions}
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
            summary={resolvedSummary}
            cellStyle={cellStyle}
            editableFields={editableFields}
            rowHeight={rowHeight}
            headerRowHeight={headerRowHeight}
            emptyTip={loading ? '加载中…' : emptyTip ?? '暂无数据'}
            onSelectionChange={handleSelectionChange}
            onCellClick={onCellClick}
            onCellDblClick={onCellDblClick}
          />
        </div>

        {showPagination && (
          <div className="grid-footer">
            {showCount && <span>计数 = {selectedKeys.length}</span>}
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
