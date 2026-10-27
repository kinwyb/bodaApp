import React, {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import {App, Button, Input, Pagination, Popover, Tooltip} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined, ExportOutlined, GroupOutlined} from '@ant-design/icons';
import type {ColumnsDefine} from '@visactor/vtable';
import {SearchComponent} from '@visactor/vtable-search';
import {type FilterModel, TableFilter} from './TableFilter';
import {GridTable} from './GridTable';
import {collectFilterFields, collectGroupableColumns, type AppColumnDef} from './columnBuilder';
import {filterRecords} from './filtering';
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
    GridTableWidthMode,
    GridTableHeightMode,
} from './index';
import {formatDate, now, toNumberOrZero, toStringOrEmpty} from "@/utils";

const DEFAULT_PAGE_SIZE = 30;

/** 空筛选条件：模块级常量，保证非受控模式下 state 初值引用稳定 */
const EMPTY_FILTERS: FilterModel = {};

/**
 * FilterTable 通过 ref 暴露的方法：GridTable 的全套方法 + 筛选条件读写。
 *
 * 页面一般**不需要**用它来设筛选 —— 传受控 `filters` 就是最直接的方式；
 * 这个入口是给「拿不到 setState 的地方」用的（命令工厂、界面桥的上下文等），
 * 语义见 setFilters 的注释。
 */
export interface FilterTableApi extends GridTableApi {
    /** 当前生效的筛选条件（受控时就是 `filters` 属性的值） */
    getFilters: () => FilterModel;
    /**
     * 当前**用户看到的那批行**：筛选后喂给表格的数据。
     *
     * 与页面 `dataSource` 的区别只有筛选 —— 被筛掉的行在这里不存在（排序 / 分组 / 搜索高亮不影响它，
     * 那些是表格内部的显示层）。命令、界面桥要拼「页面现在长什么样」的快照时用它，
     * **别用 dataSource**：那份是接口原始数据，用户已经筛掉的行也在里面，模型会照着它答非所问。
     *
     * 没有生效条件时返回的就是 `records` 本身（同一个数组引用，不会复制）。
     */
    getFilteredRecords: () => Array<Record<string, unknown>>;
    /**
     * 设置筛选条件 —— **等价于用户在筛选面板上点确定**，不是绕过它的后门：
     *
     * - 非受控（没传 `filters`）：直接改内部条件，表格立刻刷新；
     * - 受控（传了 `filters`）：值由外部持有，这里只回调 `onFilterChange(next)`，
     *   外部把它写回 `filters` 之后才真正生效（受控组件的标准语义）。
     *
     * 想「一键清空」传 `{}` 即可。
     */
    setFilters: (filters: FilterModel) => void;
}

export interface FilterTableProps {
    /**
     * GridTable 列定义。两种写法都支持：
     *
     * 1. **@visactor/vtable 原生的 `ColumnsDefine`**（原样使用）；
     * 2. **`AppColumnDef[]`** —— 内部 GridTable 会自动用 `buildColumns` 转成 `ColumnsDefine`，
     *    页面不必再自己包一层 `buildColumns(COLUMNS)`。
     *
     * 筛选字段不用单独配：列上写 `filterType` 即会出现在筛选面板里
     * （筛选面板与分组面板直接读列上的原始键，两种写法都认）
     */
    columns: ColumnsDefine | AppColumnDef[];
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
    /** 列宽模式，默认 standard；adaptive 跟随容器缩放、autoWidth 按内容算（见 GridTable.widthMode） */
    widthMode?: GridTableWidthMode;
    /** 行高模式，默认 standard；adaptive 跟随容器、autoHeight 按内容算（见 GridTable.heightMode） */
    heightMode?: GridTableHeightMode;
    /**
     * 可编辑列：`字段 -> 编辑器名`，或写 `true` / `'auto'` 按列 dataType 自动挑默认编辑器
     * （int/double → 数字框、date/datetime → 日期、其余 → 输入框）。
     * boolean 列不走编辑器：它是原生勾选框，写进本属性即可单击切换（写回 1 / 0）。
     * 不传 = 整表只读。详见 GridTable.editableFields。
     */
    editableFields?: Record<string, string | true>;
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
    /**
     * 导出名称：**有值就显示工具栏「导出」按钮**（在筛选按钮右边），值即导出文件名前缀
     * （文件名 = 前缀 + 当天日期，不用带 .xlsx，插件会补）。不传 / 空串 = 不显示导出按钮。
     */
    exportName?: string;
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

    /**
     * 受控的筛选条件（字段名 -> 条件），形状与 `onFilterChange` 回传的一致。
     *
     * **不传 = 非受控**：组件自己管条件，初始就是「没有筛选」。
     * **传了（哪怕 `{}`）= 完全受控**：筛选面板的改动只走 `onFilterChange`，
     * 外部把它写回这个属性才生效（不写回则面板点了没反应，受控组件的标准行为）。
     *
     * 程序化过滤就走这条路：外部 state 改成 `{状态: {values: ['已审核']}}`，
     * 表格、条件标签、徽标数量、汇总行会一起变，和用户手点完全一致。
     *
     * 要拿「筛完之后还剩哪些行」，三个口子按场景挑：
     * - 命令 / 界面桥这类**按需取**的：`tableRef.current?.getFilteredRecords()`；
     * - 渲染期就要用的（页脚条数、导航清单）：`filterRecordsByColumns(records, filters, columns)`
     *   （见 `./filtering`，与表格内部是同一份判定）；
     * - 非受控（没传 `filters`）也想取：只能用 `getFilteredRecords()`。
     *
     * 注意筛的是**当前这一页的 records**（分页是服务端分页），
     * 要全量过滤得在 `onFilterChange` 里带条件回后端重新查。
     */
    filters?: FilterModel;
    /** 筛选变化回调（受控时外部必须在这里把条件写回 `filters`，否则改动不生效） */
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
 * 通过 ref 可访问 GridTable 实例方法（autoFitColumns / repaint / getSelection）
 * 以及筛选条件的读写（getFilters / setFilters）。
 *
 * 筛选条件支持两种用法：不传 `filters` 时组件自管（非受控）；传了就完全受控，
 * 程序化过滤由外部 state 驱动。两种模式不要中途切换。
 */
export const FilterTable = React.forwardRef<FilterTableApi, FilterTableProps>(
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
            widthMode,
            heightMode,
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
            exportName,
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
            filters,
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
        // 导出的 loading / 结果提示（App.useApp 只能组件顶层调，与页面取 message 同一来源）
        const {message} = App.useApp();
        /**
         * 非受控时组件自管的筛选条件。受控（传了 `filters`）时这份 state 不会被读，
         * 取值一律用 `currentFilters`，别直接读 innerFilters —— 否则受控模式下会读到空条件。
         */
        const [innerFilters, setInnerFilters] = useState<FilterModel>(EMPTY_FILTERS);
        /** 传了 `filters`（哪怕空对象 `{}`）就是受控：值完全由外部决定 */
        const isFiltersControlled = filters !== undefined;
        const currentFilters = filters ?? innerFilters;
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

        /**
         * 筛选条件变化的唯一入口（面板点确定 / 清标签 / 清空 / ref.setFilters 都走这里）。
         *
         * 受控模式下**不**改内部 state：只把新条件交给外部，等外部写回 `filters` 才生效。
         * 否则会出现「外部没回写、组件却自己变了」的半受控状态，两边的条件就此分叉。
         */
        const handleFilterChange = useCallback(
            (next: FilterModel) => {
                if (!isFiltersControlled) setInnerFilters(next);
                onFilterChange?.(next);
            },
            [isFiltersControlled, onFilterChange],
        );

        /**
         * 客户端筛选：**用户当前看到的这批行**（表格、汇总行、底部计数都以它为准）。
         * 判定逻辑在 `filtering.ts`，与页面 / 界面桥复算时用的是同一份，别在这里另写一套。
         */
        const filteredRecords = useMemo(
            () => filterRecords(records, currentFilters, filterFields),
            [records, currentFilters, filterFields],
        );

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

        /**
         * 导出 Excel：`exportName` 有值才会有按钮，文件名 = 前缀 + 当天日期
         * （与 `components/commands/exportCommand` 的命名规则一致，插件自动补 .xlsx）。
         */
        const handleExport = useCallback(async () => {
            const hide = message.loading('正在导出…', 0);
            try {
                await tableRef.current?.exportExcel(`${toStringOrEmpty(exportName)}${formatDate(now())}`);
                void message.success('导出成功');
            } catch (error) {
                void message.error(error instanceof Error ? error.message : '导出失败');
            } finally {
                hide();
            }
        }, [exportName, message]);

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
                    // 筛选条件读写。setFilters 等价于面板上点确定：受控时只回调 onFilterChange，
                    // 外部写回 filters 才生效（见 FilterTableApi.setFilters）
                    getFilters: () => currentFilters,
                    setFilters: (next: FilterModel) => handleFilterChange(next),
                    // 用户看到的行（筛选后）：命令 / 界面桥拼快照时用它，别用页面的 dataSource
                    getFilteredRecords: () => filteredRecords,
                }) satisfies FilterTableApi,
            // 依赖带上筛选条件、变更函数与筛选结果：handle 重建只是重新赋值 ref.current，
            // 表格实例由 tableRef 单独持有，与这里无关，不会重挂载
            [currentFilters, handleFilterChange, filteredRecords],
        );

        const hasFilter = filterFields.length > 0;

        // 导出按钮：exportName 有值才显示（值即文件名前缀），尺寸与筛选 / 分组按钮一致
        const exportButton = exportName ? (
            <Button icon={<ExportOutlined />} onClick={() => void handleExport()}>
                导出
            </Button>
        ) : null;

        return (
            <div className="filter-table">
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8}}>
                    {hasFilter && (
                        <TableFilter
                            fields={filterFields}
                            options={autoOptions}
                            value={currentFilters}
                            onChange={handleFilterChange}
                            extra={exportButton}
                        />
                    )}
                    {/* 没有筛选字段时 TableFilter 不渲染，导出按钮自己顶上 */}
                    {!hasFilter && exportButton}
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
                        widthMode={widthMode}
                        heightMode={heightMode}
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
