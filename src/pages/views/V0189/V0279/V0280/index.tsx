import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Input} from 'antd';
import dayjs from 'dayjs';
import {
    ApartmentOutlined,
    CalendarOutlined,
    CloseOutlined,
    ColumnWidthOutlined,
    CopyOutlined,
    EditOutlined,
    ExportOutlined,
    FieldTimeOutlined,
    PlusOutlined,
    ReloadOutlined,
    SafetyCertificateOutlined,
    SendOutlined,
    SettingOutlined,
    ShopOutlined,
    TagOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons';
import {ApiError, yupaiOrderService, type YupaiOrderQuery, type YupaiOrder} from '@/services';
import {CommandBar} from '@/components/CommandBar';
import type {CommandItem} from '@/components/CommandBar';
import {FilterTable} from '@/components/FilterTable';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import type {VTableApi, VTableCellStyleHook, VTableMenuConfig} from '@/components/VTable';
import type {ViewPageProps} from '@/pages/types';
import {buildPreorderColumns, preorderFilterFields} from './columns';
import PreorderFormModal from './PreorderFormModal';

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
    const [formMode, setFormMode] = useState<'add' | 'edit' | 'view'>('add');
    const [editingRecord, setEditingRecord] = useState<YupaiOrder | null>(null);
    const tableRef = useRef<VTableApi | null>(null);
    /** 删除原因：confirm 是命令式调用，外部拿不到输入框的 state，用 ref 带出提交值 */
    const deleteMemoRef = useRef('');

    const loadData = useCallback(
        async (params: YupaiOrderQuery) => {
            // 重新加载前先清掉选中：clearSelection 会回调 rowCount 归零，不用自己再置 state
            tableRef.current?.clearSelection();
            setLoading(true);
            try {
                const res = await yupaiOrderService.list(params);
                setDataSource(res.data);
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
                const res = await yupaiOrderService.changes();
                const map: Record<string, string[]> = {};
                res.data.forEach((item) => {
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

    // 单条操作的目标行：取选中的第一条
    const getSelectedTarget = useCallback(
        (): YupaiOrder | undefined => getActiveRows()[0],
        [getActiveRows],
    );

    /** 批量操作的目标行：就是当前选中的全部行 */
    const getSelectedTargets = useCallback(
        (): YupaiOrder[] => getActiveRows(),
        [getActiveRows],
    );

    // 编辑按钮
    const editCmd = useCallback(() => {
        const target = getSelectedTarget();
        if (!target) {
            message.warning('请选择一条数据再修改').then();
            return;
        }
        setFormMode('edit');
        setEditingRecord(target);
        setFormOpen(true);
    }, [getSelectedTarget, message, setFormMode, setEditingRecord, setFormOpen])

    // 删除按钮
    const delCmd = useCallback(() => {
        const targets = getSelectedTargets();
        if (!targets || targets.length < 1) {
            message.warning("请选择至少一条数据").then();
            return;
        }
        const title = targets.length > 1 ? "确定删除选中的订单":`确认删除订单: ${targets[0].OrderCode} 款式: ${targets[0].StyleCode} ？`
        deleteMemoRef.current = '';
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: title,
            content: (
                <div className="delete-confirm-reason">
                    <Input.TextArea
                        rows={4}
                        autoFocus
                        maxLength={200}
                        showCount
                        placeholder="请填写删除原因"
                        onChange={(event) => {
                            deleteMemoRef.current = event.target.value;
                        }}
                    />
                </div>
            ),
            okText: '确认删除',
            okButtonProps: {danger: true},
            mask: {blur: true},
            onOk: async () => {
                const memo = deleteMemoRef.current.trim();
                if (!memo) {
                    void message.warning('请填写删除原因');
                    // 返回 rejected promise，弹窗保持打开，不丢已填内容
                    return Promise.reject();
                }
                try {
                    await yupaiOrderService.delete({ID: targets.map(o=>o.ID), Memo: memo});
                    void message.success('已删除');
                    await loadData(query);
                } catch (error) {
                    void message.error(error instanceof ApiError ? error.message : '删除失败');
                    // 失败同样保留弹窗，方便改完原因重试
                    return Promise.reject();
                }
            },
        });
    }, [getSelectedTargets, message, modal, loadData, query])

    // 导出当前页到 Excel：走 VTable 内部的 TableExportPlugin，文件名不用带 .xlsx（插件会补）
    const exportCmd = useCallback(async () => {
        const hide = message.loading('正在导出…', 0);
        try {
            await tableRef.current?.exportExcel(`预订单_${dayjs().format('YYYY-MM-DD')}`);
            void message.success('导出成功');
        } catch (error) {
            void message.error(error instanceof Error ? error.message : '导出失败');
        } finally {
            hide();
        }
    }, [message]);

    // 发布按钮
    const submitCmd = useCallback(() => {
        const targets = getSelectedTargets();
        if (!targets || targets.length === 0) {
            message.warning("请选择一条数据").then();
            return;
        }
        const title = targets.length > 1 ? "确定要发布选中的这些订单款式,发布后不能取消" : `确定要发布订单:${targets[0].OrderCode} 款号: ${targets[0].StyleCode}`;
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: "发布确认",
            content: title,
            okText: '确认',
            okButtonProps: {danger: true},
            mask: {blur: true},
            onOk: async () => {
                try {
                    const succMsg = await yupaiOrderService.submit(targets.map(o => o.ID));
                    void message.success(succMsg.data);
                    await loadData(query);
                } catch (error) {
                    void message.error(error instanceof ApiError ? error.message : '发布失败');
                    // 失败同样保留弹窗，方便改完原因重试
                    return Promise.reject();
                }
            },
        });
    }, [getSelectedTargets, message, modal, loadData, query]);

    const commands: CommandItem[] = useMemo(() => [
        {
            key: 'add', label: '新增', icon: <PlusOutlined/>, permission: '新增',
            onClick: () => {
                setFormMode('add');
                setEditingRecord(null);
                setFormOpen(true);
            }
        },
        {
            key: 'edit', label: '修改', icon: <EditOutlined/>, permission: '编辑', disabled: !hasSelection,
            onClick: editCmd
        },
        {
            key: 'cancel',
            label: '取消',
            icon: <CloseOutlined/>,
            disabled: !hasSelection,
            onClick: delCmd
        },
        {
            key: 'copy',
            label: '复制',
            icon: <CopyOutlined/>,
            dividerBefore: true,
            onClick: () => message.info('复制（演示）')
        },
        {
            key: 'copyOrdered', label: '已下订单复制', icon: <CopyOutlined/>, disabled: true, onClick: () => {
            }
        },
        {
            key: 'changeDate',
            label: '变更日志',
            icon: <CalendarOutlined/>,
            dividerBefore: true,
            onClick: () => message.info('变更日志（演示）')
        },
        {
            key: 'publish',
            label: '发布',
            icon: <SendOutlined/>,
            permission: '发布',
            disabled: !hasSelection,
            onClick: submitCmd
        },
        {key: 'ordered', label: '已下单', icon: <TagOutlined/>, onClick: () => message.info('已下单（演示）')},
        {
            key: 'assign',
            label: '分批',
            icon: <ApartmentOutlined/>,
            dividerBefore: true,
            onClick: () => message.info('分批（演示）')
        },
        {
            key: 'stage',
            label: '预订的阶段',
            icon: <FieldTimeOutlined/>,
            onClick: () => message.info('预订的阶段（演示）')
        },
        {
            key: 'origin',
            label: '工段产地',
            icon: <ShopOutlined/>,
            permission: '产地设置',
            onClick: () => message.info('工段产地（演示）')
        },
        {
            key: 'plan',
            label: '计划部设定',
            icon: <SettingOutlined/>,
            permission: 'PMC设置',
            onClick: () => message.info('计划部设定（演示）')
        },
        {
            key: 'refresh',
            label: '刷新',
            icon: <ReloadOutlined/>,
            dividerBefore: true,
            onClick: () => void loadData(query)
        },
        {
            key: 'autoWidth',
            label: '列宽自适应',
            icon: <ColumnWidthOutlined/>,
            onClick: () => tableRef.current?.autoFitColumns()
        },
        {
            key: 'export',
            label: '导出',
            icon: <ExportOutlined/>,
            dividerBefore: true,
            onClick: exportCmd
        },
        {
            key: 'auth',
            label: '权限',
            icon: <SafetyCertificateOutlined/>,
            permission: '权限管理',
            onClick: () => message.info('权限（演示）')
        },
    ], [hasSelection, message, query, loadData, editCmd, delCmd, exportCmd, submitCmd]);

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
                    setFormMode('view');
                    setEditingRecord(target);
                    setFormOpen(true);
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
                    void loadData(query);
                }
            },
        }),
        [loadData, message, query],
    );

    const workPlaces = useMemo(
        () => [...new Set(dataSource.map((r) => String(r.WorkPlace ?? '')))].filter(Boolean).sort(),
        [dataSource],
    );

    const summary = useCallback((records: Array<Record<string, unknown>>): Record<string, unknown> => {
        const totals = records.reduce<{ qty: number; number: number }>(
            (acc, row) => {
                acc.qty += Number(row.Qty) || 0;
                acc.number += Number(row.Number) || 0;
                return acc;
            },
            {qty: 0, number: 0},
        );
        // 主键由表格组件统一补齐，这里只给汇总字段
        return {
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
                        setFormMode('view');
                        setEditingRecord(target);
                        setFormOpen(true);
                    }}
                />
            </div>

            <PreorderFormModal
                open={formOpen}
                mode={formMode}
                record={formMode !== 'add' ? editingRecord : null}
                workPlaces={workPlaces}
                onCancel={() => setFormOpen(false)}
                onSaved={() => {
                    setFormOpen(false);
                    tableRef.current?.clearSelection();
                    if (formMode === 'add') setQuery((prev) => ({...prev, page: 1}));
                    else void loadData(query);
                }}
            />
        </>
    );
};

export default PreorderPage;
