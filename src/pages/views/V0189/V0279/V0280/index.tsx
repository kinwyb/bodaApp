import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App} from 'antd';
import {ApiError, yupaiApi, YupaiMachineSizeHeader, type YupaiOrder, type YupaiOrderQuery} from '@/api';
import {CommandBar} from '@/components/CommandBar';
import type {
    VTableApi,
    VTableCellStyle,
    VTableCellStyleHook,
    VTableExpandableOptions,
    VTableMenuConfig,
    VTableSelectedRowChangeInfo,
} from '@/components/vtable';
import {FilterTable} from '@/components/vtable';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import type {ViewPageProps} from '@/pages/types';
import {yupaiService} from '@/services/yupai.ts';
import {isBlank} from '@/utils';
import {buildPreorderColumns, preorderFilterFields} from './columns';
import YupaiOrderEdit from './models/yupaiOrderEdit';
import YupaiOrderMasterDetail from './models/yupaiOrderMasterDetail.tsx';
import YupaiOrderBatchModal from './models/yupaiOrderBatch.tsx';
import YupaiOrderStageModal from './models/yupaiOrderStage.tsx';
import YupaiOrderOriginModal from './models/yupaiOrderOrigin.tsx';
import YupaiOrderPlanModal from './models/yupaiOrderPlan.tsx';
import type {
    FormMode,
    YupaiOrderBatchCommandContext,
    YupaiOrderCommandContext,
    YupaiOrderLogCommandContext,
    YupaiOrderSettingKind,
    YupaiOrderSettingsCommandContext,
} from './command';
import {useYupaiOrderCommands} from './command';
import {YupaiOrderLogModal} from "@/pages/views/V0189/V0279/V0280/models/yupaiOrderLog.tsx";

/** V0189_V0279_V0280 计划管理 > 预订单 > 预订单管理 */
const yupaiOrderPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const [dataSource, setDataSource] = useState<YupaiOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);
    /** 选中的行数：只用来驱动按钮 disabled，行数据本身一律向表格要（见 getActiveRows） */
    const [activeRowCount, setActiveRowCount] = useState(0);
    /**
     * 当前激活的那一行（鼠标点选 / 键盘方向键移动到的行）；没有则为 null。
     * 存成 state 是因为命令项的 disabled 要在渲染时按它算（见 command/changeLog.tsx）。
     */
    const [activeRow, setActiveRow] = useState<YupaiOrder | null>(null);
    const [query, setQuery] = useState<YupaiOrderQuery>({});
    const [changedCells, setChangedCells] = useState<Record<string, string[]>>({});
    const [formOpen, setFormOpen] = useState(false);
    const [formMode, setFormMode] = useState<FormMode>('add');
    const [editingRecord, setEditingRecord] = useState<YupaiOrder | null>(null);
    const tableRef = useRef<VTableApi | null>(null);
    const [logOpen, setLogOpen] = useState(false);
    /** 日志弹窗看的是哪一单：打开时记下来，弹窗按它取数据（不是「当前激活行」——两者不该绑定） */
    const [logOrderId, setLogOrderId] = useState('');
    /** 分批弹窗：与日志同理，记「打开那一刻的那一单」，弹窗开着时改选中不会让内容跟着跳 */
    const [batchOpen, setBatchOpen] = useState(false);
    const [batchOrder, setBatchOrder] = useState<YupaiOrder | null>(null);
    /**
     * 三个设置弹窗（阶段 / 产地 / 计划部）共用一份状态：
     * kind 决定渲染哪一个，order 同理记的是「打开那一刻的那一单」。
     */
    const [settingKind, setSettingKind] = useState<YupaiOrderSettingKind | null>(null);
    const [settingOrder, setSettingOrder] = useState<YupaiOrder | null>(null);

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
            const style: VTableCellStyle = {};
            if (record && (record as YupaiOrder).Status === 0) {
                style.textColor = '#389e0d';
            }
            const fields = changedCells[rowKey];
            if (fields && (fields.length === 0 || fields.includes(field))) {
                style.backgroundColor = '#d9f7be';
            }
            // 空对象 = 不改，翻译层会兜住
            return style;
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

    /**
     * 表格回传「当前激活行」时同步到 state。
     *
     * 表格只在**行**变化时回调（同行内换列不触发），所以点同行的另一列不会白重渲染；
     * 换页 / 换数据时表格会回写一次「没有激活行」，这里跟着清空，不会留着上一页的过期行。
     */
    const handleSelectedChange = useCallback(
        (info: VTableSelectedRowChangeInfo) => {
            const record = info.record as YupaiOrder | undefined;
            // 统计行、以及不属于当前页数据的行都不算（与 getActiveRows 同一条过滤）
            if (!record || info.isSummaryRow) {
                setActiveRow(null);
                return;
            }
            setActiveRow(dataSource.some((d) => d.ID === record.ID) ? record : null);
        },
        [dataSource],
    );

    /** 打开表单弹窗：命令按钮 / 右键菜单 / 双击行共用一个入口 */
    const openForm = useCallback((mode: FormMode, record: YupaiOrder | null) => {
        setFormMode(mode);
        setEditingRecord(record);
        setFormOpen(true);
    }, []);

    /**
     * 打开日志弹窗：命令按钮 / 右键菜单 / 双击行共用一个入口。
     *
     * 记的是**调用时传进来的那一单**，不是「当前激活行」—— 弹窗开着的时候用户还可能改选中，
     * 绑 activeRow 会让内容跟着跳。
     */
    const openLog = useCallback((order: YupaiOrder) => {
        setLogOrderId(order.ID);
        setLogOpen(true);
    }, []);

    /** 打开分批弹窗：同样记的是调用时传进来的那一单，不绑 activeRow */
    const openBatch = useCallback((order: YupaiOrder) => {
        setBatchOrder(order);
        setBatchOpen(true);
    }, []);

    /** 打开三个设置弹窗之一：kind 只决定渲染哪一个，字段映射在各自弹窗里 */
    const openSetting = useCallback((kind: YupaiOrderSettingKind, order: YupaiOrder) => {
        setSettingOrder(order);
        setSettingKind(kind);
    }, []);

    /** 按当前条件重新加载（command/ 里的命令统一走它） */
    const reload = useCallback(async () => {
        await loadData(query);
    }, [loadData, query]);

    /** 命令的公共依赖：业务动作全部在 command/ 目录，页面只负责装配状态 */
    const commandContext = useMemo<YupaiOrderCommandContext>(
        () => ({
            message,
            modal,
            tableRef,
            getSelectedRows: getActiveRows,
            activeRow,
            hasSelection,
            query,
            reload,
            openForm,
        }),
        [message, modal, tableRef, getActiveRows, activeRow, hasSelection, query, reload, openForm],
    );
    /**
     * 变更日志那一组的依赖：在公共 context 之上多一个 openLog。
     * 直接派生（而不是把 9 个字段再抄一遍），公共依赖增删时这里不用跟着改。
     */
    const changeLogCommandContext = useMemo<YupaiOrderLogCommandContext>(
        () => ({...commandContext, openLog}),
        [commandContext, openLog],
    );
    /** 分批那一组的依赖：同样派生，多带一个 openBatch */
    const batchCommandContext = useMemo<YupaiOrderBatchCommandContext>(
        () => ({...commandContext, openBatch}),
        [commandContext, openBatch],
    );
    /** 三个设置弹窗那一组：多带一个 openSetting(kind, order) */
    const settingsCommandContext = useMemo<YupaiOrderSettingsCommandContext>(
        () => ({...commandContext, openSetting}),
        [commandContext, openSetting],
    );
    const commands = useYupaiOrderCommands(
        commandContext,
        changeLogCommandContext,
        batchCommandContext,
        settingsCommandContext,
    );

    const columns = useMemo(() => buildPreorderColumns(), []);

    /**
     * 行展开：有分批数据（`Batchs`）的行才给展开，展开区里是分批明细（Tabs + 明细表格）。
     *
     * 依赖留空：`renderExpanded` 用的是这一行自己的 `record.Batchs`，不读页面上任何状态。
     * 挂上 `dataSource` 只会让每次列表刷新都重建配置、连带触发一次 updateOption。
     */
    const expandable = useMemo<VTableExpandableOptions>(
        () => ({
            rowExpandable: ({record}) => !isBlank(record.Batchs),
            height: 260,
            renderExpanded: ({record}) => {
                const ypOrder = record as YupaiOrder | undefined;
                if (!ypOrder || !ypOrder.Batchs) {
                    return (<div>分批数据空</div>);
                }
                return (<YupaiOrderMasterDetail
                    records={ypOrder.Batchs as Record<string, unknown>[]}
                />);
            },
        }),
        [],
    );

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
                    expandable={expandable}
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
                    onSelectedChange={handleSelectedChange}
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

            <YupaiOrderLogModal
                open={logOpen}
                yupaiOrderID={logOrderId}
                onCancel={() => setLogOpen(false)}
            />

            <YupaiOrderBatchModal
                open={batchOpen}
                order={batchOrder}
                onCancel={() => setBatchOpen(false)}
                // 当前只在控制台打印数据（后端接口待接入），确认后直接关掉；
                // 接好保存接口后，这里通常还要 reload() 一下让列表里的 Batchs 跟着更新
                onSaved={() => {
                    setBatchOpen(false);
                    void reload();
                }}
            />

            {/*
              三个设置弹窗共用一份状态（settingKind / settingOrder），都保持挂载、用 open 控制：
              只渲染当前那个的话，关闭动画会被立即卸载打断。
            */}
            <YupaiOrderStageModal
                open={settingKind === 'stage'}
                order={settingOrder}
                onCancel={() => setSettingKind(null)}
                onSaved={() => {
                    setSettingKind(null);
                    void reload();
                }}
            />

            <YupaiOrderOriginModal
                open={settingKind === 'origin'}
                order={settingOrder}
                onCancel={() => setSettingKind(null)}
                onSaved={() => {
                    setSettingKind(null);
                    void reload();
                }}
            />

            <YupaiOrderPlanModal
                open={settingKind === 'plan'}
                order={settingOrder}
                onCancel={() => setSettingKind(null)}
                onSaved={() => {
                    setSettingKind(null);
                    void reload();
                }}
            />
        </>
    );
};

export default yupaiOrderPage;
