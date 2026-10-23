import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, Input, Modal, Spin} from 'antd';
import {CheckOutlined} from '@ant-design/icons';
import type {ColumnsDefine} from '@visactor/vtable';
import {GridTable, type GridTableApi, type GridTableCellInfo} from './grid-table';
import {type AppColumnDef, collectGroupableColumns} from './grid-table/columnBuilder';

/** 快速选择的一行数据：字段由调用方通过 columns 自定义 */
export type QuickSelectRow = Record<string, unknown>;

export interface QuickSelectViewProps<T extends QuickSelectRow = QuickSelectRow> {
    /**
     * 表格列定义：显示哪些字段、列宽、渲染类型完全由调用方决定。
     * 支持 @visactor/vtable 原生的 `ColumnsDefine`，也支持本项目的 `AppColumnDef[]`
     * （自动用 buildColumns 转换）。
     */
    columns: ColumnsDefine | AppColumnDef[];
    /** 行主键字段名，默认 id */
    rowKey?: string;
    /**
     * 数据加载：完全自定义。
     * 打开弹窗时会以空关键字调用一次；输入框变化时会带上当前关键字重新调用（内部已防抖）。
     * 返回 Promise 或数组均可，组件不关心数据来源。
     */
    loadData: (keyword: string) => Promise<T[]> | T[];
    /**
     * 本地过滤字段：传入后只在打开时加载一次全量数据，
     * 输入框改为在本地按这些字段做「包含」匹配；不传则由 loadData 按关键字过滤。
     */
    searchFields?: string[];
    /** 选择回调：点击「选择」按钮或双击行时，回传选中的整行记录 */
    onSelect: (record: T) => void;
    /** 关键字标签文案；不传则只显示输入框，不渲染标签 */
    searchLabel?: string;
    /** 输入框占位符 */
    searchPlaceholder?: string;
    /** 选择按钮文案，默认「选择」 */
    selectText?: string;
    /** 空数据提示 */
    emptyTip?: string;
    /** 列宽总和不足容器宽度时，是否自动拉宽各列来填满容器；默认 false（右侧留白） */
    autoFillWidth?: boolean;
    /** 输入防抖毫秒数，默认 300 */
    debounceMs?: number;
}

/**
 * 通用快速选择弹窗：整个界面就是「上面一个筛选输入 + 下面一个表格」，
 * 输入框过滤下面的数据，点「选择」或双击行回传当前行。可用于选部门、选员工等任意场景。
 *
 * 作为基础控件，它不关心业务字段与数据来源：
 * - 表格字段通过 columns 自定义（沿用 GridTable 列定义）；
 * - 数据加载通过 loadData(keyword) 自定义，支持服务端过滤或配合 searchFields 本地过滤；
 * - 不做汇总、不做分页，选中单行即回调。
 *
 * <QuickSelectModal
 *   open={open}
 *   title="快速选择-部门"
 *   columns={columns}
 *   rowKey="id"
 *   loadData={(keyword) => employeeApi.list(keyword)}
 *   onSelect={(record) => { setValue(record); setOpen(false); }}
 *   onCancel={() => setOpen(false)}
 * />
 */
export function QuickSelectView<T extends QuickSelectRow = QuickSelectRow>({
                                                                               columns,
                                                                               rowKey = 'id',
                                                                               loadData,
                                                                               searchFields,
                                                                               onSelect,
                                                                               searchLabel,
                                                                               searchPlaceholder = '输入关键字过滤',
                                                                               selectText = '选择',
                                                                               emptyTip = '暂无数据',
                                                                               autoFillWidth = true,
                                                                               debounceMs = 300,
                                                                           }: QuickSelectViewProps<T>): React.ReactElement {
    const {message} = App.useApp();
    const tableRef = useRef<GridTableApi | null>(null);
    const [keyword, setKeyword] = useState('');
    const [records, setRecords] = useState<T[]>([]);
    const [loading, setLoading] = useState(false);
    /** 当前点选的行：数据刷新后由 effect 清空，避免「选择」拿到旧行 */
    const [selectedRecord, setSelectedRecord] = useState<T | null>(null);

    /** 最近一次请求序号：数据回来时若已不是最新请求则丢弃，避免快速输入时串数据 */
    const requestIdRef = useRef(0);
    /** 本地过滤模式下，本次打开是否已加载过全量数据 */
    const loadedRef = useRef(false);
    /** loadData 由调用方传入，可能每次渲染都是新函数，用 ref 保存避免触发重复加载 */
    const loadDataRef = useRef(loadData);
    const onSelectRef = useRef(onSelect);

    const finalSearchFields = useMemo(() => {
        if (searchFields && searchFields.length > 0) {
            return searchFields;
        }
        // 没给 searchFields 时按列上的字段过滤：两种列定义写法都带 field，
        // 分组表头的子列也会被展开（标题组本身没有 field，会被滤掉）
        return collectGroupableColumns(columns).map((col) => col.field);
    }, [searchFields, columns]);


    useEffect(() => {
        loadDataRef.current = loadData;
    }, [loadData]);

    useEffect(() => {
        onSelectRef.current = onSelect;
    }, [onSelect]);

    const localFilter = Boolean(finalSearchFields && finalSearchFields.length > 0);

    const runLoad = useCallback(
        async (nextKeyword: string) => {
            const requestId = (requestIdRef.current += 1);
            setLoading(true);
            try {
                const result = await loadDataRef.current(nextKeyword);
                if (requestId !== requestIdRef.current) return;
                setRecords(Array.isArray(result) ? result : []);
            } catch {
                if (requestId !== requestIdRef.current) return;
                setRecords([]);
                message.error('加载数据失败');
            } finally {
                if (requestId === requestIdRef.current) setLoading(false);
            }
        },
        [message],
    );

    // 数据加载：本地过滤模式只加载一次，否则按关键字防抖重载
    useEffect(() => {
        setKeyword('');
        setRecords([]);
        setSelectedRecord(null);
        loadedRef.current = false;
        requestIdRef.current += 1;
        if (localFilter) {
            if (loadedRef.current) return undefined;
            loadedRef.current = true;
            void runLoad('');
            return undefined;
        }
        const timer = setTimeout(() => void runLoad(keyword), keyword ? debounceMs : 0);
        return () => clearTimeout(timer);
    }, [keyword, localFilter, debounceMs, runLoad]);

    /** 实际展示的数据：本地过滤模式下按 searchFields 做包含匹配，否则用 loadData 返回的原数据 */
    const filterText = keyword.trim().toLowerCase();
    const displayRecords =
        localFilter && filterText
            ? records.filter((row) =>
                (finalSearchFields ?? []).some((field) =>
                    String(row[field] ?? '').toLowerCase().includes(filterText),
                ),
            )
            : records;

    // 重新加载 / 关键字变化后清空已选行，避免「选择」拿到旧行
    useEffect(() => {
        setSelectedRecord(null);
    }, [records, keyword]);

    const handleCellClick = useCallback((info: GridTableCellInfo) => {
        setSelectedRecord((info.record as T | undefined) ?? null);
    }, []);

    /** 取当前选中行：优先点选记录，退化到 @visactor/vtable 原生选中态 */
    const getCurrentRecord = useCallback((): T | null => {
        if (selectedRecord) return selectedRecord;
        const selection = tableRef.current?.getSelection();
        const record = selection?.rows?.[0] ?? selection?.activeCell?.record;
        return (record as T | undefined) ?? null;
    }, [selectedRecord]);

    const handleConfirm = useCallback(() => {
        const record = getCurrentRecord();
        if (!record) {
            message.warning('请选择一行数据');
            return;
        }
        onSelectRef.current(record);
    }, [getCurrentRecord, message]);

    const handleDblClick = useCallback((info: GridTableCellInfo) => {
        const record = info.record as T | undefined;
        if (!record) return;
        onSelectRef.current(record);
    }, []);

    return (
        <>
            <div className="quick-select-toolbar">
                {searchLabel ? <span className="quick-select-label">{searchLabel}</span> : null}
                <Input
                    allowClear
                    value={keyword}
                    placeholder={searchPlaceholder}
                    onChange={(event) => setKeyword(event.target.value)}
                    style={{width: 260}}
                />
                <Button type="primary" icon={<CheckOutlined/>} onClick={handleConfirm}>
                    {selectText}
                </Button>
            </div>

            <div className="grid-table-host quick-select-table">
                <GridTable
                    ref={tableRef}
                    columns={columns}
                    records={displayRecords as Array<Record<string, unknown>>}
                    rowKey={rowKey}
                    highlightMode="row"
                    autoFillWidth={autoFillWidth}
                    emptyTip={emptyTip}
                    onCellClick={handleCellClick}
                    onCellDblClick={handleDblClick}
                />
                {loading ? (
                    <div className="quick-select-loading">
                        <Spin size="small"/>
                    </div>
                ) : null}
            </div>
        </>
    );
}


export type QuickSelectModalProps<T extends QuickSelectRow = QuickSelectRow> = QuickSelectViewProps<T> & {
    /** 是否显示弹窗，由调用方控制 */
    open: boolean;
    /** 弹窗标题，如「快速选择-业务员」 */
    title?: string;
    /** 关闭回调（点右上角关闭、遮罩等） */
    onCancel: () => void;
    /** 弹窗宽度，默认 760 */
    width?: number;
    /** 内容区高度（含工具条），表格自动填满剩余空间，默认 460 */
    height?: number;
}

/**
 * 通用快速选择弹窗：整个界面就是「上面一个筛选输入 + 下面一个表格」，
 * 输入框过滤下面的数据，点「选择」或双击行回传当前行。可用于选部门、选员工等任意场景。
 *
 * 作为基础控件，它不关心业务字段与数据来源：
 * - 表格字段通过 columns 自定义（沿用 GridTable 列定义）；
 * - 数据加载通过 loadData(keyword) 自定义，支持服务端过滤或配合 searchFields 本地过滤；
 * - 不做汇总、不做分页，选中单行即回调。
 *
 * <QuickSelectModal
 *   open={open}
 *   title="快速选择-部门"
 *   columns={columns}
 *   rowKey="id"
 *   loadData={(keyword) => employeeApi.list(keyword)}
 *   onSelect={(record) => { setValue(record); setOpen(false); }}
 *   onCancel={() => setOpen(false)}
 * />
 */
export function QuickSelectModal<T extends QuickSelectRow = QuickSelectRow>({
                                                                                open,
                                                                                title,
                                                                                columns,
                                                                                rowKey = 'id',
                                                                                loadData,
                                                                                searchFields,
                                                                                onSelect,
                                                                                onCancel,
                                                                                searchLabel,
                                                                                searchPlaceholder = '输入关键字过滤',
                                                                                selectText = '选择',
                                                                                width = 760,
                                                                                height = 460,
                                                                                emptyTip = '暂无数据',
                                                                                autoFillWidth = true,
                                                                                debounceMs = 300,
                                                                            }: QuickSelectModalProps<T>): React.ReactElement {
    return (
        <Modal
            open={open}
            title={title}
            width={width}
            footer={null}
            mask={{closable: false}}
            destroyOnHidden
            onCancel={onCancel}
            styles={{
                header: {textAlign: 'center'},
                body: {
                    height,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                },
            }}
        >
            {open && <QuickSelectView columns={columns} loadData={loadData} onSelect={onSelect} rowKey={rowKey}
                                      searchLabel={searchLabel}
                                      searchFields={searchFields} searchPlaceholder={searchPlaceholder}
                                      selectText={selectText} autoFillWidth={autoFillWidth}
                                      debounceMs={debounceMs} emptyTip={emptyTip}
            />}
        </Modal>
    );
}

export default QuickSelectModal;