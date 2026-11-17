/**
 * QuickBI 共用页面组件：对应旧客户端 `Views/Dialog/QuickBI.cs` 基类。
 * V0357 下六个分析页（V0358~V0363）共用，各页面只传一份 QuickBIConfig（差异点见 types.ts）。
 *
 * 基类行为：
 * - 查询：年份 + 组织多选（orgProcedure 取候选，QuickBIOrg 勾选窗 → 这里用多选 Select，
 *   至少一个组织）；主表 mainProcedure（Year / EmployeeNo / OrgPK）；
 * - 主表：动态列，数值列合计，「业务单元 / 指标」纵向合并（mergeGroups）；
 * - 点数值单元格 → 下方明细 Tabs：BIViewConfig（BIGroup=caption，OrgID=当前系统组织）
 *   按「业务单元_指标」配标签页，没配则回退 detailProcedure 单标签「明细」；
 *   明细参数 year / OrgPK / EmployeeNo / kpiName / DateDecs（被点的列字段名）；
 * - 命令：图表（选中行指标的月度折线/柱状）、配置明细（仅超管，BIViewSave）。
 *
 * 按约定不迁：导出 → 主表 / 明细表各自的 exportName；刷新 → 查询按钮即重查；
 * 「权限」按钮（powerBtn）在 C# 里处理函数整段被注释，是死按钮，不迁。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Empty, Form, Select, Spin, Splitter, Tabs, type TabsProps} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {sqlApi, N, S} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {
    FilterTable,
    type AppColumnDef,
    type FilterTableApi,
    type GridTableCellInfo,
    type GridTableSelectedRowChangeInfo,
} from '@/components/grid-table';
import {emitActiveUIEvent, useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {SUPER_ADMIN_USER_ID} from '@/services';
import {useAuth} from '@/store/auth-context';
import {useServiceOrg} from '@/store/service-org';
import {isBlank, now, toDayjs, toStringOrEmpty} from '@/utils';
import {createQuickBIBridge, type QuickBIBridgeContext, type QuickBIQuery} from './bridge';
import {
    buildDetailColumns,
    buildMainColumns,
    detailMergeGroups,
    KPI_ROW_KEY,
    MAIN_MERGE_GROUPS,
    resultRecords,
    UNCLICK_COLUMNS,
} from './columns';
import {useQuickBICommands, type QuickBICommandContext} from './command';
import {KpiChartModal} from './models/kpiChart';
import {ViewConfigModal} from './models/viewConfig';
import type {BiViewConfig, DetailTabData, DetailTarget, KpiRecord, QuickBIConfig} from './types';

export type QuickBIPageProps = ViewPageProps & {
    /** 页面差异点配置（模块级常量，引用稳定） */
    config: QuickBIConfig;
};

type SearchValues = {
    year?: Dayjs;
};

type OrgOption = {value: string; label: string};

const EMPTY_TAB: DetailTabData = {columns: [], records: [], loading: false, loaded: false};

/**
 * 动态列还没回来（或查无列）时的占位。
 * 不能直接挂零列的 FilterTable：widthMode="autoWidth" 按列宽算表宽，零列时整张表
 * 缩成行号列那一条，VTable 自带的空态图标/文字全挤在左边。列回来后再挂表格。
 */
const TablePlaceholder: React.FC<{loading: boolean; tip: string}> = ({loading, tip}) => (
    <div style={{flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        {loading ? <Spin/> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tip}/>}
    </div>
);

/** 明细配置查询：与 C# loadViewConfig 同一条 SQL（OrgID 用当前系统组织，不是所选组织） */
const VIEW_CONFIG_SQL = 'SELECT * FROM [transitDB].dbo.BIViewConfig WHERE BIGroup = ? AND OrgID = ? ORDER BY SortNo';

export const QuickBIPage: React.FC<QuickBIPageProps> = ({view, trail, config}) => {
    const {message, modal} = App.useApp();
    const {userInfo} = useAuth();
    const serviceOrg = useServiceOrg();
    const currentOrg = serviceOrg || userInfo?.OrgID || '';
    const empID = userInfo?.EmpID ?? '';
    const isSuperUser = userInfo?.UserID === SUPER_ADMIN_USER_ID;

    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const detailTableRefs = useRef<Record<number, FilterTableApi | null>>({});

    /** 组织候选（orgProcedure）；勾选默认当前系统组织（C# checkOrgs = Common.config.OrgID） */
    const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
    const [orgIds, setOrgIds] = useState<string[]>(() => (currentOrg ? [currentOrg] : []));
    const [query, setQuery] = useState<{year: number; orgPK: string}>(() => ({year: now().year(), orgPK: currentOrg}));

    const [mainColumns, setMainColumns] = useState<AppColumnDef[]>([]);
    const [mainRecords, setMainRecords] = useState<KpiRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeRow, setActiveRow] = useState<KpiRecord | null>(null);

    /** 明细面板：标签页配置 + 各页数据 + 激活页（C# xtraTabControl1 + splitContainerControl1） */
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailConfigs, setDetailConfigs] = useState<BiViewConfig[]>([]);
    const [detailData, setDetailData] = useState<Record<number, DetailTabData>>({});
    const [activeTab, setActiveTab] = useState(0);
    const activeTabRef = useRef(0);
    const detailTargetRef = useRef<DetailTarget | null>(null);
    /** 明细目标的渲染镜像：ref 只供事件回调读，渲染期（桥上下文 / 标签页）读这份 state */
    const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
    const selectViewKeyRef = useRef('');
    const viewConfigRef = useRef<Map<string, BiViewConfig[]>>(new Map());

    const [chartKpi, setChartKpi] = useState<string | null>(null);
    const [configOpen, setConfigOpen] = useState(false);

    /** Splitter 受控尺寸：收起时明细面板 0（C# Collapsed），展开时主表 3/7（C# SplitterPosition） */
    const [sizes, setSizes] = useState<Array<number | string>>(['100%', 0]);

    const pendingQueryRef = useRef<(() => void) | null>(null);
    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    /** 组织候选加载（C# initOrgCombox） */
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const res = await sqlApi.procedure({
                    ProcedureName: config.orgProcedure ?? 'Query_kpi_org',
                    Args: {EmployeeNo: empID},
                });
                const list = res.data?.parseToList<{OrgPk: string; OrgName: string}>({OrgPk: S, OrgName: S}) ?? [];
                if (alive) {
                    setOrgOptions(list.map((org) => ({value: org.OrgPk, label: org.OrgName})));
                }
            } catch (error) {
                if (alive) void message.error(ErrorMessage(error, '组织信息加载失败'));
            }
        })();
        return () => {
            alive = false;
        };
    }, [config.orgProcedure, empID, message]);

    /** 主表取数（C# queryBI）：先取明细配置，再查 KPI；换数据即收起明细面板 */
    const loadData = useCallback(async () => {
        if (isBlank(query.orgPK)) {
            settleQuery();
            return;
        }
        setLoading(true);
        setDetailOpen(false);
        setSizes(['100%', 0]);
        selectViewKeyRef.current = '';
        detailTargetRef.current = null;
        setDetailTarget(null);
        try {
            const configMap = new Map<string, BiViewConfig[]>();
            try {
                const res = await sqlApi.query({SQL: VIEW_CONFIG_SQL, Args: [config.caption, currentOrg]});
                const configs = res.data?.parseToList<BiViewConfig>({
                    BIViewConfigID: S, BIGroup: S, BIWork: S, BIKPI: S, BITag: S, BISQL: S, OrgID: S, SortNo: N,
                }) ?? [];
                configs.forEach((item) => {
                    const key = `${item.BIWork}_${item.BIKPI}`;
                    const list = configMap.get(key);
                    if (list) list.push(item);
                    else configMap.set(key, [item]);
                });
            } catch {
                // C# loadViewConfig 失败时静默跳过（明细走默认存储过程兜底）
            }
            viewConfigRef.current = configMap;

            const res = await sqlApi.procedure({
                ProcedureName: config.mainProcedure,
                Args: {
                    Year: String(query.year),
                    EmployeeNo: empID,
                    [config.orgArgKey ?? 'OrgPK']: query.orgPK,
                },
            });
            const result = res.data;
            if (!result) return;
            setMainColumns(buildMainColumns(result));
            setMainRecords(resultRecords(result));
        } catch (error) {
            void message.error(ErrorMessage(error, '查询失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [query, empID, currentOrg, config, message, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /** 明细取数（C# loadDetailData）：参数键名与 C# 完全一致（year 小写、DateDecs 是列字段名） */
    const loadDetail = useCallback(async (configs: BiViewConfig[], tabIndex: number, target: DetailTarget) => {
        const viewConfig = configs[tabIndex];
        if (!viewConfig) return;
        // 指标档案（C# focusedData 记 zbType → detailColumnType / initMergeColumn / sumColumn）
        const profile = config.detailProfile?.(target.kpi);
        setDetailData((prev) => ({
            ...prev,
            [tabIndex]: {...(prev[tabIndex] ?? EMPTY_TAB), loading: true},
        }));
        try {
            const res = await sqlApi.procedure({
                ProcedureName: viewConfig.BISQL,
                Args: {
                    year: String(query.year),
                    OrgPK: query.orgPK,
                    EmployeeNo: empID,
                    kpiName: viewConfig.BIKPI,
                    DateDecs: target.field,
                },
            });
            const result = res.data;
            if (!result) return;
            setDetailData((prev) => ({
                ...prev,
                [tabIndex]: {
                    columns: buildDetailColumns(result, profile, config.detailColumnMode),
                    records: resultRecords(result),
                    loading: false,
                    loaded: true,
                    mergeGroups: detailMergeGroups(profile),
                },
            }));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
            setDetailData((prev) => ({
                ...prev,
                [tabIndex]: {...(prev[tabIndex] ?? EMPTY_TAB), loading: false},
            }));
        }
    }, [query, empID, config, message]);

    /**
     * 明细与主表来源联动：把触发明细的那个单元格选中。
     * 用户点击时原生已会选中，这里再选一次无副作用；桥 detail.open 没有点击动作，
     * 靠这一步让主表高亮与明细来源始终对得上。单元格地址按字段 + 记录下标定位，跟随排序。
     */
    const selectSourceCell = useCallback((record: KpiRecord, field: string) => {
        tableRef.current?.selectCellByField(toStringOrEmpty(record[KPI_ROW_KEY]), field);
    }, []);

    /** 点单元格展开明细（C# dataView1_Click）：key 变了重建标签页，没变则当前页按新列重查 */
    const openDetail = useCallback(async (record: KpiRecord, field: string, tag?: string) => {
        const kpi = toStringOrEmpty(record['指标']);
        const work = toStringOrEmpty(record['业务单元']);
        const key = `${work}_${kpi}`;
        const configs = viewConfigRef.current.get(key) ?? [{
            BIViewConfigID: '',
            BIGroup: config.caption,
            BIWork: work,
            BIKPI: kpi,
            BITag: '明细',
            BISQL: config.detailProcedure,
            OrgID: query.orgPK,
            SortNo: 0,
        }];
        const changed = selectViewKeyRef.current !== key;
        selectViewKeyRef.current = key;
        let tabIndex = changed ? 0 : activeTabRef.current;
        if (tag) {
            const index = configs.findIndex((item) => item.BITag === tag);
            if (index >= 0) tabIndex = index;
        }
        tabIndex = Math.min(tabIndex, configs.length - 1);
        if (changed) {
            setDetailConfigs(configs);
            setDetailData({});
            detailTableRefs.current = {};
        }
        activeTabRef.current = tabIndex;
        setActiveTab(tabIndex);
        setDetailOpen(true);
        setSizes((prev) => (prev[1] === 0 ? ['43%', '57%'] : prev));
        const target = {kpi, field};
        detailTargetRef.current = target;
        setDetailTarget(target);
        selectSourceCell(record, field);
        await loadDetail(configs, tabIndex, target);
    }, [config, query.orgPK, loadDetail, selectSourceCell]);

    const handleCellClick = useCallback((info: GridTableCellInfo) => {
        if (info.isSummaryRow || info.isGroupRow || !info.record || !info.field) return;
        if (UNCLICK_COLUMNS.includes(info.field)) return;
        void openDetail(info.record, info.field);
    }, [openDetail]);

    /** 标签页首次切入才取数（C# SelectedPageChanged 判 DataSource == null） */
    const handleTabChange = useCallback((key: string) => {
        const index = Number(key);
        activeTabRef.current = index;
        setActiveTab(index);
        const target = detailTargetRef.current;
        if (target && !detailData[index]?.loaded) {
            void loadDetail(detailConfigs, index, target);
        }
    }, [detailData, detailConfigs, loadDetail]);

    const handleSelectedChange = useCallback((info: GridTableSelectedRowChangeInfo) => {
        const record = (info.record as KpiRecord | undefined) ?? null;
        setActiveRow(record);
        emitActiveUIEvent('selection.change', {
            table: 'data',
            rowId: record ? toStringOrEmpty(record[KPI_ROW_KEY]) : null,
        });
    }, []);

    const applyQuery = useCallback((next: QuickBIQuery): Promise<void> =>
        new Promise<void>((resolve) => {
            pendingQueryRef.current = resolve;
            form.setFieldsValue({year: toDayjs(`${next.year}-01-01`)});
            setOrgIds(next.orgIds);
            setQuery({year: next.year, orgPK: next.orgIds.join(',')});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    /** 桥的 detail.open：按行主键找到主表行，走与用户点击完全相同的路径 */
    const openDetailForBridge = useCallback(async (rowId: string, field: string, tag?: string): Promise<string> => {
        const record = mainRecords.find((row) => toStringOrEmpty(row[KPI_ROW_KEY]) === rowId);
        if (!record) {
            return `没找到 _rowKey=${rowId} 的主表行：先用 data.page 确认行主键（重查后主键会变）`;
        }
        if (!mainColumns.some((column) => 'field' in column && column.field === field)) {
            return `主表没有「${field}」列：以快照列目录为准（月份列名形如「3月份」）`;
        }
        await openDetail(record, field, tag);
        const kpi = toStringOrEmpty(record['指标']);
        return `已展开「${kpi}」在「${field}」的明细（detail 表）`;
    }, [mainRecords, mainColumns, openDetail]);

    const commandContext = useMemo<QuickBICommandContext>(() => ({
        message,
        modal,
        tableRef,
        activeRow,
        hasSelection: !!activeRow,
        isSuperUser,
        openChart: (kpi: string) => setChartKpi(kpi),
        openConfig: () => setConfigOpen(true),
    }), [message, modal, activeRow, isSuperUser]);
    const commands = useQuickBICommands(commandContext);

    const bridgeQuery = useMemo<QuickBIQuery>(() => ({year: query.year, orgIds}), [query.year, orgIds]);
    const activeTabData = detailData[activeTab] ?? EMPTY_TAB;
    const bridgeContext = useMemo<QuickBIBridgeContext>(() => ({
        view,
        query: bridgeQuery,
        orgOptions,
        columns: mainColumns,
        detailOpen,
        detailTag: detailConfigs[activeTab]?.BITag ?? '',
        detailKpi: detailTarget?.kpi ?? '',
        detailField: detailTarget?.field ?? '',
        detailColumns: activeTabData.columns,
        commands,
        applyQuery,
        openDetail: openDetailForBridge,
        readTable: () => tableRef.current,
        readDetailTable: () => detailTableRefs.current[activeTabRef.current] ?? null,
    }), [view, bridgeQuery, orgOptions, mainColumns, detailOpen, detailConfigs, activeTab, activeTabData, detailTarget, commands, applyQuery, openDetailForBridge]);
    const bridge = useMemo(() => createQuickBIBridge(config, () => bridgeContext), [config, bridgeContext]);
    useUIBridgeHost(view, bridge);

    const detailTabs = useMemo((): TabsProps['items'] => detailConfigs.map((item, index) => {
        const data = detailData[index] ?? EMPTY_TAB;
        const kpi = detailTarget?.kpi ?? '';
        return {
            key: String(index),
            label: item.BITag,
            children: (
                <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
                    {data.columns.length === 0 ? (
                        <TablePlaceholder loading={data.loading} tip="暂无数据"/>
                    ) : (
                        <FilterTable
                            ref={(api) => {
                                detailTableRefs.current[index] = api;
                            }}
                            columns={data.columns}
                            records={data.records}
                            rowKey={KPI_ROW_KEY}
                            loading={data.loading}
                            showPagination={false}
                            widthMode="autoWidth"
                            mergeGroups={data.mergeGroups}
                            exportName={`${config.caption}_${kpi}明细`}
                            emptyTip="暂无数据"
                        />
                    )}
                </div>
            ),
        };
    }), [detailConfigs, detailData, detailTarget, config.caption]);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                initialValues={{year: now()}}
                onFinish={(values: SearchValues) => {
                    if (orgIds.length === 0) {
                        void message.warning('请选择至少一个组织');
                        return;
                    }
                    setQuery({year: (values.year ?? now()).year(), orgPK: orgIds.join(',')});
                }}
            >
                <Form.Item name="year" label="年份">
                    <DatePicker picker="year" allowClear={false}/>
                </Form.Item>
                <Form.Item label="组织">
                    <Select
                        mode="multiple"
                        style={{minWidth: 220, maxWidth: 420}}
                        options={orgOptions}
                        placeholder="选择组织"
                        maxTagCount="responsive"
                        // 候选未加载或当前组织不在候选里时不显示原始 GUID（与生产看板各页一致）
                        value={orgIds.filter((id) => orgOptions.some((option) => option.value === id))}
                        onChange={(value: string[]) => setOrgIds(value)}
                    />
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                        查询
                    </Button>
                </Form.Item>
            </Form>
            {/* 命令条与表格容器之间留 8px 间隙（.command-bar 自带分隔线但无下外边距） */}
            {commands.length > 0 && (
                <div style={{marginBottom: 8}}>
                    <CommandBar view={view} items={commands}/>
                </div>
            )}
            <div style={{
                flex: 1,
                minHeight: 0,
                padding: 5,
                border: '1px solid rgba(0,0,0,.1)',
                borderRadius: 10,
                overflow: 'hidden',
                display: 'flex',
            }}>
                <Splitter
                    vertical
                    style={{flex: 1, minHeight: 0, height: 'auto'}}
                    onResize={(next) => setSizes(next)}
                >
                    <Splitter.Panel
                        className="splitter-pane-body"
                        size={sizes[0]}
                        min="20%"
                        style={{paddingBottom: detailOpen ? 10 : 0, overflow: 'hidden'}}
                    >
                        {mainColumns.length === 0 ? (
                            <TablePlaceholder loading={loading} tip="没有任何记录"/>
                        ) : (
                            <FilterTable
                                ref={tableRef}
                                columns={mainColumns}
                                records={mainRecords}
                                rowKey={KPI_ROW_KEY}
                                loading={loading}
                                showPagination={false}
                                widthMode="autoWidth"
                                mergeGroups={MAIN_MERGE_GROUPS}
                                exportName={config.caption}
                                emptyTip="没有任何记录"
                                onCellClick={handleCellClick}
                                onSelectedChange={handleSelectedChange}
                            />
                        )}
                    </Splitter.Panel>
                    <Splitter.Panel
                        className="splitter-pane-body"
                        size={sizes[1]}
                        min={detailOpen ? '15%' : 0}
                        resizable={detailOpen}
                        style={{overflow: 'hidden'}}
                    >
                        {detailOpen && (
                            <Tabs
                                className="grid-table-expand-tabs page-tabs-fill"
                                size="small"
                                activeKey={String(activeTab)}
                                onChange={handleTabChange}
                                items={detailTabs}
                            />
                        )}
                    </Splitter.Panel>
                </Splitter>
            </div>
            <KpiChartModal
                key={chartKpi ?? 'closed'}
                open={chartKpi !== null}
                view={view}
                kpi={chartKpi ?? ''}
                records={mainRecords}
                onClose={() => setChartKpi(null)}
            />
            <ViewConfigModal
                open={configOpen}
                view={view}
                biGroup={config.caption}
                orgId={query.orgPK}
                onClose={() => setConfigOpen(false)}
            />
        </div>
    );
};
