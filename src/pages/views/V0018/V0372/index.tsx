/**
 * V0018_V0372 生产看板 > 月生产数据
 *
 * 与旧客户端（`Views/V0018/V0372.cs`）逐项对应：
 * - 查询区：年份（2025 起）→ 组织（多选，旧客户端 QuickBIOrg 勾选窗）→ 查询；
 * - 数据：与周生产数据同一个接口（monthData=true），月名 = WeekNum-60；
 * - 表格：固定月/月开始/月结束 + 21 指标 × 所选组织；多选时按指标分组，
 *   列头始终「指标(组织)」；组织切换只改列不重查；
 * - 双击**越南**的织造列打开「织造明细」弹窗（存储过程 Query_BJZZMachineTypeData）；
 * - 导出走 exportName；刷新不迁（查询按钮即重查）。
 *
 * 两处**有意修正**（与 V0326 同源）：
 * - 旧客户端双击判断 Substring(3) 差一位，这里按意图实现为全部织造（ZZ*）列；
 * - 组织多选由勾选弹窗改为查询条上的多选 Select，语义不变（候选 = 用户组织列表）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Select, Space} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import type {ViewPageProps} from '@/pages/types';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {FilterTable, type FilterTableApi, type GridTableCellInfo} from '@/components/grid-table';
import {biApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {useServiceOrg} from '@/store/service-org';
import {formatDate, isBlank, now, toDayjs} from '@/utils';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import {PRODUCTION_ORGS, buildProductionRows, buildSummaryFromColumns, monthPeriodName} from '../productionShared';
import {useProductionOrgs} from '../productionOrgs';
import {buildMonthProductionColumns} from './columns';
import {createMonthProductionBridge, type MonthProductionBridgeContext, type MonthProductionQuery} from './bridged';
import {ZZMonthDetailModal} from './models/zzDetail';

const MIN_YEAR = 2025;

/** 越南组织：只有它的双击织造列能开明细（旧客户端限定）。按前缀取，不依赖数组下标 */
const VN_ORG = PRODUCTION_ORGS.find((org) => org.prefix === 'VN')!;

type SearchValues = {
    year?: Dayjs;
};

type ZZDetailTarget = {
    startDate: string;
    endDate: string;
};

const MonthProductionPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const serviceOrg = useServiceOrg();
    const {orgs} = useProductionOrgs();

    /** 组织候选：用户组织列表（旧客户端 QuickBIOrg 拿 OrgID.orgs 全量展示） */
    const orgOptions = useMemo(
        () => orgs
            .filter((item) => !isBlank(item.OrgID))
            .map((item) => ({value: item.OrgID ?? '', label: item.OrgName ?? item.OrgID ?? ''})),
        [orgs],
    );

    /** 选中的组织；默认当前服务组织单选（旧客户端 initOrgCombox(config.OrgID)） */
    const [orgIds, setOrgIds] = useState<string[]>(() => [serviceOrg || PRODUCTION_ORGS[0].id]);
    const [query, setQuery] = useState<{year: number}>({year: now().year()});
    const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<ZZDetailTarget | null>(null);

    /** OrgChanged：全局组织切换时重置为该组织单选（旧客户端 initOrgCombox(newOrgID)） */
    useEffect(() => {
        if (serviceOrg) setOrgIds([serviceOrg]);
    }, [serviceOrg]);

    const pendingQueryRef = useRef<(() => void) | null>(null);
    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await biApi.productionWeekDateQuery(query.year, true);
            setRows(buildProductionRows(res.data ?? [], monthPeriodName));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [message, query, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const applyQuery = useCallback((next: MonthProductionQuery): Promise<void> =>
        new Promise<void>((resolve) => {
            pendingQueryRef.current = resolve;
            form.setFieldsValue({year: toDayjs(`${next.year}-01-01`)});
            setOrgIds(next.orgIds);
            setQuery({year: next.year});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const columns = useMemo(() => buildMonthProductionColumns(orgIds), [orgIds]);
    /** 统计行按旧客户端口径：比率取平均且忽略缺值 */
    const summary = useMemo(() => buildSummaryFromColumns(columns), [columns]);

    /** 双击越南的织造列 → 织造明细弹窗（旧客户端 bandedGridView1_DoubleClick，限定 VN） */
    const handleCellDblClick = useCallback((info: GridTableCellInfo) => {
        if (info.isSummaryRow || !info.record || !info.field) return;
        if (!info.field.startsWith(VN_ORG.prefix)) return;
        const metricField = info.field.slice(VN_ORG.prefix.length);
        if (!metricField.startsWith('ZZ')) return;
        const startDate = formatDate(info.record['WeekStartDate']);
        const endDate = formatDate(info.record['WeekEndDate']);
        if (!startDate || !endDate) return;
        setDetail({startDate, endDate});
    }, []);

    const bridgeQuery = useMemo<MonthProductionQuery>(() => ({year: query.year, orgIds}), [query.year, orgIds]);
    const bridgeContext = useMemo<MonthProductionBridgeContext>(() => ({
        view,
        query: bridgeQuery,
        orgOptions,
        columns,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, bridgeQuery, orgOptions, columns, applyQuery]);
    const bridge = useMemo(() => createMonthProductionBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                initialValues={{year: now()}}
                onFinish={(values: SearchValues) => {
                    setQuery({year: (values.year ?? now()).year()});
                }}
            >
                <Form.Item name="year" label="年份">
                    <DatePicker
                        picker="year"
                        allowClear={false}
                        disabledDate={(current) => current.year() < MIN_YEAR || current.isAfter(now(), 'year')}
                    />
                </Form.Item>
                <Form.Item label="组织">
                    <Select
                        mode="multiple"
                        /*
                         * 固定宽度：responsive 折叠会按容器宽度测量要显示几个标签，
                         * 若宽度随内容自适应（只给 minWidth），「显示内容 →  intrinsic 宽 →
                         * 容器宽 → 重新测量」会互相反馈，长组织名下不停折叠/展开抖动。
                         * 固定宽度切断这条反馈链，折叠结果稳定。
                         */
                        style={{width: 320}}
                        maxTagCount="responsive"
                        maxTagPlaceholder={(omitted) => (
                            // 原生 title：Select 折叠项会拦截鼠标事件，antd Tooltip 弹不出来，
                            // 浏览器级 title 提示不受影响，悬停即可看到被折叠的组织名
                            <span title={omitted.map((item) => String(item.label)).join('、')}>
                                +{omitted.length}...
                            </span>
                        )}
                        options={orgOptions}
                        value={orgIds}
                        onChange={(value: string[]) => setOrgIds(value)}
                        placeholder="选择组织"
                    />
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            查询
                        </Button>
                    </Space>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={columns}
                records={rows}
                rowKey="_rowKey"
                loading={loading}
                showPagination={false}
                summary={summary}
                exportName="月生产数据"
                onCellDblClick={handleCellDblClick}
            />
            <ZZMonthDetailModal
                open={detail !== null}
                view={view}
                startDate={detail?.startDate ?? ''}
                endDate={detail?.endDate ?? ''}
                orgId={VN_ORG.id}
                onClose={() => setDetail(null)}
            />
        </div>
    );
};

export default MonthProductionPage;
