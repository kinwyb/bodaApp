/**
 * V0018_V0326 生产看板 > 周生产数据
 *
 * 与旧客户端（`Views/V0018/V0326.cs`）逐项对应：
 * - 查询区：年份（2024 起）→ 组织（义乌/越南，两地齐全时多一个「全部」）→ 查询；
 * - 表格：固定周/周开始/周结束 + 21 个指标 × 3 组织；选单个组织时列头「指标(组织)」，
 *   选全部时按指标分组、列头是组织名（旧客户端 tableShow 的 ShowBands 切换）；
 * - 组织切换只改列不重查（数据一次查回两地）；年份变更走查询按钮；
 * - 双击织造列打开「织造明细」弹窗（SQL 直查按机型透视）；
 * - 导出：旧客户端 exportBtn → FilterTable 的 exportName；刷新不迁（查询按钮即重查）。
 *
 * 一处**有意修正**：旧客户端双击判断 `FieldName.Substring(3).StartsWith("ZZ")` 差了一位，
 * 实际只有织造产量/织造次品数两列能触发；这里按明显意图实现为全部织造（ZZ*）列。
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
import {formatDate, now, toDayjs} from '@/utils';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import {PRODUCTION_ORGS, buildProductionRows, buildSummaryFromColumns, weekPeriodName} from '../productionShared';
import {useProductionOrgs} from '../productionOrgs';
import {buildWeekProductionColumns} from './columns';
import {createWeekProductionBridge, type WeekProductionBridgeContext, type WeekProductionQuery} from './bridged';
import {ZZDetailModal} from './models/zzDetail';

const MIN_YEAR = 2024;

type SearchValues = {
    year?: Dayjs;
};

type ZZDetailTarget = {
    startDate: string;
    endDate: string;
    orgId: string;
};

const WeekProductionPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const serviceOrg = useServiceOrg();
    const {orgs} = useProductionOrgs();

    /** 组织候选：只保留义乌/越南（山西已按需求排除），两地齐全时插入「全部」 */
    const orgOptions = useMemo(() => {
        const available = PRODUCTION_ORGS.filter((org) => orgs.some((item) => item.OrgID === org.id));
        const options = available.map((org) => ({value: org.id, label: org.name}));
        if (available.length === PRODUCTION_ORGS.length) {
            options.unshift({value: '', label: '全部'});
        }
        return options;
    }, [orgs]);

    /** 当前展示的组织；空串 = 全部。默认当前服务组织（旧客户端 Common.config.OrgID） */
    const [orgId, setOrgId] = useState<string>(() => serviceOrg || PRODUCTION_ORGS[0].id);
    const [query, setQuery] = useState<{year: number}>({year: now().year()});
    const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<ZZDetailTarget | null>(null);

    /** OrgChanged：全局组织切换且新组织在候选里时跟随（旧客户端同名通知） */
    useEffect(() => {
        if (serviceOrg && orgOptions.some((option) => option.value === serviceOrg)) {
            setOrgId(serviceOrg);
        }
    }, [serviceOrg, orgOptions]);

    /** 界面桥 query.set 的等待者：请求落地（含失败）才放行 */
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await biApi.productionWeekDateQuery(query.year, false);
            setRows(buildProductionRows(res.data ?? [], weekPeriodName));
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

    /** 按新条件重查（界面桥 query.set 用）：新引用保证同值也会触发 effect */
    const applyQuery = useCallback((next: WeekProductionQuery): Promise<void> =>
        new Promise<void>((resolve) => {
            pendingQueryRef.current = resolve;
            form.setFieldsValue({year: toDayjs(`${next.year}-01-01`)});
            setOrgId(next.orgId);
            setQuery({year: next.year});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const columns = useMemo(() => buildWeekProductionColumns(orgId), [orgId]);
    /** 统计行按旧客户端口径：比率取平均且忽略缺值（组件内置 avg 会把缺值当 0） */
    const summary = useMemo(() => buildSummaryFromColumns(columns), [columns]);

    /** 双击织造列 → 织造明细弹窗（旧客户端 bandedGridView1_DoubleClick） */
    const handleCellDblClick = useCallback((info: GridTableCellInfo) => {
        if (info.isSummaryRow || !info.record || !info.field) return;
        const org = PRODUCTION_ORGS.find((item) => info.field?.startsWith(item.prefix));
        if (!org) return;
        const metricField = info.field.slice(org.prefix.length);
        if (!metricField.startsWith('ZZ')) return;
        const startDate = formatDate(info.record['WeekStartDate']);
        const endDate = formatDate(info.record['WeekEndDate']);
        if (!startDate || !endDate) return;
        setDetail({startDate, endDate, orgId: org.id});
    }, []);

    const bridgeQuery = useMemo<WeekProductionQuery>(() => ({year: query.year, orgId}), [query.year, orgId]);
    const bridgeContext = useMemo<WeekProductionBridgeContext>(() => ({
        view,
        query: bridgeQuery,
        orgOptions,
        columns,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, bridgeQuery, orgOptions, columns, applyQuery]);
    const bridge = useMemo(() => createWeekProductionBridge(() => bridgeContext), [bridgeContext]);
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
                        style={{width: 120}}
                        options={orgOptions}
                        value={orgId}
                        onChange={(value: string) => setOrgId(value)}
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
                exportName="周生产数据"
                onCellDblClick={handleCellDblClick}
            />
            <ZZDetailModal
                open={detail !== null}
                view={view}
                startDate={detail?.startDate ?? ''}
                endDate={detail?.endDate ?? ''}
                orgId={detail?.orgId ?? ''}
                onClose={() => setDetail(null)}
            />
        </div>
    );
};

export default WeekProductionPage;
