import React, {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import {Button, Input, Pagination, Popover, Tooltip} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined, GroupOutlined} from '@ant-design/icons';
import type {ColumnsDefine} from '@visactor/vtable';
import {SearchComponent} from '@visactor/vtable-search';
import {type FilterModel, TableFilter} from './TableFilter';
import {GridTable} from './GridTable';
import {collectFilterFields, collectGroupableColumns} from './columnBuilder';
// 类型从模块入口取（type-only，不产生运行时依赖，所以不会与 index → FilterTable 形成循环）
import type {
    EditCellTrigger,
    TableExportPluginOptions,
    GridTableApi,
    GridTableCellInfo,
    GridTableCellStyleHook,
    GridTableCellTooltipHook,
    GridTableCellValueChangeInfo,
    GridTableExpandableOptions,
    GridTableMenuConfig,
    GridTableSelectedRowChangeInfo,
    MergeGroupConfig,
    GridTableGroupOptions,
} from './index';
import {toNumberOrZero} from "@/utils";

const DEFAULT_PAGE_SIZE = 30;

export interface FilterTableProps {
    /** GridTable 列定义。筛选字段不用单独配：列上写 `filterType` 即会出现在筛选面板里 */
    columns: ColumnsDefine;
    /** 原始数据 */
    records: Array<Record<string, unknown>>;
    /** 行主键字段 */
    rowKey: string;
    /** 左侧冻结列数（不含行号列，它由内部自动加上） */
    frozenColCount?: number;
    /** 最左侧行号顺序列，默认启用；传 false 关闭 */
    rowNumber?: boolean | { title?: string; width?: number };
    /** 冻结区允许的最大宽度，默认 '80%'；冻结列多时需要放宽 */
    maxFrozenWidth?: number | string;
    /** 冻结区超宽时是否取消全部冻结，默认 false（只裁减超出的列） */
    unfreezeAllOnExceedsMaxWidth?: boolean;
    /**
     * 统计行：静态对象或根据过滤后数据计算的函数。
     * 主键不用自己填，GridTable 会自动补成 SUMMARY_ROW_KEY。
     */
    summary?: Record<string, unknown> | ((records: Array<Record<string, unknown>>) => Record<string, unknown>);
    /**
     * 分组合并（表级）：按「门槛列 + 顺序列前缀」把相邻同组的行并成一块。
     * 与列级 `mergeCell`（boolean/回调）二选一，别混用。
     */
    mergeGroups?: MergeGroupConfig;
    /**
     * 是否显示「分组」按钮（在搜索框左侧），默认 false。
     *
     * 打开后**不需要再配任何列**：面板直接列出当前表格的所有列，用户自己挑、自己调先后顺序
     * （序号即层级，可上下移动）。组行汇总自动继承列上的 `AppColumnDef.aggregate`。
     *
     * 想「表格一进来就分组」，在列定义上写 `group: true` 即可 —— **不需要**开这个开关；
     * 开关只决定「有没有那个按钮让人改」。两者可以只开一个。
     *
     * ⚠️ 分组只作用于**当前这一页的数据**（组件本身是服务端分页）：第 2 页又出现同一个月份，
     * 会变成第二个组。要跨页合并得由后端按分组维度分页。
     */
    groupable?: boolean;
    /** 选择高亮模式，默认整行高亮 */
    highlightMode?: 'row' | 'column' | 'cell' | 'cross';
    /** 框选、Shift 扩展这类「一个范围覆盖多格」的选中，是否把高亮铺满整行；默认 true */
    highlightInRange?: boolean;
    /** 是否允许多选，默认 true。false：只能单选，点新的会替换掉旧的（Ctrl/Shift 多选一并关掉） */
    multiSelect?: boolean;
    /** 单元格样式回调 */
    cellStyle?: GridTableCellStyleHook;
    /** 单元格悬停提示回调（返回文案即显示 tooltip，与 cellStyle 配套） */
    cellTooltip?: GridTableCellTooltipHook;
    /** 列宽总和不足容器宽度时，是否自动拉宽各列来填满容器；默认 false（右侧留白） */
    autoFillWidth?: boolean;
    /** 可编辑列 */
    editableFields?: Record<string, string>;
    /** 进入编辑的触发方式，默认双击 */
    editCellTrigger?: EditCellTrigger;
    /** 单元格编辑完成回调（含行索引与新值），用于把编辑结果同步回页面 */
    onCellValueChange?: (info: GridTableCellValueChangeInfo) => void;
    /** 行高 */
    rowHeight?: number;
    /** 表头行高 */
    headerRowHeight?: number;
    /** 空数据提示 */
    emptyTip?: string;
    /** 右键菜单 / 表头菜单配置 */
    menu?: GridTableMenuConfig;
    /** 是否加载中，透传给 GridTable 的加载遮罩 */
    loading?: boolean;
    /** 加载遮罩文案，默认「数据加载中…」；不传则用 GridTable 的默认值 */
    loadingTip?: string;
    /** 导出配置，透传给 GridTable 的 TableExportPlugin（不传也能导出） */
    exportOptions?: TableExportPluginOptions;
    /** 按行展开配置，透传给 GridTable（按钮是否有效按行数据判断） */
    expandable?: GridTableExpandableOptions;

    /** 分页总数（后端返回） */
    total?: number;
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
    /** 选中变化（点击/框选/Ctrl+A 全选），回传选中行数 */
    onActiveSelectionChange?: (info: { rowCount: number }) => void;
    /**
     * 当前激活行变化，回传整行数据（鼠标点选/框选、键盘上下行移动都会触发）。
     * 语义与例外见 GridTable 的 onSelectedChange（Ctrl+A 与选中清空回传「没有激活行」，点表头不回调）。
     */
    onSelectedChange?: (info: GridTableSelectedRowChangeInfo) => void;
    /** 单元格点击 */
    onCellClick?: (info: GridTableCellInfo) => void;
    /** 单元格双击 */
    onCellDblClick?: (info: GridTableCellInfo) => void;
}

/**
 * 复合表格组件：CommandBar + TableFilter + Search + GridTable + Pagination。
 *
 * 搜索使用 @visactor/vtable 官方 SearchComponent，只高亮匹配单元格，不过滤数据行。
 * 通过 ref 可访问 GridTable 实例方法（autoFitColumns / repaint / getSelection）。
 */
export const FilterTable = React.forwardRef<GridTableApi, FilterTableProps>(
    (
        {
            columns,
            records,
            rowKey,
            frozenColCount,
            rowNumber,
            maxFrozenWidth,
            unfreezeAllOnExceedsMaxWidth,
            summary,
            mergeGroups,
            groupable = false,
            highlightMode,
            highlightInRange,
            multiSelect,
            cellStyle,
            cellTooltip,
            autoFillWidth,
            editableFields,
            editCellTrigger,
            onCellValueChange,
            rowHeight,
            headerRowHeight,
            emptyTip,
            menu,
            loading,
            loadingTip,
            exportOptions,
            expandable,
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
            onActiveSelectionChange,
            onSelectedChange,
            onCellClick,
            onCellDblClick,
        },
        ref,
    ) => {
        const tableRef = useRef<GridTableApi | null>(null);
        const searchRef = useRef<SearchComponent | null>(null);
        const [filters, setFilters] = useState<FilterModel>({});
        /**
         * 选中的行数，只用于底部计数。
         * 取原生选中回传的行数而不是勾选 keys：勾选与点选/框选在表格里已同步成同一套状态，
         * 行数这一路是全覆盖的（勾选会同步成整行选中并回调）。
         */
        const [activeRowCount, setActiveRowCount] = useState(0);

        /** 筛选字段：从列定义上配的 `filterType` 自动收集，页面不用再单独配 FilterField */
        const filterFields = useMemo(() => collectFilterFields(columns), [columns]);

        // 从当前 records 自动构建 enum 类型的筛选候选项
        const autoOptions = useMemo(() => {
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
            if (activeFilters.length === 0 || filterFields.length === 0) return records;
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
            if (!showSummary || !summary || filteredRecords.length < 1) return undefined;
            if (typeof summary === 'function') return summary(filteredRecords);
            return summary;
        }, [summary, filteredRecords, showSummary]);

        /** 可分组列：直接取当前表格的所有列，页面不用配 */
        const groupOptions = useMemo(() => collectGroupableColumns(columns), [columns]);

        /** 列上标了 `group: true` 的字段（按列顺序）—— 表格一进来就按这些分层 */
        const defaultGroupFields = useMemo(
            () => groupOptions.filter((column) => column.group).map((column) => column.field),
            [groupOptions],
        );

        /**
         * 当前生效的分组列，**顺序即层级**。
         *
         * 初值取列上的 `group: true`；用户一旦在面板里动过（dirty），
         * 之后 columns 再变化也不覆盖他的选择。
         */
        const [groupFields, setGroupFields] = useState<string[]>(defaultGroupFields);
        const groupDirtyRef = useRef(false);
        useEffect(() => {
            if (groupDirtyRef.current) return;
            setGroupFields(defaultGroupFields);
        }, [defaultGroupFields]);

        /** 点一下加入 / 取消（加入时排在最后，即最内层） */
        const toggleGroupField = useCallback((field: string) => {
            groupDirtyRef.current = true;
            setGroupFields((prev) =>
                prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field],
            );
        }, []);

        /** 上下移动调整层级：-1 往外层走，+1 往内层走 */
        const moveGroupField = useCallback((index: number, offset: number) => {
            groupDirtyRef.current = true;
            setGroupFields((prev) => {
                const next = prev.slice();
                const target = index + offset;
                if (target < 0 || target >= next.length) return prev;
                [next[index], next[target]] = [next[target], next[index]];
                return next;
            });
        }, []);

        /** 清空分组，回到「不分层」的平铺状态 */
        const clearGroupFields = useCallback(() => {
            groupDirtyRef.current = true;
            setGroupFields([]);
        }, []);

        /**
         * 分组配置：选了列才生成。
         *
         * - **不传 `title`**：组行直接显示值本身（`2023-12`）—— 值就在这一列下面，
         *   再加「生产月份:」纯属重复；也顺带避免标题过长被列宽截断。
         * - **不传 `aggregates`**：自动继承列上的 `AppColumnDef.aggregate`，
         *   页面只要在列定义里声明一次，组行与底部统计行的口径就自动一致。
         */
        const groupConfig = useMemo<GridTableGroupOptions | undefined>(() => {
            if (groupFields.length === 0) return undefined;
            return {
                fields: groupFields,
                // 默认只展开到第一层，点箭头再看下一层 —— 组多时不会一屏全是明细
                expandLevel: 1,
            };
        }, [groupFields]);

        // 懒初始化 SearchComponent：首次搜索时才创建，确保 table 已就绪
        const ensureSearchComponent = useCallback(() => {
            if (searchRef.current) return searchRef.current;
            const table = tableRef.current?.getTable();
            if (!table) return null;
            searchRef.current = new SearchComponent({table});
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

        // 向外暴露 GridTable 实例方法
        useImperativeHandle(
            ref,
            () =>
                ({
                    autoFitColumns: () => tableRef.current?.autoFitColumns(),
                    repaint: () => tableRef.current?.repaint(),
                    getSelection: () =>
                        tableRef.current?.getSelection() ?? {rows: [], cells: [], activeCell: null},
                    // 行号 = 数据行下标（0 起、不含表头，跟随显示顺序）；越界返回 undefined，这里不兜底
                    getRowByIndex: (index: number) => tableRef.current?.getRowByIndex(index),
                    // 表格还没建好时给「没有激活行」——形状与 GridTable 内部的 EMPTY_SELECTED_ROW 一致
                    // （少字段会被 satisfies GridTableApi 当场拦住，不会悄悄漂移）
                    getActiveRow: () =>
                        tableRef.current?.getActiveRow() ?? {
                            record: undefined,
                            row: -1,
                            rowIndex: -1,
                            rowKey: '',
                            isSummaryRow: false,
                            isGroupRow: false,
                        },
                    getTable: () => tableRef.current?.getTable() ?? null,
                    // 导出是 GridTable 内部 TableExportPlugin 的能力，这里一并转发出去。
                    // 表格还没建好时 tableRef 为 null，返回一个空 Promise，让签名始终是 Promise
                    // （原先用 `as GridTableApi` 把「可能返回 undefined」这一层给断言掉了）
                    exportExcel: (fileName?: string) =>
                        tableRef.current?.exportExcel(fileName) ?? Promise.resolve(undefined),
                    exportCsv: (fileName?: string) =>
                        tableRef.current?.exportCsv(fileName) ?? Promise.resolve(undefined),
                    clearSelection: () => tableRef.current?.clearSelection(),
                    // 行展开：透传到 GridTable（没配 expandable 时这些方法是空转）
                    expandRow: (rowKey: string) => tableRef.current?.expandRow(rowKey),
                    collapseRow: (rowKey: string) => tableRef.current?.collapseRow(rowKey),
                    collapseAllRows: () => tableRef.current?.collapseAllRows(),
                    isRowExpanded: (rowKey: string) =>
                        tableRef.current?.isRowExpanded(rowKey) ?? false,
                }) satisfies GridTableApi,
            [],
        );

        const hasFilter = filterFields.length > 0;

        return (
            <div className="filter-table">
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8}}>
                    {hasFilter && (
                        <div style={{marginTop: 2}}>
                            <TableFilter
                                fields={filterFields}
                                options={autoOptions}
                                value={filters}
                                onChange={handleFilterChange}
                            />
                        </div>
                    )}
                    {/* 右侧工具区：分组按钮 + 搜索框（整体靠右，两个都在一条线上） */}
                    <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8}}>
                        {groupable && groupOptions.length > 0 && (
                            <Popover
                                trigger="click"
                                placement="bottomRight"
                                title={
                                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                        <span>按列分组</span>
                                        {groupFields.length > 0 && (
                                            <Button
                                                type="link"
                                                size="small"
                                                style={{padding: 0}}
                                                onClick={clearGroupFields}
                                            >
                                                清除
                                            </Button>
                                        )}
                                    </div>
                                }
                                content={
                                    <div style={{width: 240}}>
                                        <div style={{maxHeight: 300, overflowY: 'auto'}}>
                                            {groupOptions.map((column) => {
                                                const index = groupFields.indexOf(column.field);
                                                const selected = index >= 0;
                                                return (
                                                    <div
                                                        key={column.field}
                                                        onClick={() => toggleGroupField(column.field)}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                            padding: '4px 6px',
                                                            borderRadius: 4,
                                                            cursor: 'pointer',
                                                            background: selected ? '#e6f4ff' : undefined,
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                width: 18,
                                                                textAlign: 'center',
                                                                fontSize: 12,
                                                                color: selected ? '#1677ff' : '#bfbfbf',
                                                            }}
                                                        >
                                                            {selected ? index + 1 : '·'}
                                                        </span>
                                                        <span
                                                            style={{
                                                                flex: 1,
                                                                fontSize: 13,
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            {column.title}
                                                        </span>
                                                        {selected && (
                                                            <span
                                                                style={{display: 'flex', gap: 2}}
                                                                onClick={(event) => event.stopPropagation()}
                                                            >
                                                                <Tooltip title="往外层">
                                                                    <Button
                                                                        size="small"
                                                                        type="text"
                                                                        icon={<ArrowUpOutlined />}
                                                                        disabled={index === 0}
                                                                        onClick={() => moveGroupField(index, -1)}
                                                                    />
                                                                </Tooltip>
                                                                <Tooltip title="往内层">
                                                                    <Button
                                                                        size="small"
                                                                        type="text"
                                                                        icon={<ArrowDownOutlined />}
                                                                        disabled={index === groupFields.length - 1}
                                                                        onClick={() => moveGroupField(index, 1)}
                                                                    />
                                                                </Tooltip>
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div
                                            style={{
                                                marginTop: 6,
                                                paddingTop: 6,
                                                borderTop: '1px solid #f0f0f0',
                                                fontSize: 12,
                                                color: '#999',
                                            }}
                                        >
                                            序号即层级，可上下调整
                                        </div>
                                    </div>
                                }
                            >
                                <Button icon={<GroupOutlined />}>
                                    分组{groupFields.length > 0 ? ` (${groupFields.length})` : ''}
                                </Button>
                            </Popover>
                        )}
                        <Input.Search
                            placeholder={searchPlaceholder}
                            onSearch={handleSearch}
                            allowClear
                            style={{width: searchWidth}}
                        />
                    </div>
                </div>

                <div className="grid-table-host">
                    <GridTable
                        ref={tableRef}
                        columns={columns}
                        records={filteredRecords}
                        rowKey={rowKey}
                        frozenColCount={frozenColCount}
                        rowNumber={rowNumber}
                        maxFrozenWidth={maxFrozenWidth}
                        unfreezeAllOnExceedsMaxWidth={unfreezeAllOnExceedsMaxWidth}
                        summary={resolvedSummary}
                        // showSummary 关掉时，列上的 aggregate 也不能偷偷生成统计行
                        autoSummary={showSummary}
                        mergeGroups={mergeGroups}
                        group={groupConfig}
                        highlightMode={highlightMode}
                        highlightInRange={highlightInRange}
                        multiSelect={multiSelect ?? false}
                        cellStyle={cellStyle}
                        cellTooltip={cellTooltip}
                        autoFillWidth={autoFillWidth}
                        editableFields={editableFields}
                        editCellTrigger={editCellTrigger}
                        onCellValueChange={onCellValueChange}
                        rowHeight={rowHeight}
                        headerRowHeight={headerRowHeight}
                        emptyTip={emptyTip ?? '暂无数据'}
                        loading={loading}
                        loadingTip={loadingTip}
                        exportOptions={exportOptions}
                        expandable={expandable}
                        menu={menu}
                        onActiveSelectionChange={handleActiveSelectionChange}
                        onSelectedChange={onSelectedChange}
                        onCellClick={onCellClick}
                        onCellDblClick={onCellDblClick}
                    />
                </div>

                {showPagination && toNumberOrZero(total) > 0 && (
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
