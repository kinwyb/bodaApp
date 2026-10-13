import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App} from 'antd';
import {ApiError, yupaiApi, type YupaiOrderQuery, type YupaiOrder, YupaiMachineSizeHeader} from '@/api';
import {CommandBar} from '@/components/CommandBar';
import type {FormMode} from '@/components/commands';
import {FilterTable} from '@/components/FilterTable';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import type {VTableApi, VTableCellStyleHook, VTableMenuConfig} from '@/components/VTable';
import type {ViewPageProps} from '@/pages/types';
import {yupaiService} from '@/services/yupai.ts';
import {buildPreorderColumns, preorderFilterFields} from './columns';
import YupaiOrderEdit from './models/yupaiOrderEdit';
import {usePreorderCommands} from './command';
import type {PreorderCommandContext} from './command';

/** V0189_V0279_V0280 计划管理 > 预订单 > 预订单管理 */
const PreorderPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const [dataSource, setDataSource] = useState<YupaiOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);
    /** 选中的行数：只用来驱动按钮 disabled，行数据本身一律向表格要（见 getActiveRows） */
    const [activeRowCount, setActiveRowCount] = useState(0);
    const [query, setQuery] = useState<YupaiOrderQuery>({});
    const [changedCells, setChangedCells] = useState<Record<string, string[]>>({});
    const [formOpen, setFormOpen] = useState(false);
    const [formMode, setFormMode] = useState<FormMode>('add');
    const [editingRecord, setEditingRecord] = useState<YupaiOrder | null>(null);
    const tableRef = useRef<VTableApi | null>(null);

    const loadData = useCallback(
        async (params: YupaiOrderQuery) => {
            // 重新加载前先清掉选中：clearSelection 会回调 rowCount 归零，不用自己再置 state
            tableRef.current?.clearSelection();
            setLoading(true);
            try {
                // 走 services 而不是 yupaiApi.list：派生字段（OrderZQ 等）要在那一层补齐，
                // http 直返的形状里没有它们
                const res = await yupaiService.list(params);
                setDataSource(res.data ?? []);
                setTotal(res.page?.total ?? 0);
            } catch (error) {
                void message.error(error instanceof ApiError ? error.message : '加载预订单失败');
            } finally {
                setLoading(false);
            }
        },
        [message, tableRef, setLoading],
    );

    useEffect(() => {
        void loadData(query);
    }, [loadData, query]);

    useEffect(() => {
        (async () => {
            try {
                const res = await yupaiApi.changes();
                const map: Record<string, string[]> = {};
                res.data?.forEach((item) => {
                    if (!map[item.YupaiOrderID]) map[item.YupaiOrderID] = [];
                    if (item.FieldName) map[item.YupaiOrderID].push(item.FieldName);
                });
                setChangedCells(map);
            } catch {
                // 变更明细拿不到不影响列表使用
            }
        })();
    }, []);

    const cellStyle: VTableCellStyleHook = useCallback(
        ({rowKey, field, record, isSummaryRow}) => {
            // 统计行 / 空白补足行不参与业务标记
            if (!rowKey || isSummaryRow) return undefined;
            const style: Record<string, unknown> = {};
            if (record && (record as YupaiOrder).Status === 0) {
                style.color = '#389e0d';
            }
            const fields = changedCells[rowKey];
            if (fields && (fields.length === 0 || fields.includes(field))) {
                style.bgColor = '#d9f7be';
            }
            return Object.keys(style).length > 0 ? style : undefined;
        },
        [changedCells],
    );

    useEffect(() => {
        tableRef.current?.repaint();
    }, [changedCells]);

    /** 是否有选中行，只用来驱动按钮的 disabled —— 行数由表格回调（见 onActiveSelectionChange） */
    const hasSelection = activeRowCount > 0;

    /** 选中的行：勾选与点选/框选/Ctrl 在表格里已同步成同一套，直接取表格的原生选中即可 */
    const getActiveRows = useCallback((): YupaiOrder[] => {
        const rows = tableRef.current?.getSelection().rows ?? [];
        // 过滤掉不属于当前页数据的行（统计行不在 dataSource 里，一并剔掉）
        return rows.filter((row) =>
            dataSource.some((d) => d.ID === (row as YupaiOrder).ID),
        ) as YupaiOrder[];
    }, [dataSource, tableRef]);

    /** 打开表单弹窗：命令按钮 / 右键菜单 / 双击行共用一个入口 */
    const openForm = useCallback((mode: FormMode, record: YupaiOrder | null) => {
        setFormMode(mode);
        setEditingRecord(record);
        setFormOpen(true);
    }, []);

    /** 按当前条件重新加载（command/ 里的命令统一走它） */
    const reload = useCallback(async () => {
        await loadData(query);
    }, [loadData, query]);

    /** 命令的公共依赖：业务动作全部在 command/ 目录，页面只负责装配状态 */
    const commandContext = useMemo<PreorderCommandContext>(
        () => ({
            message,
            modal,
            tableRef,
            getSelectedRows: getActiveRows,
            hasSelection,
            query,
            reload,
            openForm,
        }),
        [message, modal, tableRef, getActiveRows, hasSelection, query, reload, openForm],
    );
    const commands = usePreorderCommands(commandContext);

    const columns = useMemo(() => buildPreorderColumns(), []);

    /** 右键菜单：数据行给业务操作，统计行不弹，表头/空白处只给通用项 */
    const tableMenu = useMemo<VTableMenuConfig>(
        () => ({
            contextMenuItems: ({record, isSummaryRow}) => {
                if (isSummaryRow) return [];
                if (record) {
                    return [
                        {text: '查看详情', menuKey: 'detail'},
                        {text: '复制本格内容', menuKey: 'copyCell'},
                        {type: 'split'},
                        {text: '列宽自适应', menuKey: 'autoWidth'},
                    ];
                }
                return [
                    {text: '列宽自适应', menuKey: 'autoWidth'},
                    {text: '刷新', menuKey: 'refresh'},
                ];
            },
            onClick: ({menuKey, record, value}) => {
                if (menuKey === 'detail') {
                    const target = record as YupaiOrder | undefined;
                    if (!target?.ID) return;
                    openForm('view', target);
                    return;
                }
                if (menuKey === 'copyCell') {
                    if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(value == null ? '' : String(value));
                        message.success('已复制到剪贴板');
                    } else {
                        message.warning('当前环境不支持剪贴板');
                    }
                    return;
                }
                if (menuKey === 'autoWidth') {
                    tableRef.current?.autoFitColumns();
                    return;
                }
                if (menuKey === 'refresh') {
                    void reload();
                }
            },
        }),
        [openForm, message, reload],
    );

    const workPlaces = useMemo(
        () => [
            ...new Set([
                ...dataSource.map((r) => String(r.WorkPlace ?? '')),
                // 正在编辑/查看/复制的那条也要算进去：它可能不在当前页数据里
                // （复制是按订单号查出来的，产地很可能不在本页），
                // 漏了它 Select 就没有这个选项 —— 选走了原值以后再也选不回来
                String(editingRecord?.WorkPlace ?? ''),
            ]),
        ].filter(Boolean).sort(),
        [dataSource, editingRecord],
    );

    const summary = useCallback((records: Array<Record<string, unknown>>): Record<string, unknown> => {
        const totals = records.reduce<Record<string, number>>(
            (acc, row) => {
                acc.qty += Number(row.Qty) || 0;
                acc.number += Number(row.Number) || 0;
                YupaiMachineSizeHeader.forEach((_, index) => {
                    const field = `MCSize${index + 1}`
                    acc[field] = (acc[field] ?? 0) + (Number(row[field]) || 0);
                });
                return acc;
            },
            {qty: 0, number: 0},
        );
        // 主键由表格组件统一补齐，这里只给汇总字段
        return {
            ...totals,
            Qty: totals.qty,
            Number: totals.number,
        };
    }, []);

    return (
        <>
            <div className="page-container page-fill">
                <PageBreadcrumb trail={trail}/>
                {commands.length > 0 && <CommandBar view={view} items={commands}/>}
                <FilterTable
                    ref={tableRef}
                    filterFields={preorderFilterFields}
                    columns={columns}
                    records={dataSource}
                    rowKey="ID"
                    frozenColCount={8}
                    multiSelect={true}
                    summary={summary}
                    cellStyle={cellStyle}
                    menu={tableMenu}
                    loading={loading}
                    total={total}
                    page={query.page ?? 1}
                    pageSize={query.pageSize ?? 30}
                    searchPlaceholder="关键字"
                    onPageChange={(page, pageSize) => {
                        setActiveRowCount(0);
                        setQuery((prev) => ({...prev, page, pageSize}));
                    }}
                    onActiveSelectionChange={(info) => setActiveRowCount(info.rowCount)}
                    onCellDblClick={(info) => {
                        // 统计行不是真实单据，不打开详情
                        if (info.isSummaryRow) return;
                        const target = info.record as YupaiOrder | undefined;
                        if (!target?.ID) return;
                        openForm('view', target);
                    }}
                />
            </div>

            <YupaiOrderEdit
                open={formOpen}
                mode={formMode}
                record={formMode !== 'add' ? editingRecord : null}
                workPlaces={workPlaces}
                onCancel={() => setFormOpen(false)}
                onSaved={() => {
                    setFormOpen(false);
                    tableRef.current?.clearSelection();
                    // 新增与复制都落成新记录，回第一页看结果；编辑留在当前页刷新
                    if (formMode === 'add' || formMode === 'copy') setQuery((prev) => ({...prev, page: 1}));
                    else void loadData(query);
                }}
            />
        </>
    );
};

export default PreorderPage;
