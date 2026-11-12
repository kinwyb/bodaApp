import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Splitter} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import type {SalaryBonusMachRate, SalaryBonusMonth, SalaryBonusMonthDetail} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {now} from '@/utils';
import type {BonusBridgeContext, BonusQuery} from './bonusBridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {MachRateModal} from './MachRateModal';
import {BONUS_DETAIL_COLUMNS, BONUS_SUMMARY_COLUMNS} from './bonusColumns';

export type BonusSummaryRow = SalaryBonusMonth & {_rowKey: string};
export type BonusDetailRow = SalaryBonusMonthDetail & {_rowKey: string};

export type BonusPerformanceDefinition = {
    title: string;
    exportName: string;
    loadSummary: (month: string) => Promise<SalaryBonusMonth[]>;
    loadDetail: (month: string) => Promise<SalaryBonusMonthDetail[]>;
    loadRate: (month: string, employeeNo: string) => Promise<SalaryBonusMachRate[]>;
    createBridge: (read: () => BonusBridgeContext) => UIBridgeHost;
};

export function BonusPerformancePage({
    view,
    trail,
    title,
    exportName,
    loadSummary,
    loadDetail,
    loadRate,
    createBridge,
}: ViewPageProps & BonusPerformanceDefinition): React.ReactElement {
    const {message} = App.useApp();
    const [form] = Form.useForm<{month: Dayjs}>();
    const summaryRef = useRef<FilterTableApi | null>(null);
    const detailRef = useRef<FilterTableApi | null>(null);
    const [summaryRows, setSummaryRows] = useState<BonusSummaryRow[]>([]);
    const [allDetailRows, setAllDetailRows] = useState<BonusDetailRow[]>([]);
    const [activeEmployeeNo, setActiveEmployeeNo] = useState('');
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState<BonusQuery>(() => ({month: now().format('YYYY-MM')}));
    const [rateOpen, setRateOpen] = useState(false);
    const [rateEmployeeNo, setRateEmployeeNo] = useState('');
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const initialMonth = useMemo(() => now(), []);

    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const summary = await loadSummary(query.month);
            const nextSummary = summary.map((row, index) => ({
                ...row,
                _rowKey: row.EmployeeNo || `${row.Month}:${index}`,
            }));
            setSummaryRows(nextSummary);
            setActiveEmployeeNo(nextSummary[0]?.EmployeeNo ?? '');
            try {
                const detail = await loadDetail(query.month);
                setAllDetailRows(detail.map((row, index) => ({
                    ...row,
                    _rowKey: `${row.WorkDate}|${row.EmployeeNo}|${index}`,
                })));
            } catch (error) {
                setAllDetailRows([]);
                void message.error(ErrorMessage(error, '明细数据加载失败'));
            }
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [loadDetail, loadSummary, message, query, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        if (!activeEmployeeNo || summaryRows.length === 0) return;
        const frame = window.requestAnimationFrame(() => {
            summaryRef.current?.selectRowsByKeys([activeEmployeeNo]);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeEmployeeNo, summaryRows]);

    const applyQuery = useCallback((next: BonusQuery): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), []);

    const detailRows = useMemo(
        () => activeEmployeeNo
            ? allDetailRows.filter((row) => row.EmployeeNo === activeEmployeeNo)
            : allDetailRows,
        [activeEmployeeNo, allDetailRows],
    );

    const bridgeContext = useMemo<BonusBridgeContext>(() => ({
        view,
        title,
        query,
        applyQuery,
        readSummaryTable: () => summaryRef.current,
        readDetailTable: () => detailRef.current,
    }), [view, title, query, applyQuery]);
    const bridge = useMemo(() => createBridge(() => bridgeContext), [bridgeContext, createBridge]);
    useUIBridgeHost(view, bridge);

    const openRate = useCallback((employeeNo: string) => {
        if (!employeeNo) return;
        setRateEmployeeNo(employeeNo);
        setRateOpen(true);
    }, []);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                initialValues={{month: initialMonth}}
                onFinish={(values) => setQuery({month: values.month.format('YYYY-MM')})}
            >
                <Form.Item name="month" label="月份" rules={[{required: true}]}>
                    <DatePicker picker="month" allowClear={false}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: 8,
                border: '1px solid rgba(0,0,0,.1)',
                borderRadius: 8,
                overflow: 'hidden',
            }}>
                <Splitter style={{flex: 1, minHeight: 0, height: 'auto'}}>
                    <Splitter.Panel
                        className="splitter-pane-body"
                        style={{overflow: 'hidden', padding: '4px 6px 6px 8px'}}
                    >
                        <div style={{padding: '4px 2px 8px', fontWeight: 600}}>月汇总</div>
                        <FilterTable
                            ref={summaryRef}
                            columns={BONUS_SUMMARY_COLUMNS}
                            records={summaryRows}
                            rowKey="_rowKey"
                            loading={loading}
                            emptyTip="没有任何记录"
                            onSelectedChange={(info) => setActiveEmployeeNo(String(info.record?.EmployeeNo ?? ''))}
                            onCellDblClick={(info) => openRate(String(info.record?.EmployeeNo ?? ''))}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel
                        className="splitter-pane-body"
                        style={{overflow: 'hidden', padding: '4px 8px 6px 6px'}}
                    >
                        <div style={{padding: '4px 2px 8px', fontWeight: 600}}>明细数据</div>
                        <FilterTable
                            ref={detailRef}
                            columns={BONUS_DETAIL_COLUMNS}
                            records={detailRows}
                            rowKey="_rowKey"
                            loading={loading}
                            emptyTip="没有任何记录"
                            exportName={exportName}
                            onCellDblClick={(info) => openRate(String(info.record?.EmployeeNo ?? ''))}
                        />
                    </Splitter.Panel>
                </Splitter>
            </div>
            <MachRateModal
                open={rateOpen}
                view={view}
                title={title}
                month={query.month}
                employeeNo={rateEmployeeNo}
                loadRate={loadRate}
                onClose={() => setRateOpen(false)}
            />
        </div>
    );
}
