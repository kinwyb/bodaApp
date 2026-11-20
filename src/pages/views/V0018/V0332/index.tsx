/**
 * V0018_V0332 生产看板 > 织造机型周数据
 *
 * 与旧客户端（`Views/V0018/V0332.cs`）逐项对应：
 * - 查询区：年份（2024 起）→ 组织（义乌/越南 + 全部）→ 查询；
 * - 数据：SQL 直查 transitDB.ProductionWeekData（DataType=2），一周一行，
 *   列 = 组织 × 指标（产出效率/机台利用率）× 机型尺寸（12~21寸）；
 * - 两级表头始终显示：机型(机台总数) → 指标 → 组织(机台数)，机台数查回数据后才有；
 * - 组织切换只改列不重查；导出走 exportName；刷新不迁（查询按钮即重查）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Select, Space} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import type {ViewPageProps} from '@/pages/types';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {ErrorMessage} from '@/api/request';
import {now, toDayjs} from '@/utils';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import {PRODUCTION_ORGS, buildSummaryFromColumns} from '../productionShared';
import {useCurrentOrg, useProductionOrgs} from '../productionOrgs';
import {buildMachineWeekColumns, type MachineCounts} from './columns';
import {loadMachineWeek} from './machineWeekData';
import {createMachineWeekBridge, type MachineWeekBridgeContext, type MachineWeekQuery} from './bridged';
import {usePageI18n} from '@/i18n/context';

const MIN_YEAR = 2024;

type SearchValues = {
    year?: Dayjs;
};

const MachineWeekPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const {t} = usePageI18n(view);
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const currentOrg = useCurrentOrg();
    const {orgs} = useProductionOrgs();

    /** 组织候选：只保留义乌/越南（山西已按需求排除），两地齐全时插入「全部」 */
    const orgOptions = useMemo(() => {
        const available = PRODUCTION_ORGS.filter((org) => orgs.some((item) => item.OrgID === org.id));
        const options = available.map((org) => ({value: org.id, label: t(org.name)}));
        if (available.length === PRODUCTION_ORGS.length) {
            options.unshift({value: '', label: t('全部')});
        }
        return options;
    }, [orgs, t]);

    /** 默认当前系统组织（store 取）；空串 = 全部 */
    const [orgId, setOrgId] = useState<string>(() => currentOrg || PRODUCTION_ORGS[0].id);
    const [query, setQuery] = useState<{year: number}>({year: now().year()});
    const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
    const [counts, setCounts] = useState<MachineCounts>({});
    const [loading, setLoading] = useState(false);

    /** OrgChanged：当前系统组织变化且新组织在候选里时跟随 */
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
            const data = await loadMachineWeek(query.year);
            setRows(data.rows);
            setCounts(data.counts);
        } catch (error) {
            void message.error(ErrorMessage(error, t('数据加载失败')));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [message, query, settleQuery, t]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const applyQuery = useCallback((next: MachineWeekQuery): Promise<void> =>
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

    const columns = useMemo(() => buildMachineWeekColumns(orgId, counts, t), [orgId, counts, t]);
    /** 统计行按旧客户端口径：比率取平均且忽略缺值 */
    const summary = useMemo(() => buildSummaryFromColumns(columns), [columns]);

    const bridgeQuery = useMemo<MachineWeekQuery>(() => ({year: query.year, orgId}), [query.year, orgId]);
    const bridgeContext = useMemo<MachineWeekBridgeContext>(() => ({
        view,
        query: bridgeQuery,
        orgOptions,
        columns,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, bridgeQuery, orgOptions, columns, applyQuery]);
    const bridge = useMemo(() => createMachineWeekBridge(() => bridgeContext), [bridgeContext]);
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
                <Form.Item name="year" label={t('年份')}>
                    <DatePicker
                        picker="year"
                        allowClear={false}
                        disabledDate={(current) => current.year() < MIN_YEAR || current.isAfter(now(), 'year')}
                    />
                </Form.Item>
                <Form.Item label={t('组织')}>
                    <Select
                        style={{width: 120}}
                        options={orgOptions}
                        placeholder={t('选择组织')}
                        // 候选未加载或当前组织不在候选里时不显示原始 GUID（旧客户端组合框为空）
                        value={orgOptions.some((option) => option.value === orgId) ? orgId : undefined}
                        onChange={(value: string) => setOrgId(value)}
                    />
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            {t('查询')}
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
                exportName={t('织造机型周数据')}
            />
        </div>
    );
};

export default MachineWeekPage;
