/**
 * V0018_V0372 生产看板 > 月生产数据
 *
 * 与旧客户端（`Views/V0018/V0372.cs`）逐项对应：
 * - 查询区：年份（2025 起）→ 组织（义乌/越南单选 + 全部，与 V0326/V0332 同款短名）→ 查询；
 * - 数据：与周生产数据同一个接口（monthData=true），月名 = WeekNum-60；
 * - 表格：固定月/月开始/月结束 + 21 指标 × 所选组织；选全部时按指标分组，
 *   列头始终「指标(组织)」；组织切换只改列不重查；
 * - 双击**越南**的织造列打开「织造明细」弹窗（存储过程 Query_BJZZMachineTypeData）；
 * - 导出走 exportName；刷新不迁（查询按钮即重查）。
 *
 * 两处**有意修正**（与 V0326 同源）：
 * - 旧客户端双击判断 Substring(3) 差一位，这里按意图实现为全部织造（ZZ*）列；
 * - 旧客户端 QuickBIOrg 勾选窗改为与另两页一致的组织单选（义乌/越南/全部）：
 *   只剩两个生产组织后，单选 + 全部已覆盖原多选的全部组合，且不再显示组织全名。
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
import {formatDate, now, toDayjs} from '@/utils';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import {PRODUCTION_ORGS, buildProductionRows, buildSummaryFromColumns, monthPeriodName} from '../productionShared';
import {useCurrentOrg, useProductionOrgs} from '../productionOrgs';
import {buildMonthProductionColumns} from './columns';
import {createMonthProductionBridge, type MonthProductionBridgeContext, type MonthProductionQuery} from './bridged';
import {ZZMonthDetailModal} from './models/zzDetail';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0018_V0372");


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
    const currentOrg = useCurrentOrg();
    const {orgs} = useProductionOrgs();

    /** 组织候选：仍来自接口组织列表，按 OrgID 映射成义乌/越南短名（与 V0326/V0332 一致），两地齐全时插入「全部」 */
    const orgOptions = useMemo(() => {
        const available = PRODUCTION_ORGS.filter((org) => orgs.some((item) => item.OrgID === org.id));
        const options = available.map((org) => ({value: org.id, label: org.name}));
        if (available.length === PRODUCTION_ORGS.length) {
            options.unshift({value: '', label: t("全部")});
        }
        return options;
    }, [orgs]);

    /** 当前展示的组织；空串 = 全部。默认当前系统组织（store 取） */
    const [orgId, setOrgId] = useState<string>(() => currentOrg || PRODUCTION_ORGS[0].id);
    const [query, setQuery] = useState<{year: number}>({year: now().year()});
    const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<ZZDetailTarget | null>(null);

    /** OrgChanged：当前系统组织变化且新组织在候选里时跟随（与另两页一致） */
    useEffect(() => {
        if (currentOrg && orgOptions.some((option) => option.value === currentOrg)) {
            setOrgId(currentOrg);
        }
    }, [currentOrg, orgOptions]);

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
            setOrgId(next.orgId);
            setQuery({year: next.year});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const columns = useMemo(() => buildMonthProductionColumns(orgId), [orgId]);
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

    const bridgeQuery = useMemo<MonthProductionQuery>(() => ({year: query.year, orgId}), [query.year, orgId]);
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
                <Form.Item name="year" label={t("年份")}>
                    <DatePicker
                        picker="year"
                        allowClear={false}
                        disabledDate={(current) => current.year() < MIN_YEAR || current.isAfter(now(), 'year')}
                    />
                </Form.Item>
                <Form.Item label={t("组织")}>
                    <Select
                        style={{width: 120}}
                        options={orgOptions}
                        placeholder={t("选择组织")}
                        // 候选未加载或当前组织不在候选里时不显示原始 GUID（与另两页一致）
                        value={orgOptions.some((option) => option.value === orgId) ? orgId : undefined}
                        onChange={(value: string) => setOrgId(value)}
                    />
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            {t("查询")}</Button>
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
                exportName={t("月生产数据")}
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
